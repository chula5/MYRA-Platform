'use server'

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase-server'
import { analyseProductUrl, type AnalysedProduct } from '@/app/admin/items/analyse-url'
import { scrapeAndUploadToCloudinary } from '@/app/admin/items/cloudinary-upload'
import { checkStockForUrl } from '@/app/admin/items/stock-check'
import { revalidatePath } from 'next/cache'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ParsedCandidate {
  source_url: string
  ok: boolean
  error?: string
  parsed?: AnalysedProduct
  image_url?: string | null
}

// ── URL utilities ────────────────────────────────────────────────────────────

function parseUrlList(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^https?:\/\//i.test(s))
}

// Shopify stores expose a collection's products as paginated JSON at
// /collections/<handle>/products.json?page=N — the real, complete product list
// for that page (not a ~10-item web-search sample). Most of these brands run
// Shopify, so try this first. Honours the ?page= in the pasted URL.
async function shopifyCollectionUrls(collectionUrl: string): Promise<string[]> {
  try {
    const u = new URL(collectionUrl)
    const m = u.pathname.match(/\/collections\/([^/]+)/i)
    if (!m) return []
    const handle = m[1]
    const page = u.searchParams.get('page') ?? '1'
    const endpoint = `${u.origin}/collections/${handle}/products.json?limit=60&page=${page}`
    const res = await fetch(endpoint, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'application/json',
      },
      redirect: 'follow',
    })
    if (!res.ok) return []
    const data = await res.json()
    const products = Array.isArray(data?.products) ? data.products : []
    return products
      .map((p: any) => (p?.handle ? `${u.origin}/products/${p.handle}` : null))
      .filter((x: unknown): x is string => typeof x === 'string')
      .slice(0, 60)
  } catch {
    return []
  }
}

