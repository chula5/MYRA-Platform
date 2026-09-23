// MYRA Mirror — piece-level ranking for a page that is all one brand.
//
// On isabelmarant.com every tile is Isabel Marant, so brand signals separate
// nothing. Two layers rank the pieces instead:
//   1. text-only, instant — colour / type / material read from the title and
//      product type (the same rules Brand Watch uses), scored against what
//      she has TOLD us (loved / avoided colours, shapes, types) and her price
//      bands. No image, no model call, first visit works.
//   2. known items — tiles MYRA already holds an item row for (earlier takes,
//      saves, holds, Brand Watch) get the composer's full memberItemScore and
//      a masked cosine against her 34-dim taste vector.
// Unknown tiles are queued (mirror_page_product) for the nightly scoring pass,
// so a brand she visits often becomes fully piece-ranked within a day.

import 'server-only'
import { classifyExternalProduct } from '@/lib/brand-watch'
import { brandKey, brandCosine, itemPseudoVector } from '@/lib/brand-affinity'
import { lovedScore, avoidReasons, readStylePrefs, type StylePrefs } from '@/lib/pilot-stylist'
import { memberItemScore, itemPriceVerdict, type MemberTaste } from '@/lib/pilot-composer'
import { unit } from '@/lib/taste-vector'
import { learnedBonus, blendStrength, type StyleModel, type FeatureItem } from '@/lib/style-brain'
import type { PageProduct } from './rank'

/** The handle in a Shopify product URL — the same piece with or without www. or ?variant=. */
export function handleOf(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/\/products\/([^/?#]+)/i)
  return m ? decodeURIComponent(m[1]).toLowerCase() : null
}

/** Style Brain: what the curator's thousands of YES / SKIP say about a piece described only by text. In [-0.3, 0.3]. */
export function styleBrainRead(model: StyleModel | null, f: FeatureItem): { bonus: number; reason: string | null } {
  if (!model || model.decisions < 20) return { bonus: 0, reason: null }
  const b = blendStrength(model) * learnedBonus(model, [f])
  return { bonus: +b.toFixed(3), reason: b > 0.08 ? 'the kind of piece you keep' : b < -0.08 ? 'the kind of piece you skip' : null }
}

export const SINGLE_BRAND_SHARE = 0.7

/** True when one brand accounts for ≥70% of the labelled tiles. */
export function dominantBrand(products: PageProduct[]): string | null {
  const counts = new Map<string, number>()
  let labelled = 0
  for (const p of products) { const k = brandKey(p.brand ?? ''); if (!k) continue; labelled++; counts.set(k, (counts.get(k) ?? 0) + 1) }
  if (labelled < 6) return null
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
  return top && n / labelled >= SINGLE_BRAND_SHARE ? top : null
}

export interface PieceRead { text: number; reasons: string[]; pseudo: Record<string, unknown> }

/** Layer 1 — what the title and type say, against her authored prefs, price bands and (for the curator) Style Brain. In [-0.95, 0.75]. */
export function readPieceFromText(p: PageProduct, prefs: StylePrefs, taste: MemberTaste | null, brandId?: string | null, brain?: { model: StyleModel | null; priceTier?: number | null }): PieceRead {
  let scanned: ReturnType<typeof classifyExternalProduct> | null = null
  try {
    scanned = classifyExternalProduct({
      url: p.url ?? 'https://x/products/x', title: p.title ?? '', description: '', category: p.type ?? '',
      brand: p.brand ?? null, price: p.price ?? null, currency: null, images: [], available: true,
    })
  } catch { /* unreadable */ }
  const pseudo: Record<string, unknown> = {
    item_id: p.key, product_name: p.title ?? '', item_type: scanned?.itemType ?? null, colour_family: scanned?.colourFamily ?? null,
    material_primary: scanned?.materialPrimary ?? null, material_category: scanned?.materialCategory ?? null,
    price_gbp: p.price ?? null, brand_id: brandId ?? null,
  }
  const reasons: string[] = []
  let text = 0
  const loved = lovedScore(prefs, pseudo as any)
  if (loved > 0) { text += loved; reasons.push(pseudo.colour_family && prefs.colours_loved.length ? 'a colour you love' : 'a kind of piece you love') }
  const avoid = avoidReasons(prefs, pseudo as any)
  if (avoid.length) { text -= 0.5; reasons.push(`${avoid[0].toLowerCase()} — you avoid`) }
  if (taste) {
    const pv = itemPriceVerdict(taste, pseudo as any)
    if (pv === 'over') { text -= 0.15; reasons.push('over your ceiling') }
    else if (pv === 'under') { text -= 0.05 }
  }
  if (brain?.model) {
    const sb = styleBrainRead(brain.model, { item_type: pseudo.item_type as any, colour_family: pseudo.colour_family as any, brand_name: p.brand ?? null, price_tier: brain.priceTier ?? null })
    text += sb.bonus
    if (sb.reason) reasons.push(sb.reason)
  }
  return { text, reasons, pseudo }
}

/** Layer 2 — a known item: the composer's own score, normalised, blended with her taste vector when she has one. */
export function readKnownItem(item: any, taste: MemberTaste, tasteVector: number[] | null, opts: { curator?: boolean } = {}): { piece: number; reasons: string[] } {
  const raw = memberItemScore(taste, item)
  let piece = Math.max(0, Math.min(1, (raw + 0.5) / 1.9))
  const reasons: string[] = []
  // The curator kept this exact piece in MYRA's library — the clearest like there is.
  if (opts.curator && (item.status === 'ready' || item.status === 'live')) { piece = Math.min(1, piece + 0.3); reasons.push('you kept this in MYRA') }
  if (tasteVector && tasteVector.length) {
    try {
      const sim = brandCosine(unit(itemPseudoVector(item)), unit(tasteVector))
      piece = 0.7 * piece + 0.3 * Math.max(0, sim)
      if (sim > 0.6) reasons.push('close to your taste')
    } catch { /* unscored */ }
  }
  const avoid = avoidReasons(taste.prefs, item)
  if (avoid.length) reasons.push(`${avoid[0].toLowerCase()} — you avoid`)
  return { piece, reasons }
}

export { readStylePrefs }
