// HOW WARM IS THIS PIECE, AND DOES IT SUIT WHERE SHE IS GOING?
//
// "Trips" covers a ski week and a beach week, and the occasion model had no
// way to tell them apart — worse, the travel prior actively FAVOURS knitwear,
// so a hot holiday was answered with jumpers and boots. That is the system
// doing what it was told, not a composing failure, and the missing input is
// temperature.
//
// Climate is deliberately its own axis rather than more occasions. A heatwave
// changes what she wears to work and to dinner too, and doubling the occasion
// list to carry it would say the same thing in six places.
//
// Pure, so the gate can be tested against the real library.

export const CLIMATES = [
  { id: 'hot', label: 'HOT — 25°C AND UP', hint: 'linen, bare arms, sandals' },
  { id: 'temperate', label: 'MILD — LAYERS', hint: 'the default' },
  { id: 'cold', label: 'COLD — COAT WEATHER', hint: 'wool, boots, knits' },
] as const

export type ClimateId = (typeof CLIMATES)[number]['id']

export interface ClimateItem {
  item_type?: string | null
  /** Read for fibre words too. "Houndstooth Wool Trousers" carries its whole
   *  material story in the name and nothing in material_primary, and passed a
   *  25°C gate because only the structured fields were being read. */
  product_name?: string | null
  material_primary?: string | null
  material_category?: string | null
  material_weight?: number | null   // 1 sheer … 5 structural
  sleeve?: number | null            // 1 sleeveless … 5 full long sleeve
  length?: number | null
}

// Pieces that only make sense in the cold, whatever they are made of.
const COLD_ONLY_TYPES = new Set(['coat', 'trench', 'cape', 'boot'])
// Layers that are usually warm. With no fibre evidence at all these start
// ABOVE neutral, so a hot brief excludes them unless something says they are
// light — a linen blazer proves itself, an unlabelled wool one does not get
// the benefit of the doubt. Getting this wrong in the lenient direction puts
// a wool jacket on a beach.
const USUALLY_WARM_TYPES = new Set(['jacket', 'blazer', 'gilet', 'knitwear'])
// Pieces that only make sense in the heat.
const HOT_ONLY_TYPES = new Set(['shorts', 'sandal', 'swimwear'])
// Pieces that have no temperature. A structural leather tote read as "too
// warm" purely because its material weight is 5, and a hot holiday was left
// with 39 bags to choose from — weight means construction here, not warmth.
const WEATHERLESS_TYPES = new Set([
  'tote', 'crossbody', 'shoulder_bag', 'structured_bag', 'clutch',
  'necklace', 'earrings', 'bracelet', 'ring', 'brooch',
  'belt', 'sunglasses', 'hair_accessory',
])

const WARM_FIBRES = /wool|cashmere|merino|mohair|alpaca|shearling|tweed|fleece|down|teddy|boucl/i
const COOL_FIBRES = /linen|cotton|poplin|voile|seersucker|silk|viscose|lyocell|tencel|ramie|chambray/i

/**
 * Warmth, 1 (bare and airy) to 5 (built for the cold).
 *
 * Read from what the item already carries — type, fibre, material weight,
 * sleeve — so it needs no new data collection. It degrades gracefully: an
 * unscored piece lands at 3 and is judged on its type and fibre alone.
 */
export function warmthOf(item: ClimateItem): number {
  const type = item.item_type ?? ''
  if (WEATHERLESS_TYPES.has(type)) return 3
  if (COLD_ONLY_TYPES.has(type)) return 5
  if (HOT_ONLY_TYPES.has(type)) return 1

  let w = 3
  const fibre = `${item.material_primary ?? ''} ${item.material_category ?? ''} ${item.product_name ?? ''}`
  const noFibreEvidence = !item.material_primary && item.material_weight == null
  if (USUALLY_WARM_TYPES.has(type) && noFibreEvidence) w += 0.8
  if (WARM_FIBRES.test(fibre)) w += 1.5
  else if (COOL_FIBRES.test(fibre)) w -= 1
  if (item.material_category === 'natural_knit' || item.material_category === 'synthetic_knit') w += 0.5
  if (type === 'knitwear') w += 1

  // Material weight is the most direct reading of the three and now covers
  // most of the library, so it moves the number furthest.
  if (typeof item.material_weight === 'number') w += (item.material_weight - 3) * 0.6

  // Bare arms are cool; full sleeves are not. Only meaningful where sleeve
  // applies at all.
  if (typeof item.sleeve === 'number') w += (item.sleeve - 3) * 0.35

  return Math.max(1, Math.min(5, w))
}

// Where the line falls. A hot holiday tolerates a light knit for the evening
// but not a coat; a cold trip tolerates a cotton shirt as a layer but not a
// sundress on its own.
export const HOT_CEILING = 3.4
export const COLD_FLOOR = 2.2

/** Why this piece is wrong for the weather, or null if it is fine. */
export function climateReason(climate: ClimateId | null | undefined, item: ClimateItem): string | null {
  if (!climate || climate === 'temperate') return null
  const type = item.item_type ?? ''
  if (WEATHERLESS_TYPES.has(type)) return null
  const w = warmthOf(item)
  if (climate === 'hot') {
    if (COLD_ONLY_TYPES.has(type)) return `${type.replace(/_/g, ' ')} in 25°C`
    if (w > HOT_CEILING) return 'too warm for the heat'
    return null
  }
  if (HOT_ONLY_TYPES.has(type)) return `${type.replace(/_/g, ' ')} in coat weather`
  if (w < COLD_FLOOR) return 'too bare for the cold'
  return null
}

/** A nudge toward the right end of the range, on top of the gate. */
export function climateScore(climate: ClimateId | null | undefined, item: ClimateItem): number {
  if (!climate || climate === 'temperate') return 0
  if (WEATHERLESS_TYPES.has(item.item_type ?? '')) return 0
  const w = warmthOf(item)
  // Full marks at the airy end for hot, the padded end for cold.
  const fit = climate === 'hot' ? (3 - w) / 2 : (w - 3) / 2
  return Math.max(-0.2, Math.min(0.25, fit * 0.25))
}
