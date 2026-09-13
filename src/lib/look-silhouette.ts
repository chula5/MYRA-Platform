/**
 * The silhouette key SIMILAR matches on and EXPLORE deliberately differs on.
 *
 * Lifted out of the feed's related-actions so the client area and the feed
 * answer "similar" the same way. Two implementations of this rule would drift,
 * and then Explore Styles would mean one thing on the home page and another
 * on hers.
 *
 *   SIMILAR  → same occasion + SAME silhouette
 *   EXPLORE  → same occasion + DIFFERENT silhouette
 *
 * Guaranteed disjoint, which is the point: the two rows never repeat each other.
 */

const LONG_DRESSES = ['maxi_dress', 'midi_dress', 'shirt_dress']
const DRESSES = ['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress']
const BOTTOMS = ['skirt', 'trousers', 'jeans', 'shorts']

export function silhouetteOf(types: (string | null | undefined)[]): string {
  const t = types.filter(Boolean).map(String)

  const dress = t.find((x) => DRESSES.includes(x))
  if (dress) return LONG_DRESSES.includes(dress) ? 'dress-long' : 'dress-short'

  const bottom = t.find((x) => BOTTOMS.includes(x))
  if (bottom === 'skirt') return 'skirt'
  if (bottom === 'shorts') return 'shorts'
  if (bottom === 'trousers' || bottom === 'jeans') return 'trousers'

  return 'other'
}
