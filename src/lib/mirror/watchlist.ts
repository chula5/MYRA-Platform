// MYRA Mirror — the watchlist for a shop that cannot be scanned.
//
// Brand Watch reads a catalogue from a server: Shopify's /products.json, or a
// sitemap walk. Some shops answer neither. Massimo Dutti returns an Akamai bot
// challenge for every product page, its sitemaps are gzipped and hold a
// handful of URLs with no UK market at all, and its catalogue API is 403 — so
// the watchlist row was created and deleted again on every attempt.
//
// A `platform = 'mirror'` row is the third route and fetches nothing. Her own
// browser is already past the bot wall, so the pieces she walks through arrive
// from the extension and land in the same queue, with the same house score and
// the same dedupe, as a brand that was scanned.

import 'server-only'
import { toGbpAmount } from '@/lib/currency'
import { seasonOf } from '@/lib/season'
import {
  classifyExternalProduct, fetchKnownForBrand, houseBanFor, isKnown, resolveBrandId,
  type WatchedBrandRow,
} from '@/lib/brand-watch'
import { urlHash } from '@/lib/brand-watch-browser'

/** What the extension sees on a tile — the rank payload, plus its picture. */
export interface MirrorSeenProduct {
  url?: string | null
  title?: string | null
  brand?: string | null
  type?: string | null
  price?: number | null
  image?: string | null
  available?: boolean | null
}

/** New pieces queued from one page visit. More than this is a catalogue, not a browse. */
const PER_VISIT = 40

const hostKey = (h: string) => h.replace(/^www\./i, '').toLowerCase()

// The watchlist is a few dozen rows and this runs on every ranked page, so the
// lookup is cached rather than asked for each time.
let fedCache: { at: number; byHost: Map<string, WatchedBrandRow> } | null = null
const FED_TTL = 5 * 60_000

/** The mirror-fed watchlist row for this host, if she watches it that way. */
export async function mirrorFedBrandFor(admin: any, host: string | null | undefined): Promise<WatchedBrandRow | null> {
  if (!host) return null
  if (!fedCache || Date.now() - fedCache.at > FED_TTL) {
    const byHost = new Map<string, WatchedBrandRow>()
    try {
      const { data } = await admin.from('watched_brand').select('*').eq('platform', 'mirror').eq('active', true)
      for (const w of (data ?? []) as WatchedBrandRow[]) {
        try { byHost.set(hostKey(new URL(w.base_url).host), w) } catch { /* a row with no usable URL */ }
      }
    } catch { /* pre-0075: no mirror platform yet — nothing is fed */ }
    fedCache = { at: Date.now(), byHost }
  }
  return fedCache.byHost.get(hostKey(host)) ?? null
}

export function forgetMirrorFedBrands() { fedCache = null }

/**
 * The currency a page product is priced in. The extension reads a number off
 * the tile with no currency beside it, and guessing GBP everywhere is how a
 * €250 piece becomes £250 in the queue — so only a storefront that says it is
 * British counts, and everything else stays unpriced rather than wrong.
 */
function currencyFor(url: string): string | null {
  try {
    const u = new URL(url)
    if (/\.co\.uk$/i.test(u.host) || /\.uk$/i.test(u.host)) return 'GBP'
    if (/^\/(gb|uk)(\/|$)|^\/en-(gb|uk)(\/|$)/i.test(u.pathname)) return 'GBP'
  } catch { /* not a URL we can read */ }
  return null
}

/**
 * Queue what she just walked past, for a brand MYRA can only see through her
 * browser. Deduped against the library and the queue exactly as a scan is, so
 * re-visiting the same page all week adds nothing twice.
 *
 * Never throws: this rides along with ranking a page, and a shop she is
 * browsing must not break because its queue is unhappy.
 */
export async function queueMirrorProducts(
  admin: any,
  watched: WatchedBrandRow,
  products: MirrorSeenProduct[],
): Promise<number> {
  try {
    const candidates = products
      .filter((p): p is MirrorSeenProduct & { url: string; title: string; image: string } =>
        typeof p.url === 'string' && /^https?:\/\//.test(p.url)
        && typeof p.title === 'string' && p.title.trim().length > 1
        && typeof p.image === 'string' && /^https?:\/\//.test(p.image))
    if (!candidates.length) return 0

    const scanned = candidates.map((p) => ({
      raw: p,
      product: classifyExternalProduct({
        url: p.url, title: p.title, description: '', category: p.type ?? '',
        brand: p.brand ?? watched.name, price: p.price ?? null, currency: null,
        images: [p.image], available: p.available !== false,
      }),
    }))

    // The gates a scan applies before anything reaches the queue, plus the
    // brand's own bar — her min_score. Without it the feed would queue every
    // wearable thing on the page rather than the ones Brand Watch would keep.
    const fashion = scanned.filter(({ product }) =>
      !product.nonFashion && !product.menswear && !houseBanFor(product) && product.score >= (watched.min_score ?? 5))
    if (!fashion.length) return 0

    const brandId = watched.brand_id ?? (await resolveBrandId(admin, watched.name))
    if (!watched.brand_id) {
      await admin.from('watched_brand').update({ brand_id: brandId }).eq('watched_brand_id', watched.watched_brand_id)
    }
    const known = await fetchKnownForBrand(admin, brandId)

    const rows = fashion
      .filter(({ raw, product }) => !isKnown(known, { pid: urlHash(raw.url), url: raw.url, name: raw.title, colour: product.colourFamily }))
      // Up to PER_VISIT NEW pieces each visit, so coming back all week walks
      // deeper into the page instead of re-reading the same first tiles.
      .slice(0, PER_VISIT)
      .map(({ raw, product }) => {
        const currency = currencyFor(raw.url)
        const season = seasonOf({
          tags: [], title: raw.title, productType: raw.type ?? '', itemType: product.itemType,
          materialCategory: product.materialCategory, materialPrimary: product.materialPrimary,
        })
        return {
          watched_brand_id: watched.watched_brand_id,
          brand_id: brandId,
          shopify_product_id: urlHash(raw.url),
          shopify_handle: null,
          product_name: raw.title.slice(0, 300),
          retailer_url: raw.url.split('?')[0],
          image_url: raw.image,
          price: raw.price != null ? String(raw.price) : null,
          currency,
          price_gbp: toGbpAmount(raw.price ?? null, currency),
          item_type: product.itemType,
          colour_family: product.colourFamily,
          material_category: product.materialCategory,
          material_primary: product.materialPrimary,
          stock_status: raw.available === false ? 'out_of_stock' : 'in_stock',
          stock_sizes: [] as string[],
          season: season.season,
          season_code: season.code,
          discovery_score: product.score,
          discovered_at: new Date().toISOString(),
          admin_notes: `MYRA Mirror ${product.score > 0 ? '+' : ''}${product.score} — seen on ${watched.name} while browsing; this shop cannot be scanned.`,
        }
      })
    if (!rows.length) return 0

    let { error } = await admin.from('brand_watch_queue').insert(rows)
    // Pre-0073 the season columns are not there yet: queue without them.
    if (error && /season/.test(error.message)) {
      ;({ error } = await admin.from('brand_watch_queue').insert(rows.map(({ season: _s, season_code: _c, ...r }) => r)))
    }
    if (error) return 0

    await admin.from('watched_brand')
      .update({ last_checked_at: new Date().toISOString(), last_new_count: rows.length })
      .eq('watched_brand_id', watched.watched_brand_id)
    return rows.length
  } catch {
    return 0
  }
}