// Resolve a collection URL to a curated list of product URLs. Tries the Shopify
// products.json fast-path first (complete, paginated), then falls back to Claude
// web search for JS-rendered SPAs (Toteme, Khaite, brand-direct sites) that a
// raw fetch can't see into, filtering against the user's aggregated taste profile.
async function findCollectionUrlsViaClaude(
  collectionUrl: string,
): Promise<{ urls: string[]; usedTasteFilter: boolean; error?: string }> {
  // Shopify fast-path — real, complete product list for the page.
  const shopify = await shopifyCollectionUrls(collectionUrl)
  if (shopify.length >= 6) return { urls: shopify, usedTasteFilter: false }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { urls: [], usedTasteFilter: false, error: 'ANTHROPIC_API_KEY not configured' }

  const profile = await loadTasteProfileForFiltering()
  const tasteSection = profile
    ? `\nThe person has an emerging taste profile. Skew toward pieces that fit it:\n${profile}\n`
    : ''

  const prompt = `You are helping curate a fashion library. The user has given you the URL of a collection page (e.g. a brand's new-in page on a retailer site). Use web search to find the real product URLs that appear on this collection page or in this brand's current collection.

Collection page: ${collectionUrl}
${tasteSection}
Return 12–20 PRODUCT page URLs from this collection. Rules:
- Each URL must be a specific product detail page, not a category or homepage.
- URLs must be real and resolvable — verify via search results.
- Prefer pieces from the brand and category implied by the input URL.
- If a taste profile is provided, prefer pieces that fit it. Skip pieces that strongly clash (wrong category, wrong aesthetic register, wrong price tier).
- Do not include duplicate URLs.

Return ONLY a JSON object with this shape, no markdown, no prose:
{ "urls": [ "https://...", "https://...", ... ] }`

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 6,
        } as unknown as Anthropic.Messages.Tool,
      ],
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlocks = response.content.filter((b) => b.type === 'text') as Array<{ type: 'text'; text: string }>
    if (textBlocks.length === 0) {
      return { urls: [], usedTasteFilter: !!profile, error: 'Claude returned no text' }
    }
    const raw = textBlocks[textBlocks.length - 1].text
    const stripped = raw.replace(/```[a-z]*\n?/g, '').trim()
    const jsonMatch = stripped.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { urls: [], usedTasteFilter: !!profile, error: 'Claude returned invalid JSON' }

    const parsed = JSON.parse(jsonMatch[0]) as { urls?: unknown }
    if (!Array.isArray(parsed.urls)) {
      return { urls: [], usedTasteFilter: !!profile, error: 'Response missing urls array' }
    }

    const urls = (parsed.urls as unknown[])
      .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
      .filter((u, i, arr) => arr.indexOf(u) === i)
      .slice(0, 20)

    return { urls, usedTasteFilter: !!profile }
  } catch (err: unknown) {
    console.error('[findCollectionUrlsViaClaude]', err)
    return {
      urls: [],
      usedTasteFilter: !!profile,
      error: err instanceof Error ? err.message : 'Collection search failed',
    }
  }
}

// Pull a short, prompt-ready taste summary from the taste_log table.
// Mirrors the aggregation used by discoverFromTasteProfile. Returns null if
// there isn't enough data yet to be useful.
async function loadTasteProfileForFiltering(): Promise<string | null> {
  const supabase = createAdminClient()
  try {
    const { data: logs } = await supabase
      .from('taste_log')
      .select('brand_name, brand_price_tier, item_type, colour_family, material_category')
      .order('logged_at', { ascending: false })
      .limit(200)

    const rows = (logs ?? []) as Array<{
      brand_name: string | null
      brand_price_tier: number | null
      item_type: string | null
      colour_family: string | null
      material_category: string | null
    }>
    if (rows.length < 5) return null

    const brandCounts = new Map<string, number>()
    const typeCounts = new Map<string, number>()
    const colourCounts = new Map<string, number>()
    const materialCounts = new Map<string, number>()
    const tierCounts = new Map<number, number>()
    for (const r of rows) {
      if (r.brand_name) brandCounts.set(r.brand_name, (brandCounts.get(r.brand_name) ?? 0) + 1)
      if (r.item_type) typeCounts.set(r.item_type, (typeCounts.get(r.item_type) ?? 0) + 1)
      if (r.colour_family) colourCounts.set(r.colour_family, (colourCounts.get(r.colour_family) ?? 0) + 1)
      if (r.material_category) materialCounts.set(r.material_category, (materialCounts.get(r.material_category) ?? 0) + 1)
      if (r.brand_price_tier != null) tierCounts.set(r.brand_price_tier, (tierCounts.get(r.brand_price_tier) ?? 0) + 1)
    }

    const top = (m: Map<string, number>, n = 5) =>
      Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)
    const topTier = Array.from(tierCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]

    return [
      `Top brands: ${top(brandCounts, 8).join(', ') || 'none'}`,
      `Item types: ${top(typeCounts, 6).join(', ') || 'any'}`,
      `Colour families: ${top(colourCounts, 5).join(', ') || 'any'}`,
      `Materials: ${top(materialCounts, 5).join(', ') || 'any'}`,
      topTier ? `Dominant price tier: ${topTier}/5` : '',
    ].filter(Boolean).join('\n')
  } catch (err) {
    console.error('[loadTasteProfileForFiltering]', err)
    return null
  }
}

// ── Bounded concurrency ──────────────────────────────────────────────────────

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++
      results[idx] = await fn(items[idx], idx)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker)
  await Promise.all(workers)
  return results
}

// ── Batch analyse ────────────────────────────────────────────────────────────

export async function batchAnalyseUrls(
  input: string,
  mode: 'list' | 'collection',
): Promise<{ candidates?: ParsedCandidate[]; usedTasteFilter?: boolean; error?: string }> {
  try {
    let urls: string[]
    let usedTasteFilter = false
    if (mode === 'list') {
      urls = parseUrlList(input)
      if (urls.length === 0) return { error: 'Paste at least one product URL (one per line).' }
      if (urls.length > 30) return { error: `Too many URLs (${urls.length}). Limit is 30 per batch.` }
    } else {
      const single = input.trim()
      if (!/^https?:\/\//i.test(single)) {
        return { error: 'Paste a collection page URL.' }
      }
      const found = await findCollectionUrlsViaClaude(single)
      if (found.error || found.urls.length === 0) {
        return {
          error:
            found.error ??
            'Could not find product URLs from that collection. Try paste-URL mode with individual product links.',
        }
      }
      urls = found.urls
      usedTasteFilter = found.usedTasteFilter
    }

    const candidates = await mapLimit(urls, 4, async (url) => {
      const res = await analyseProductUrl(url)
      if (res.error || !res.data) {
        return { source_url: url, ok: false, error: res.error ?? 'Unknown failure' } as ParsedCandidate
      }
      return {
        source_url: url,
        ok: true,
        parsed: res.data,
      } as ParsedCandidate
    })

    return { candidates, usedTasteFilter }
  } catch (err: unknown) {
    console.error('[batchAnalyseUrls]', err)
    return { error: err instanceof Error ? err.message : 'Batch analysis failed' }
  }
}

// ── Bulk approve to drafts ───────────────────────────────────────────────────

export interface ApproveCandidatePayload {
  source_url: string
  parsed: AnalysedProduct
  image_url: string | null
}

export async function bulkApproveCandidates(
  candidates: ApproveCandidatePayload[],
): Promise<{ created?: number; failed?: number; error?: string }> {
  if (candidates.length === 0) return { created: 0, failed: 0 }

  const supabase = createAdminClient()

  try {
    // Pre-resolve brand IDs in a single pass, creating any missing brands.
    const brandNames = Array.from(
      new Set(
        candidates
          .map((c) => c.parsed.brand_name?.trim())
          .filter((n): n is string => !!n && n.length > 0),
      ),
    )

    const brandIdByName = new Map<string, string>()
    if (brandNames.length > 0) {
      const { data: existing } = await supabase
        .from('brand')
        .select('brand_id, name')
        .in('name', brandNames)
      for (const row of (existing ?? []) as Array<{ brand_id: string; name: string }>) {
        brandIdByName.set(row.name.toLowerCase(), row.brand_id)
      }
      const missing = brandNames.filter((n) => !brandIdByName.has(n.toLowerCase()))
      if (missing.length > 0) {
        const { data: created, error: brandErr } = await supabase
          .from('brand')
          .insert(missing.map((name) => ({
            name,
            price_tier: 3,
            era_orientation: 3,
            aesthetic_output: 3,
            cultural_legibility: 3,
            creative_behaviour: 3,
          })))
          .select('brand_id, name')
        if (brandErr) throw brandErr
        for (const row of (created ?? []) as Array<{ brand_id: string; name: string }>) {
          brandIdByName.set(row.name.toLowerCase(), row.brand_id)
        }
      }
    }

    // Fallback "Unknown" brand for items missing a brand entirely.
    let unknownBrandId: string | null = null
    const ensureUnknownBrand = async (): Promise<string> => {
      if (unknownBrandId) return unknownBrandId
      const { data: existing } = await supabase
        .from('brand')
        .select('brand_id')
        .ilike('name', 'unknown')
        .limit(1)
      const row = (existing ?? [])[0] as { brand_id: string } | undefined
      if (row) {
        unknownBrandId = row.brand_id
        return unknownBrandId
      }
      const { data: created, error } = await supabase
        .from('brand')
        .insert([{
          name: 'Unknown',
          price_tier: 3, era_orientation: 3, aesthetic_output: 3,
          cultural_legibility: 3, creative_behaviour: 3,
        }])
        .select('brand_id')
        .single()
      if (error) throw error
      unknownBrandId = (created as { brand_id: string }).brand_id
      return unknownBrandId
    }

    let created = 0
    let failed = 0

    // Insert one-by-one so a single bad row doesn't kill the batch.
    for (const c of candidates) {
      try {
        const brandKey = c.parsed.brand_name?.trim().toLowerCase()
        const brandId = brandKey ? brandIdByName.get(brandKey) ?? (await ensureUnknownBrand()) : await ensureUnknownBrand()

        // Persist the image to Cloudinary by passing the product URL — the helper
        // scrapes the image from the page itself, which is more reliable than
        // hot-linking the og:image URL (often blocked by retailer CDNs).
        let stableImageUrl = c.image_url ?? ''
        try {
          const upload = await scrapeAndUploadToCloudinary(c.source_url)
          if (upload.cloudinaryUrl) stableImageUrl = upload.cloudinaryUrl
        } catch {
          // Fall back to whatever raw URL the OG scrape captured.
        }

        const insertRow = {
          brand_id: brandId,
          item_type: (c.parsed.item_type ?? 'blouse') as string,
          product_name: c.parsed.product_name ?? 'UNTITLED',
          retailer_url: c.source_url,
          image_url: stableImageUrl,
          price: c.parsed.price,
          currency: c.parsed.currency,
          status: 'draft',
          source: 'web_discovery',
          in_inventory: false,
          fit: c.parsed.fit, length: c.parsed.length, rise: c.parsed.rise,
          structure: c.parsed.structure, shoulder: c.parsed.shoulder,
          waist_definition: c.parsed.waist_definition, leg_opening: c.parsed.leg_opening,
          surface: c.parsed.surface, colour_depth: c.parsed.colour_depth,
          pattern: c.parsed.pattern, sheen: c.parsed.sheen,
          colour_hex: c.parsed.colour_hex, colour_family: c.parsed.colour_family,
          material_category: c.parsed.material_category,
          material_weight: c.parsed.material_weight,
          material_formality: c.parsed.material_formality,
          material_primary: c.parsed.material_primary,
          jewellery_scale: c.parsed.jewellery_scale,
          jewellery_formality: c.parsed.jewellery_formality,
          admin_notes: 'Imported via Batch Ingest. Pre-scored by AI — review before marking ready.',
        }

        const { error: insertErr } = await supabase.from('item').insert([insertRow])
        if (insertErr) throw insertErr
        created++
      } catch (err) {
        console.error('[bulkApprove] item failed', c.source_url, err)
        failed++
      }
    }

    revalidatePath('/admin/items')
    revalidatePath('/admin/items/new')
    revalidatePath('/admin/ingest')
    return { created, failed }
  } catch (err: unknown) {
    console.error('[bulkApproveCandidates]', err)
    return { error: err instanceof Error ? err.message : 'Bulk approve failed' }
  }
}

// ── Image extraction helper ──────────────────────────────────────────────────
// Quick OG-image scrape — used to populate the image preview in the queue
// before the admin commits. Kept separate so the analyse step stays fast.

// Shopify product image straight from the store's product JSON (<url>.js). More
// reliable than og:image scraping when a brand site blocks bot fetches or renders
// client-side (e.g. Anine Bing). Returns an absolute https URL.
async function shopifyProductImage(url: string): Promise<string | null> {
  try {
    const clean = url.split('#')[0].split('?')[0].replace(/\/$/, '')
    if (!/\/products\//.test(clean)) return null
    const res = await fetch(`${clean}.js`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'application/json',
      },
      redirect: 'follow',
    })
    if (!res.ok) return null
    const data = await res.json()
    const raw: string | null = data?.featured_image ?? (Array.isArray(data?.images) ? data.images[0] : null) ?? null
    if (!raw) return null
    return raw.startsWith('//') ? `https:${raw}` : raw
  } catch {
    return null
  }
}

// One round-trip that returns BOTH the product image and its stock, so the
// review queue fills in with a single server action per item (server actions are
// serialised by Next, so halving the calls halves the wait).
export async function getIngestPreview(
  url: string,
): Promise<{ image_url: string | null; stock: 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown'; sizes: string[] }> {
  const [img, stock] = await Promise.all([scrapeProductImage(url), checkStockForUrl(url)])
  return { image_url: img.image_url ?? null, stock: (stock.status ?? 'unknown') as any, sizes: stock.sizes }
}

export async function scrapeProductImage(url: string): Promise<{ image_url?: string | null; error?: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (res.ok) {
      const html = await res.text()
      const ogMatch =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
        html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
      if (ogMatch?.[1]) return { image_url: ogMatch[1] }
    }
    // og:image missing or the page blocked us — try the Shopify product JSON.
    return { image_url: await shopifyProductImage(url) }
  } catch {
    return { image_url: await shopifyProductImage(url) }
  }
}
