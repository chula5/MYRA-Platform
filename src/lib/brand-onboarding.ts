// BRAND ONBOARDING — how a shop gets onto the watchlist.
//
// Chloe, from the Mirror: straight on, full scan, every on-taste piece queued
// with its confidence score. Anyone else: MYRA reads the catalogue, judges it
// by the rules in brand-onboarding-rules.ts, and either watches it, says no,
// or sets it aside for Chloe with the numbers. Either way nothing enters the
// library by itself — the queue and its confidence bar do that work.
//
// No session here: the Mirror route calls this on behalf of a member, the
// admin actions call it for Chloe. See myra-server-action-gating.

import { revalidatePath } from 'next/cache'
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase-server'
import { toGbpAmount } from '@/lib/currency'
import {
  baselineBrand, classifyExternalProduct, detectStoreCurrency, fetchCatalogue, foldBrandName, houseBanFor, normaliseBaseUrl,
  onboardBrand, provisionalNameFromUrl, vendorMode,
  type BrandCheckResult, type ScannedProduct, type WatchedBrandRow,
} from '@/lib/brand-watch'
import { discoverProductUrls, fetchNewProductPages } from '@/lib/brand-watch-browser'
import { blockedName, summariseCatalogue, verdictFor, type CatalogueAssessment } from '@/lib/brand-onboarding-rules'

/** Shopify pages the scanner will read before giving up: 40 × 250. */
const SHOPIFY_CEILING = 40 * 250
/** Browser route: the sitemap read stops here, so a shop this size is at least this size. */
const BROWSER_URL_CEILING = 6000
/** Browser route: product pages read for the judgement (each is a fetch). */
const BROWSER_SAMPLE = 60

// ── ADD AND SCAN ─────────────────────────────────────────────────────────────

/** The scan itself — Shopify first, then the browser route. */
export async function scanNewBrand(admin: any, watched: WatchedBrandRow, mode: 'watch' | 'full'): Promise<BrandCheckResult> {
  const finish = async (result: BrandCheckResult) => {
    await admin.from('watched_brand').update({ scan_state: { running: false } }).eq('watched_brand_id', watched.watched_brand_id)
    revalidatePath('/admin/brand-watch')
    return result
  }
  try {
    return await finish(mode === 'full' ? await onboardBrand(watched) : await baselineBrand(watched))
  } catch (shopifyError) {
    const urls = await discoverProductUrls(watched.base_url).catch(() => [] as string[])
    if (urls.length >= 10) {
      await admin.from('watched_brand').update({ platform: 'browser', min_score: 0 }).eq('watched_brand_id', watched.watched_brand_id)
      const browserWatched = { ...watched, platform: 'browser' as const, min_score: 0 }
      const result = mode === 'full' ? await onboardBrand(browserWatched) : await baselineBrand(browserWatched)
      return await finish({ ...result, note: `not Shopify — switched to the browser route (sitemap + JSON-LD). ${result.note ?? ''}`.trim() })
    }
    // Neither route works — take the row back off the watchlist.
    await admin.from('watched_brand').delete().eq('watched_brand_id', watched.watched_brand_id)
    revalidatePath('/admin/brand-watch')
    throw shopifyError
  }
}

/**
 * Put a shop on the watchlist and start its first scan in the background.
 * Returns as soon as the row exists; the scan clears its own running flag.
 */
export async function createWatchedBrandAndScan(
  admin: any, baseUrl: string, mode: 'watch' | 'full',
): Promise<{ watchedBrandId?: string; name?: string; error?: string }> {
  const base = normaliseBaseUrl(baseUrl)
  if (!base) return { error: 'That doesn’t look like a URL' }
  const { data: exists } = await admin.from('watched_brand').select('watched_brand_id, name').eq('base_url', base).limit(1)
  if ((exists ?? []).length) return { watchedBrandId: exists[0].watched_brand_id, name: exists[0].name, error: 'Already on the watchlist' }

  const provisional = provisionalNameFromUrl(base)
  const { data: created, error } = await admin.from('watched_brand')
    .insert([{ name: provisional, base_url: base, scan_state: { running: true, started_at: new Date().toISOString() } }])
    .select('*').single()
  if (error || !created) return { error: error?.message ?? 'Could not create watchlist row' }
  const watched = created as WatchedBrandRow

  const work = (async () => {
    try {
      await scanNewBrand(admin, watched, mode)
    } catch (err) {
      await admin.from('watched_brand')
        .update({ scan_state: { running: false, error: err instanceof Error ? err.message : String(err) } })
        .eq('watched_brand_id', watched.watched_brand_id)
    }
  })()
  try { waitUntil(work) } catch { /* local dev: the promise simply runs */ }
  revalidatePath('/admin/brand-watch')
  return { watchedBrandId: watched.watched_brand_id, name: provisional }
}

