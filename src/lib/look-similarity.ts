/**
 * How alike two looks are, from what a client can actually see in them.
 *
 * Explore Styles on her page searches her OWN looks rather than composing, so
 * likeness has to be computable from the look rows themselves — no taste
 * vector, no library lookup, no round trip. Shared pieces dominate because a
 * repeated piece is the thing she notices; brands carry the house feel; the
 * occasion is a tiebreak, not a claim of similarity on its own.
 */

import { silhouetteOf } from './look-silhouette'

export interface SimilarityLook {
  occasion_label?: string
  items: { item_id?: string | null; brand?: string | null; item_type?: string | null }[]
}

const PIECE_WEIGHT = 0.6
const BRAND_WEIGHT = 0.3
const OCCASION_WEIGHT = 0.1

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let shared = 0
  a.forEach((v) => { if (b.has(v)) shared += 1 })
  return shared / Math.max(a.size, b.size)
}

const pieceIds = (l: SimilarityLook) =>
  new Set(l.items.map((i) => i.item_id).filter(Boolean) as string[])
const brandNames = (l: SimilarityLook) =>
  new Set(l.items.map((i) => (i.brand ?? '').trim().toLowerCase()).filter(Boolean))

export function lookSimilarity(a: SimilarityLook, b: SimilarityLook): number {
  return overlap(pieceIds(a), pieceIds(b)) * PIECE_WEIGHT
    + overlap(brandNames(a), brandNames(b)) * BRAND_WEIGHT
    + (a.occasion_label && a.occasion_label === b.occasion_label ? OCCASION_WEIGHT : 0)
}

/** The n looks most like `look`, never including itself, never unrelated ones. */
export function mostSimilar<T extends SimilarityLook & { look_id: string }>(
  look: T,
  pool: T[],
  n = 6,
): T[] {
  return pool
    .filter((l) => l.look_id !== look.look_id)
    .map((l) => ({ l, s: lookSimilarity(look, l) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.l)
}


/**
 * SIMILAR LOOKS and EXPLORE STYLES, by the feed's rule.
 *
 * Both stay within the anchor's occasion; SIMILAR keeps the silhouette,
 * EXPLORE deliberately changes it. The two sets are disjoint, so the buttons
 * never show her the same row twice. Ordering inside each set falls back to
 * lookSimilarity, which is the only part the feed does differently — it has a
 * whole live library to rank against, she has her own looks.
 */
export function relatedLooks<T extends SimilarityLook & { look_id: string }>(
  look: T,
  pool: T[],
  mode: 'similar' | 'explore',
  n = 6,
): T[] {
  const anchor = silhouetteOf(look.items.map((i) => i.item_type))
  return pool
    .filter((l) => l.look_id !== look.look_id)
    .filter((l) => !look.occasion_label || l.occasion_label === look.occasion_label)
    .filter((l) => {
      const sig = silhouetteOf(l.items.map((i) => i.item_type))
      return mode === 'similar' ? sig === anchor : sig !== anchor
    })
    .sort((a, b) => lookSimilarity(look, b) - lookSimilarity(look, a))
    .slice(0, n)
}

/** Her other looks wearing one particular piece — "style this item". */
export function looksWearing<T extends SimilarityLook & { look_id: string }>(
  itemId: string,
  pool: T[],
  excludeLookId?: string,
): T[] {
  return pool.filter(
    (l) => l.look_id !== excludeLookId && l.items.some((i) => i.item_id === itemId),
  )
}
