// In-session "skip the rest like it" for the Brand Watch queue.
//
// The keep/skip learning is deliberate and slow: it re-trains from ALL
// decisions on the next queue load. This is the fast path that works WHILE
// reviewing — skip one By Malene Birger monogram bag and the other five
// colour-and-material twins of it should be offered up as one skip, not five.
//
// Pure and deterministic so it runs client-side on the loaded queue with no
// round-trip. It only ever SUGGESTS: nothing is skipped without a tap.

export interface SimilarCandidate {
  item_id: string
  brand_name: string | null
  product_name: string
  item_type: string | null
  colour_family: string | null
  material_category: string | null
  price: string | null
}

// Same-family types read as "the same kind of thing" when a skip generalises:
// a skipped monogram shoulder bag damns the matching crossbody, not the coat.
const TYPE_FAMILY: Record<string, string> = {
  tote: 'bag', shoulder_bag: 'bag', clutch: 'bag', crossbody: 'bag', structured_bag: 'bag',
  boot: 'shoe', heel: 'shoe', flat: 'shoe', sneaker: 'shoe', mule: 'shoe', sandal: 'shoe',
  necklace: 'jewellery', earrings: 'jewellery', bracelet: 'jewellery', ring: 'jewellery', brooch: 'jewellery',
  mini_dress: 'dress', midi_dress: 'dress', maxi_dress: 'dress', shirt_dress: 'dress', slip_dress: 'dress',
}
const family = (t: string | null): string => TYPE_FAMILY[t ?? ''] ?? (t ?? '')

const STOP = new Set([
  'the', 'and', 'with', 'for', 'from', 'one', 'bag', 'small', 'mini', 'large', 'medium',
  'new', 'classic',
])

function tokens(name: string | null): Set<string> {
  const out = new Set<string>()
  for (const tok of String(name ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (tok.length >= 3 && !STOP.has(tok)) out.add(tok)
  }
  return out
}

/**
 * True when skipping `base` makes `cand` an obvious next skip. Two routes:
 *
 *   model twin   ≥2 shared name tokens in the same brand + type family —
 *                the same model line in another size or strap.
 *   look twin    same brand, same exact type, same colour family AND material,
 *                price in the same region — the "yet another one of those"
 *                case, which is what a signature monogram print produces.
 *
 * Nulls never match nulls on colour/material: two unknowns are not evidence
 * of sameness, and browser-scanned items often carry nulls.
 */
export function verySimilarToSkipped(base: SimilarCandidate, cand: SimilarCandidate): boolean {
  if (base.item_id === cand.item_id) return false
  if ((base.brand_name ?? '').toLowerCase() !== (cand.brand_name ?? '').toLowerCase()) return false
  if (family(base.item_type) !== family(cand.item_type)) return false

  const candTokens = tokens(cand.product_name)
  const shared = Array.from(tokens(base.product_name)).filter((t) => candTokens.has(t))
  if (shared.length >= 2) return true
  // Brands lead with the model name — "Loennas Shoulder Bag", "Loennas
  // Crossbody" are one line. A matching lead token is the model matching.
  const lead = (n: string | null) => String(n ?? '').toLowerCase().split(/[^a-z0-9]+/).find((t) => t.length >= 4 && !STOP.has(t))
  const bl = lead(base.product_name)
  if (bl && bl === lead(cand.product_name)) return true

  if (
    base.item_type != null &&
    base.item_type === cand.item_type &&
    base.colour_family != null &&
    base.colour_family === cand.colour_family &&
    base.material_category != null &&
    base.material_category === cand.material_category
  ) {
    const bp = parseFloat(String(base.price ?? ''))
    const cp = parseFloat(String(cand.price ?? ''))
    if (Number.isNaN(bp) || Number.isNaN(cp)) return true
    return cp >= bp * 0.5 && cp <= bp * 2
  }
  return false
}

/** Everything in the pool that the skip of `base` plausibly extends to. */
export function findSimilarToSkipped<T extends SimilarCandidate>(base: T, pool: T[]): T[] {
  return pool.filter((c) => verySimilarToSkipped(base, c))
}