// ── THE JUDGEMENT ────────────────────────────────────────────────────────────

/** Whether MYRA already knows this label, and whether a member named it. */
async function knownAndFavourite(admin: any, host: string, brandName: string | null): Promise<{ knownBrand: boolean; memberFavourite: boolean }> {
  const names = new Set<string>()
  if (brandName) names.add(foldBrandName(brandName))
  names.add(foldBrandName(provisionalNameFromUrl(`https://${host}`)))
  const wanted = Array.from(names).filter(Boolean)
  if (!wanted.length) return { knownBrand: false, memberFavourite: false }

  let knownBrand = false
  const { data: brands } = await admin.from('brand').select('name, aliases').limit(2000)
  for (const b of (brands ?? []) as any[]) {
    const all = [b.name, ...((b.aliases ?? []) as string[])].map(foldBrandName)
    if (all.some((n) => wanted.includes(n))) { knownBrand = true; break }
  }

  let memberFavourite = false
  const { data: members } = await admin.from('pilot_member').select('brands, brands_input_only').limit(1000)
  for (const m of (members ?? []) as any[]) {
    const named = [
      ...((Array.isArray(m.brands) ? m.brands : []) as any[]).map((b) => (typeof b === 'string' ? b : b?.name)),
      ...((m.brands_input_only ?? []) as string[]),
    ].filter(Boolean).map((n: string) => foldBrandName(n))
    if (named.some((n) => wanted.includes(n))) { memberFavourite = true; break }
  }
  return { knownBrand, memberFavourite }
}

