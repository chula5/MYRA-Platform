// PRICE POINT — the pieces of one look cost about the same.
//
// Chloe, 2026-11-12, on Review looks: "someone who buys a £1,700 skirt won't
// be wearing Fbrq", "a £40 jumper with the Erdem skirt — a big no no", an
// £855 Erdem knit over a £230 skirt: "try a less expensive jumper, max like
// 500", and a £557 ME+EM bag under Erdem: "another high-end brown bag".
// Brand price_tier cannot hold that (it is 3 for 358 of 400 brands) and many
// brands carry no authored bracket, so the pieces' own prices decide: put on
// one scale (a coat costs about twice a knit, a bag half as much again), the
// dearest piece may cost at most PRICE_SPREAD times the cheapest. The
// authored brand brackets (lib/brand-families) still hold beside it.

import { priceOfItem } from '@/lib/brand-affinity'
import { bracketSpreadViolation } from '@/lib/brand-families'

/** What a slot's piece costs beside a knit or a pair of trousers of the same standing. */
const PRICE_SCALE: Record<string, number> = { outerwear: 2.2, dress: 1.4, top: 1, bottom: 1, shoe: 1.1, bag: 1.6 }
/** On that scale, the dearest piece of a look may cost this many times the cheapest (£855 over £230 is 3.7; £500 over £230 is 2.2). */
export const PRICE_SPREAD = 2.6

export interface PricedPiece {
  slot: string
  price?: unknown
  price_gbp?: unknown
  currency?: unknown
  brand?: { name?: string | null; aliases?: string[] | null; source_type?: string | null } | null
}

/** The piece's price on the knit scale; null when it has none or is an accessory. A second-hand price counts too: a £2,198 vintage bag is no partner for a £247 knit. */
export function pricePoint(p: PricedPiece): number | null {
  const scale = PRICE_SCALE[p.slot]
  if (!scale) return null
  const { gbp } = priceOfItem(p)
  return gbp != null && gbp > 0 ? gbp / scale : null
}

/** True when the look mixes price points, by the pieces' prices or by their brands' authored brackets. */
export function pricePointViolation(pieces: PricedPiece[]): boolean {
  const points = pieces.map(pricePoint).filter((x): x is number => x != null)
  if (points.length > 1 && Math.max(...points) / Math.min(...points) > PRICE_SPREAD) return true
  return bracketSpreadViolation(pieces.map((p) => p.brand))
}
