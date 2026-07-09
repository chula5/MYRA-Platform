'use server'

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase-server'

export interface ScannableBrand {
  brand_id: string
  name: string
  itemCount: number
}

export interface CollectionCandidate {
  title: string
  brand_name: string | null
  retailer_url: string | null
  image_url: string | null
  price: string | null
  currency: string | null
  why_interesting: string | null
}

export interface CollectionScan {
  brand: string
  collection_name: string | null
  is_new: boolean
  note: string | null
  candidates: CollectionCandidate[]
  error?: string
}

// Brands the user has actually added (have ≥1 item in the library), most-stocked
// first. These are the clickable list to scan for new collections.
export async function listBrandsForScan(): Promise<{ brands: ScannableBrand[]; error?: string }> {
  const admin = createAdminClient()
  try {
    const { data: items } = await admin.from('item').select('brand_id').not('brand_id', 'is', null).limit(50000)
    const counts = new Map<string, number>()
    for (const r of (items ?? []) as { brand_id: string | null }[]) {
      if (r.brand_id) counts.set(r.brand_id, (counts.get(r.brand_id) ?? 0) + 1)
    }
    const { data: brands } = await admin.from('brand').select('brand_id, name')
    const rows: ScannableBrand[] = ((brands ?? []) as { brand_id: string; name: string }[])
      .map((b) => ({ brand_id: b.brand_id, name: b.name, itemCount: counts.get(b.brand_id) ?? 0 }))
      .filter((b) => b.itemCount > 0 && b.name.trim().toLowerCase() !== 'unknown')
      .sort((a, b) => b.itemCount - a.itemCount || a.name.localeCompare(b.name))
    return { brands: rows }
  } catch (err) {
    console.error('[listBrandsForScan]', err)
    return { brands: [], error: err instanceof Error ? err.message : 'Failed to load brands' }
  }
}

// Scrape a product page's og:image (the web-search agent rarely returns a
// usable direct image URL, so we fall back to the retailer page's preview image).
async function ogImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (!res.ok) return null
    const html = await res.text()
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
    const found = m?.[1] ?? null
    return found && /^https?:\/\//i.test(found) ? found : null
  } catch {
    return null
  }
}

const SCAN_SYSTEM = `You are a fashion buyer for a high-taste wardrobe assistant called MYRA. Your job is to check whether a given brand has recently launched a NEW collection (or fresh new-arrivals drop) and, if so, surface the standout new pieces.

Use web search to find the most recent collection / newest arrivals available to buy right now.

CRITICAL — the retailer_url for each piece MUST be a SPECIFIC PRODUCT DETAIL PAGE (a single product), NOT a collection, category, campaign, lookbook, or homepage URL. Every candidate must have its OWN distinct product URL — never reuse the same URL for multiple pieces.
- Strongly prefer product pages on major multi-brand stockists — Net-a-Porter, MyTheresa, FWRD, Moda Operandi, Shopbop, SSENSE, Farfetch, MatchesFashion — because each of their product pages has a distinct product image. Use the brand's own site only if you can find a genuine per-product page.
- Verify each URL is real and resolvable via your search results. If you cannot find a real distinct product page for a piece, omit that piece rather than guessing.

Taste bar: editorial, directional, well-made. Pick the pieces a discerning stylist would actually build outfits around — not the entire catalogue.

Return ONLY valid JSON, no markdown, no code fences:
{
  "collection_name": "the collection/season name if you can identify it, else null",
  "is_new": true/false,   // true if this looks like a genuinely recent/new drop
  "note": "one short sentence on what's new (or why nothing new was found)",
  "candidates": [
    {
      "title": "product name",
      "brand_name": "the brand",
      "retailer_url": "a real, verified, DISTINCT product-detail URL (one product)",
      "image_url": "a direct product image URL if findable, else null",
      "price": "number-only string e.g. 480",
      "currency": "GBP | USD | EUR",
      "why_interesting": "one sentence on the piece"
    }
  ]
}

Return up to 8 candidates, each with a unique product URL. If you genuinely cannot find a recent collection, set is_new=false and return an empty candidates array.`

// Web-search agent: does this brand have a new collection? Returns the new
// pieces. NOT persisted — the caller holds them in session and the user accepts
// the ones they like (which then run through the ingest→compose pipeline).
export async function scanBrandCollection(brandName: string): Promise<CollectionScan> {
  const name = (brandName ?? '').trim()
  if (!name) return { brand: name, collection_name: null, is_new: false, note: null, candidates: [], error: 'No brand' }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { brand: name, collection_name: null, is_new: false, note: null, candidates: [], error: 'ANTHROPIC_API_KEY not configured' }

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SCAN_SYSTEM,
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 6 } as unknown as Anthropic.Messages.Tool,
      ],
      messages: [
        {
          role: 'user',
          content: `Brand: ${name}\n\nCheck whether ${name} has launched a new collection or fresh new-arrivals recently, and surface the standout new pieces available to buy now. Return the JSON.`,
        },
      ],
    })

    const textBlocks = response.content.filter((b) => b.type === 'text') as Array<{ type: 'text'; text: string }>
    if (textBlocks.length === 0) return { brand: name, collection_name: null, is_new: false, note: null, candidates: [], error: 'No response' }
    const raw = textBlocks[textBlocks.length - 1].text.replace(/```[a-z]*\n?/g, '').trim()
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return { brand: name, collection_name: null, is_new: false, note: null, candidates: [], error: 'Invalid response' }

    const parsed = JSON.parse(match[0]) as {
      collection_name?: string | null
      is_new?: boolean
      note?: string | null
      candidates?: CollectionCandidate[]
    }
    const candidates = (parsed.candidates ?? []).filter((c) => c && c.title)

    // Backfill missing images from each retailer page's og:image (concurrently).
    const enriched = await Promise.all(candidates.map(async (c) => {
      if (c.image_url && /^https?:\/\//i.test(c.image_url)) return c
      const url = (c.retailer_url ?? '').trim()
      if (!/^https?:\/\//i.test(url)) return c
      const img = await ogImage(url)
      return img ? { ...c, image_url: img } : c
    }))

    // Guard against campaign heroes: if the SAME image resolves for more than one
    // piece, it's a shared collection/lookbook image (not the product), so null
    // those out rather than showing the same photo on every card.
    const imgCounts = new Map<string, number>()
    for (const c of enriched) if (c.image_url) imgCounts.set(c.image_url, (imgCounts.get(c.image_url) ?? 0) + 1)
    const deduped = enriched.map((c) => (c.image_url && (imgCounts.get(c.image_url) ?? 0) > 1 ? { ...c, image_url: null } : c))

    return {
      brand: name,
      collection_name: parsed.collection_name ?? null,
      is_new: parsed.is_new ?? deduped.length > 0,
      note: parsed.note ?? null,
      candidates: deduped,
    }
  } catch (err) {
    console.error('[scanBrandCollection]', err)
    return { brand: name, collection_name: null, is_new: false, note: null, candidates: [], error: err instanceof Error ? err.message : 'Scan failed' }
  }
}