/** Read a shop's catalogue and reduce it to the numbers the rules judge. Throws only when nothing at all could be read. */
export async function assessShop(admin: any, baseUrl: string, host: string): Promise<CatalogueAssessment> {
  let products: ScannedProduct[]
  let route: 'shopify' | 'browser'
  let total: number
  let hitCap: boolean
  let brandName: string | null
  let currency: string | null = null

  try {
    products = await fetchCatalogue(baseUrl)
    route = 'shopify'
    total = products.length
    hitCap = products.length >= SHOPIFY_CEILING
    brandName = vendorMode(products)
    currency = await detectStoreCurrency(baseUrl)
  } catch {
    const urls = await discoverProductUrls(baseUrl).catch(() => [] as string[])
    if (urls.length < 10) {
      return {
        host, brandName: null, route: 'unreadable', total: urls.length, sampled: 0, fashion: 0, fashionShare: 0,
        onTaste: 0, onTasteShare: 0, medianPriceGbp: null, knownBrand: false, memberFavourite: false, hitCatalogueCap: false,
      }
    }
    route = 'browser'
    total = urls.length
    hitCap = urls.length >= BROWSER_URL_CEILING
    const read = await fetchNewProductPages(baseUrl, new Set(), { maxPages: BROWSER_SAMPLE })
    products = read.parsed.map((p) => classifyExternalProduct(p))
    const names = new Map<string, number>()
    for (const p of read.parsed) if (p.brand) names.set(p.brand, (names.get(p.brand) ?? 0) + 1)
    brandName = Array.from(names.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }

  const { knownBrand, memberFavourite } = await knownAndFavourite(admin, host, brandName)
  return summariseCatalogue({
    host, brandName, route, total, knownBrand, memberFavourite, hitCatalogueCap: hitCap,
    products: products.map((p) => ({
      score: p.score,
      nonFashion: p.nonFashion,
      menswear: p.menswear,
      banned: !!houseBanFor(p),
      priceGbp: toGbpAmount(p.price, p.currency ?? currency),
    })),
  })
}

// ── ONE REQUEST, START TO FINISH ─────────────────────────────────────────────

/**
 * Decide a Mirror request. Runs in the background after the route answers.
 * Writes the verdict, the note and the numbers on the request row; watches the
 * shop when the answer is yes.
 */
export async function handleSiteRequest(requestId: string, opts: { byAdmin: boolean }): Promise<void> {
  const admin = createAdminClient() as any
  const { data: row } = await admin.from('mirror_site_request').select('*').eq('request_id', requestId).maybeSingle()
  if (!row) return
  const finish = async (patch: Record<string, unknown>) => {
    await admin.from('mirror_site_request').update({ ...patch, assessed_at: new Date().toISOString() }).eq('request_id', requestId)
    revalidatePath('/admin/brand-watch')
  }

  const base = normaliseBaseUrl(`https://${row.host}`)
  if (!base) { await finish({ status: 'declined', verdict: 'declined', verdict_note: 'Not a shop address', decided_by: 'myra' }); return }

  const { data: exists } = await admin.from('watched_brand').select('watched_brand_id, name').eq('base_url', base).maybeSingle()
  if (exists) {
    await finish({ status: 'watching', verdict: 'accepted', verdict_note: `Already on the watchlist as ${exists.name}`, watched_brand_id: exists.watched_brand_id, decided_by: 'myra' })
    return
  }

  // Chloe from her own Mirror: no gate. On the list, full scan, pieces scored.
  if (opts.byAdmin) {
    const r = await createWatchedBrandAndScan(admin, base, 'full')
    if (r.error && !r.watchedBrandId) { await finish({ status: 'open', verdict: 'unreadable', verdict_note: r.error, decided_by: 'myra' }); return }
    await finish({ status: 'watching', verdict: 'admin', verdict_note: 'Added by Chloe from the Mirror — full scan running', watched_brand_id: r.watchedBrandId, decided_by: 'chloe' })
    return
  }

  const blocked = blockedName(row.host)
  if (blocked) {
    await finish({ status: 'declined', verdict: 'declined', verdict_note: `High street / fast fashion — MYRA doesn't carry ${blocked}`, decided_by: 'myra' })
    return
  }

  let assessment: CatalogueAssessment
  try {
    assessment = await assessShop(admin, base, row.host)
  } catch (e) {
    await finish({ status: 'open', verdict: 'unreadable', verdict_note: e instanceof Error ? e.message : String(e), decided_by: 'myra' })
    return
  }
  const v = verdictFor(assessment)
  const common = { verdict: v.verdict, verdict_note: v.reason, assessment, decided_by: 'myra' }

  if (v.verdict === 'accepted') {
    const r = await createWatchedBrandAndScan(admin, base, 'full')
    if (r.error && !r.watchedBrandId) { await finish({ ...common, status: 'open', verdict: 'unreadable', verdict_note: r.error }); return }
    await finish({ ...common, status: 'watching', watched_brand_id: r.watchedBrandId })
    return
  }
  if (v.verdict === 'declined') { await finish({ ...common, status: 'declined' }); return }
  // review / unreadable: stays open, for Chloe, with the numbers.
  await finish({ ...common, status: 'open' })
}

/** Plain words for the Mirror, from a request row and whether the shop is watched. */
export function siteRequestMessage(row: { status?: string | null; verdict?: string | null; verdict_note?: string | null } | null, watchedName: string | null): string {
  if (watchedName) return `MYRA is learning ${watchedName} — its pieces are being scored now.`
  if (!row) return ''
  if (row.status === 'assessing') return 'MYRA is reading the shop…'
  if (row.status === 'declined') return row.verdict_note ? `MYRA won't carry this shop. ${row.verdict_note}.` : "MYRA won't carry this shop."
  if (row.verdict === 'unreadable') return "MYRA can't read this shop yet — Chloe will look at it."
  if (row.verdict === 'review') return 'Set aside for Chloe to look at.'
  return 'Passed on to MYRA. She’ll take a look.'
}
