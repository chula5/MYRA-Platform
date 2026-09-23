// Diffusion lines — "Isabel Marant Étoile" is Isabel Marant, "Polo Ralph
// Lauren" is Ralph Lauren. Retailers label the line, members name the house.
// Pure: given a page label and the brand names she has signal for, find the
// house the label belongs to. Conservative on purpose — a wrong inheritance
// lifts the wrong brand on her behalf, so only two shapes qualify:
//   (a) the full house name appears in the label as whole words
//       ("isabel marant etoile", "polo ralph lauren", "ralph lauren collection")
//   (b) the label, with known line markers removed, equals the house name
//       minus its first word ("marant etoile" → "marant" ← "isabel marant")
// A single-word house ("Ganni") only ever matches by (a), never by (b).

import { brandKey } from '@/lib/brand-affinity'

/** Words that mark a line, not a house. Short and explicit — never generic words. */
export const LINE_MARKERS = new Set([
  'etoile', 'polo', 'lauren', 'collection', 'purple', 'black', 'label', 'denim', 'jeans',
  'sport', 'kids', 'homme', 'femme', 'petite', 'curve', 'plus', 'beauty', 'eyewear', 'home',
  'rrl', 'double', 'rl', 'see', 'by', 'red', 'valentino', 'weekend', 'emporio', 'ea7', 'exchange',
  'pour', 'la', 'le', 'les', 'de', 'di',
])

/** Houses whose first word is an article or a generic noun have no meaningful "short" form: "Row" is not The Row. */
const NO_SHORT_FORM = new Set(['the', 'maison', 'house', 'atelier', 'studio', 'la', 'le', 'les', 'de', 'di', 'a', 'by'])

/** A city or "studio" on the end of a name is an address, not a different house: "DA LUNA" is "Da Luna London". */
const PLACE_WORDS = new Set(['london', 'paris', 'milano', 'milan', 'copenhagen', 'stockholm', 'nyc', 'ny', 'york', 'new', 'studio', 'studios', 'official', 'uk'])
const stripPlace = (w: string[]) => { const out = w.slice(); while (out.length > 1 && PLACE_WORDS.has(out[out.length - 1])) out.pop(); return out }

const words = (s: string) => brandKey(s).split(' ').filter(Boolean)

/** Whole-word containment: every word of `needle` appears in order, contiguously, in `hay`. */
function containsSeq(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

export interface LineMatch { house: string; via: 'same' | 'contains' | 'short' }

/**
 * Which of `houses` does `label` belong to as a line? `houses` are brand names
 * (display form; keyed internally). Returns null when the label IS a house
 * (exact match — the caller already handles that) or belongs to none.
 */
export function houseForLine(label: string, houses: Iterable<string>): LineMatch | null {
  const labelWords = words(label)
  if (!labelWords.length) return null
  const labelKey = labelWords.join(' ')
  const stripped = labelWords.filter((w) => !LINE_MARKERS.has(w))

  let best: { match: LineMatch; len: number } | null = null
  for (const house of houses) {
    const hw = words(house)
    if (!hw.length) continue
    const hk = hw.join(' ')
    if (hk === labelKey) return null // it is the house, not a line of it
    let via: LineMatch['via'] | null = null
    // Same house, with or without its city: inherit in full (the caller applies no discount for 'same').
    const core = stripPlace(hw)
    // One-word houses qualify too when the word is distinctive enough ("WYSE London" ≡ "WYSE").
    if (core.join(' ') === stripPlace(labelWords).join(' ') && (core.length >= 2 || core[0].length >= 4)) via = 'same'
    else if (containsSeq(labelWords, hw)) via = 'contains'
    else if (hw.length >= 2 && !NO_SHORT_FORM.has(hw[0]) && stripped.length && stripped.join(' ') === hw.slice(1).join(' ')) via = 'short'
    if (!via) continue
    // Prefer the longest house name — "Lauren Ralph Lauren" belongs to Ralph Lauren, not to a house called "Lauren".
    if (!best || hw.length > best.len) best = { match: { house, via }, len: hw.length }
  }
  return best?.match ?? null
}

/** How much of the house's score a line inherits. */
export const LINE_FACTOR = 0.9
