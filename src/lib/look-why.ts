// WHY THIS SUITS YOU — one plain sentence under each of her looks.
//
// "Wide trousers and trainers, in the navy and cream you wear most." Built
// only from what she has told us (her loved shapes, pieces and colours) and
// what is actually in the look — never a guess, never the composer's scores.
// At her age the reasoning builds trust faster than more options. Pure; no
// API cost, so every look can carry one.

import {
  SHAPE_PREFERENCES, matchesColourPref, colourPrefLabel,
  type ShapeDims, type StylePrefs,
} from './pilot-stylist'

export interface WhyPiece extends ShapeDims {
  colour_family?: string | null
  product_name?: string | null
  owned?: boolean
}

// Shapes that name a garment read best, so they lead.
const GARMENT_SHAPES: Record<string, string> = {
  wide_leg: 'wide trousers',
  slim_leg: 'straight trousers',
}
const FEEL_SHAPES: Record<string, string> = {
  oversized: 'a relaxed fit',
  unstructured: 'soft, easy shapes',
  long_length: 'a longer length',
  high_neck: 'a high neckline',
  long_sleeve: 'long sleeves',
  boxy: 'an easy, boxy shape',
  defined_waist: 'a defined waist',
  high_rise: 'a high waist',
  plain: 'quiet, plain pieces',
}
const TYPE_WORDS: Record<string, string> = {
  sneaker: 'trainers', flat: 'flats', boot: 'boots', mule: 'mules', sandal: 'sandals',
  trench: 'a trench', coat: 'a coat', jacket: 'a jacket', blazer: 'a blazer', gilet: 'a gilet', cape: 'a cape',
  shirt: 'a shirt', blouse: 'a blouse', 't-shirt': 'a T-shirt', knitwear: 'knitwear',
  trousers: 'trousers', jeans: 'jeans', skirt: 'a skirt', shorts: 'shorts',
  midi_dress: 'a midi dress', maxi_dress: 'a maxi dress', shirt_dress: 'a shirt dress', slip_dress: 'a slip dress',
}

const SHAPE_BY_ID = new Map(SHAPE_PREFERENCES.map((s) => [s.id, s]))
const matchesShape = (id: string, pieces: WhyPiece[]) => {
  const shape = SHAPE_BY_ID.get(id)
  return !!shape && pieces.some((p) => shape.match(p))
}
const joinTwo = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The colour word for a preference: "OFF-WHITE / IVORY" → "off-white". */
const colourWord = (id: string) => colourPrefLabel(id).split('/')[0].trim().toLowerCase().replace(/_/g, ' ')

export const WHY_FALLBACK = 'Chosen around the pictures and pieces you love.'

export function whyThisSuitsHer(pieces: WhyPiece[], prefs: StylePrefs | null | undefined): string {
  const p = prefs ?? { colours_loved: [], colours_avoided: [], shapes_loved: [], shapes_avoided: [], types_loved: [], types_avoided: [] }
  const worn = pieces.filter(Boolean)

  // What in the look she has said she loves: garments first, then pieces, then feel.
  const phrases: string[] = []
  const add = (s: string) => { if (!phrases.includes(s)) phrases.push(s) }
  for (const id of p.shapes_loved) if (GARMENT_SHAPES[id] && matchesShape(id, worn)) add(GARMENT_SHAPES[id])
  for (const t of p.types_loved) {
    if (!TYPE_WORDS[t] || !worn.some((x) => x.item_type === t)) continue
    // "wide trousers" already says trousers.
    if ((t === 'trousers' || t === 'jeans') && phrases.some((x) => x.endsWith('trousers'))) continue
    add(TYPE_WORDS[t])
  }
  for (const id of p.shapes_loved) if (FEEL_SHAPES[id] && matchesShape(id, worn)) add(FEEL_SHAPES[id])
  const pieceText = phrases.length ? joinTwo(phrases.slice(0, 2)) : null

  // Her colours, in the order they appear in the look.
  const colours: string[] = []
  for (const piece of worn) {
    for (const id of p.colours_loved) {
      if (!matchesColourPref(id, piece)) continue
      const w = colourWord(id)
      if (!colours.includes(w)) colours.push(w)
      break
    }
  }
  const colourText = colours.length ? `in the ${joinTwo(colours.slice(0, 2))} you wear most` : null

  const own = worn.find((x) => x.owned && x.product_name)
  if (own) {
    const lead = `Built around your own ${String(own.product_name).toLowerCase()}`
    return `${lead}${pieceText ? `, with ${pieceText}` : ''}${colourText ? `, ${colourText}` : ''}.`
  }
  if (pieceText && colourText) return `${cap(pieceText)}, ${colourText}.`
  if (pieceText) return `${cap(pieceText)} — the way you like to dress.`
  if (colourText) return `Quiet pieces ${colourText}.`
  return WHY_FALLBACK
}
