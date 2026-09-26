// THE WORDS A NO CAN BECOME — what a piece offers when Chloe says "not that".
//
// A never is matched on words (stylist-brief `pieceText`: name, type,
// material, colour, brand). Type, colour and brand were the only chips the
// bench offered, and none of them says "not THAT kind of bracelet": a marbled
// resin cuff is wrong for Chanel, bracelets are not. So a piece also offers
// its material words and the telling words of its name — "marble", "resin",
// "cuff" — and Chloe can type one of her own. Pure and client-safe.

export type NeverAttr = 'item_type' | 'colour_family' | 'brand' | 'material' | 'word'

export interface NeverCandidate {
  attr: NeverAttr
  /** Lower-case, as pieceText writes it — what the never will match on. */
  word: string
}

export interface NeverPiece {
  product_name?: string | null
  item_type?: string | null
  colour_family?: string | null
  brand_name?: string | null
  material_primary?: string | null
}

const STOP = new Set([
  'with', 'from', 'this', 'that', 'and', 'the', 'for', 'one', 'size', 'mini', 'maxi', 'midi', 'regular', 'long', 'short',
  'womens', 'women', 'ladies', 'new', 'exclusive', 'edit', 'collection', 'style', 'piece', 'top', 'bag', 'set', 'pair',
])

/** Lower-case, underscores to spaces, punctuation gone — accented letters kept, as pieceText keeps them (Sessùn stays Sessùn). */
export const cleanWord = (s: string): string =>
  s.toLowerCase().replace(/_/g, ' ').replace(/[^a-z0-9\u00C0-\u024F' -]/g, '').replace(/\s+/g, ' ').trim()

/** The material as words: "Gold, Black Marble" → gold, black, marble. */
export function materialWords(material: string | null | undefined): string[] {
  if (!material) return []
  return Array.from(new Set(
    material.toLowerCase().split(/[,/&]|\band\b|\bor\b|\bwith\b|\s+/).map((w) => cleanWord(w)).filter((w) => w.length >= 3),
  ))
}

/** The telling words of a name: "Marbled resin cuff bracelet" → marbled, resin, cuff. */
export function nameWords(name: string | null | undefined, skip: Set<string> = new Set(), limit = 4): string[] {
  if (!name) return []
  const out: string[] = []
  for (const raw of name.toLowerCase().split(/[\s,/–—-]+/)) {
    const w = cleanWord(raw)
    if (w.length < 4 || STOP.has(w) || skip.has(w) || /^\d/.test(w) || out.includes(w)) continue
    out.push(w)
    if (out.length >= limit) break
  }
  return out
}

/** Every never this piece could become, most specific first, no word twice. */
export function neverCandidates(p: NeverPiece): NeverCandidate[] {
  const out: NeverCandidate[] = []
  const seen = new Set<string>()
  const add = (attr: NeverAttr, word: string | null | undefined) => {
    const w = word ? cleanWord(word) : ''
    if (!w || seen.has(w)) return
    seen.add(w)
    out.push({ attr, word: w })
  }
  add('item_type', p.item_type)
  add('colour_family', p.colour_family)
  add('brand', p.brand_name)
  for (const w of materialWords(p.material_primary)) add('material', w)
  const typeWords = new Set((p.item_type ?? '').toLowerCase().replace(/_/g, ' ').split(' '))
  for (const w of nameWords(p.product_name, new Set([...Array.from(seen), ...Array.from(typeWords), ...(p.colour_family ? [p.colour_family.toLowerCase()] : [])]))) add('word', w)
  return out
}
