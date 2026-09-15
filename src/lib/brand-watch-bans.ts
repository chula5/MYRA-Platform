// House bans for Brand Watch — pieces that never belong on the site, whatever
// their score.
//
// Kept deliberately narrow, and checked against what Chloe actually keeps:
// a first version banning all "activewear", leopard and polka dot would have
// stopped 11 pieces she kept — ME+EM track pants, By Malene Birger capri
// leggings and an athletic skirt, a leopard ballet flat, an Agnès b. polka-dot
// petticoat skirt. So the bans are:
//   · fuchsia / hot pink (a global rule), and
//   · clearly performance sportswear — running, yoga, gym, sports bras, base
//     layers — which no one keeps for the site.
// Everything subtler (prints, fashion leggings, loungewear) is left to what
// her keeps and skips teach the learning.
//
// Activewear is read from the product's own name and type only: catalogue
// tags are shop-wide on brands like Varley and would ban their trainers.

import { isFuchsia, type HouseItem } from './house-style'

export interface BannableProduct {
  title: string | null
  productType?: string | null
  /** Raw colour names from the feed ("Magenta"). */
  optionColours?: string[] | null
  materialPrimary?: string | null
  itemType?: string | null
}

const FOOTWEAR = new Set(['sneaker', 'flat', 'boot', 'heel', 'sandal', 'mule'])

// 'yoga' unbounded: "MMYoga Biker". The rest whole-word, so "trainer" and
// "track pant" never match.
const PERFORMANCE_RE = /yoga|\b(running|gym|workout|sports? bra|base ?layer|bike shorts?|biker shorts?|cycling shorts?|compression|training (?:top|tee|short|legging|tight)s?)\b/i

/** The reason a product is banned from the site, or null if it may be considered. */
export function houseBanOf(p: BannableProduct): string | null {
  const colours = (p.optionColours ?? []).join(' ')
  const asItem: HouseItem = {
    item_id: '',
    slot: '',
    product_name: `${p.title ?? ''} ${p.productType ?? ''} ${colours}`,
    material_primary: p.materialPrimary ?? null,
  } as HouseItem
  if (isFuchsia(asItem)) return 'fuchsia / hot pink'
  if (!FOOTWEAR.has(p.itemType ?? '') && PERFORMANCE_RE.test(`${p.title ?? ''} ${p.productType ?? ''}`)) return 'sportswear'
  return null
}
