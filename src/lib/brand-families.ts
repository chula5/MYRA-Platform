// BRAND FAMILIES FOR COMPOSING: which brands may share a look.
//
// The families ARE the onboarding brand groups (src/app/onboarding/
// brand-groups.ts): one group, one family, keyed by the group's `key`. Each
// brand in a family carries a PRICE BRACKET, authored here by hand — the
// brand table's own price data can't be trusted for this (2026-10-27: TOTEME's
// median read £63 from mis-priced bags, Max Mara's came from one necklace, and
// price_tier is 3 for 329 of 371 brands).
//
// Two rules, both used by the Outfit Review recipe (lib/review-compose):
//   1. FAMILY — a garment, shoe or bag shares the anchor's family. Bags, Shoes,
//      Jewellery and Hats are FINISH families: any look's shoes, bag or
//      jewellery may come from them (a Le Monde Béryl flat under The Row is
//      right), never its clothes (Chan Luu trousers under a Phoebe Philo coat
//      were not). Denim, Second-hand and Rental go anywhere.
//      A brand in no family never joins a familied anchor's look; an anchor in
//      no family is held by the bracket alone.
//   2. BRACKET — every bracketed brand in the look sits within one bracket of
//      every other (luxury with designer, never luxury with contemporary).
//
// Chloe, 2026-10-27: "why is phoebe philo matching with me&em? should match
// with toteme, khaite, kallmeyer" — "the families should reflect the
// onboarding families really and then add the price bracket to them".

import { BRAND_GROUPS } from '@/app/onboarding/brand-groups'

/** 1 HIGH STREET · 2 CONTEMPORARY · 3 DESIGNER · 4 LUXURY — what a knit or a pair of trousers costs. */
export type Bracket = 1 | 2 | 3 | 4
export const BRACKET_NAMES: Record<Bracket, string> = { 1: 'HIGH STREET', 2: 'CONTEMPORARY', 3: 'DESIGNER', 4: 'LUXURY' }

/** Families that finish any look rather than define one — its shoes, bag and jewellery only. */
export const FINISH_FAMILIES = new Set(['finish', 'shoes', 'jewellery', 'hats'])
/** Families whose pieces sit in any look, clothes included. */
export const ANYWHERE_FAMILIES = new Set(['denim', 'preloved', 'rental'])
/** The slots a finish family may fill. */
const FINISH_SLOTS = new Set(['shoe', 'bag', 'jewellery'])

/**
 * Price bracket per brand, per family. Every brand in a garment, bag or shoe
 * group has one (the brand-families test holds that); jewellery, hats,
 * second-hand and rental carry none and so never trip the bracket rule.
 */
export const FAMILY_BRACKETS: Record<string, Record<string, Bracket>> = {
  parisian: {
    'Sézane': 2, 'Isabel Marant': 3, 'Sandro': 2, 'Maje': 2, 'Claudie Pierlot': 2, 'ba&sh': 2, 'A.P.C': 2, 'Soeur': 2,
    'Rouje': 2, 'Sessùn': 2, 'Ami Paris': 3, 'Jacquemus': 3, 'Vanessa Bruno': 2, 'Agnès b.': 2, 'Tara Jarmon': 2,
    'Gerard Darel': 2, 'Antik Batik': 2, 'Loulou de Saison': 2, 'Alfie Paris': 2, 'La Veste': 2, 'Mes Demoiselles': 2,
    'Maison Magdalena': 2, 'Louise Misha': 2, 'J’amemme': 2, 'Posse': 2,
  },
  quiet_luxury: {
    'The Row': 4, 'Khaite': 4, 'Totême': 3, 'Phoebe Philo': 4, 'Lemaire': 3, 'Jil Sander': 4, 'Róhe': 3, 'Fforme': 3,
    'St. Agni': 2, 'Max Mara': 3, 'Gabriela Hearst': 4, 'Brunello Cucinelli': 4, 'Victoria Beckham': 3,
    'Tibi': 3, 'Altuzarra': 3, 'Nili Lotan': 3, 'Horton New York': 3, 'Maria McManus': 3, 'Linnea Lund': 3,
    'Conor O’Brien Studio': 3, 'ARMA': 3, 'N.A Studio': 2, 'Iris von Arnim': 3, 'Soft Goat': 2, '6397': 2,
    'Kallmeyer': 3, 'Malknstudio': 2, 'NiiHAi': 2, 'Heirlome': 3, 'Colleen Allen': 3, 'CO Core': 3, 'Bevza': 3,
    'Almada Label': 2, 'Cmmn Swdn': 3, 'The Label Edition': 2, 'Aflalo': 2, 'Kulakovsky': 3, 'Tae Park': 3,
  },
  tailoring: {
    'ME+EM': 2, 'Wyse': 2, 'Whistles': 1, 'Joseph': 3, 'Jigsaw': 1, 'Toast': 2, 'Aligne': 1, 'Baukjen': 1,
    'Mint Velvet': 1, 'Massimo Dutti': 1, 'Vince': 2, 'Veronica Beard': 3, 'Max&Co': 2, 'Twinset': 2,
    'Adolfo Domínguez': 2, 'Leem': 1, 'Serena Bute': 2, 'Tory Burch': 3, 'Brora': 2, 'Rae Feather': 2,
    'Kindred of Ireland': 2, 'Lisa Yang': 3, 'palmer//harding': 3, 'Giuliva Heritage': 3, 'DA LUNA London': 2,
    'Front Row Shop': 1, 'Attega': 2, 'Vivere London': 2, 'Jovonna London': 2,
  },
  romantic: {
    'Zimmermann': 3, 'Erdem': 4, 'Emilia Wickstead': 4, 'Self-Portrait': 2, 'Ulla Johnson': 3, 'Roland Mouret': 3,
    'Oscar de la Renta': 4, 'Markarian': 4, 'Taller Marmo': 3, 'Sea New York': 2, 'Simone Rocha': 4,
    'Alexandra Grecco': 3, 'Carla Zampatti': 2, 'HAI': 3, 'Love Stories': 2, 'Caroline Constas': 3, 'Cinq à Sept': 2,
    'CAMI NYC': 2, 'Silvia Tcherassi': 3, 'Maygel Coronel': 3, 'Maria de la Orden': 2, 'Leo Lin': 2,
    'Wiederhoeft': 4, 'Conner Ives': 3, 'Andreeva': 2, 'Ashlyn': 3, 'Dé Rococo': 2, 'Rejina Pyo': 3,
  },
  contemporary: {
    'Rixo': 2, 'La DoubleJ': 3, 'Farm Rio': 2, 'Alémais': 2, 'Etro': 4, 'Sister Jane': 1, 'Damson Madder': 1,
    'Essentiel Antwerp': 2, 'Bimba y Lola': 2, 'Christopher John Rogers': 4, 'Ganni': 2, 'Stine Goya': 2,
    'AMLUL': 2, 'Anna Sui': 2, 'Siedrés': 2, 'ViX Paula Hermanny': 2, 'Ciao Lucia': 2, 'Gimaguas': 2,
    'Paloma Wool': 2, 'Bernadette Antwerp': 3, 'Naya Rea': 2, 'Elle Sasson': 2, 'With Jéan': 1,
  },
  designer: {
    'Chanel': 4, 'Dior': 4, 'Saint Laurent': 4, 'Chloé': 4, 'Bottega Veneta': 4, 'Loewe': 4, 'Prada': 4,
    'Miu Miu': 4, 'Celine': 4, 'Alaïa': 4, 'Lanvin': 4, 'Ferragamo': 4, 'Hermès': 4, 'Gucci': 4, 'Valentino': 4,
    'Fendi': 4, 'Givenchy': 4, 'Stella McCartney': 4, 'Missoni': 4, 'Yves Salomon': 4,
  },
  directional: {
    'Dries Van Noten': 4, 'Marni': 4, 'JW Anderson': 3, 'Proenza Schouler': 4, 'Issey Miyake': 3, 'Roksanda': 4,
    'Christopher Esber': 3, 'A.W.A.K.E. Mode': 3, 'Comme des Garçons': 4, 'Toga': 3, 'Rachel Comey': 3,
    'Jacques Wei': 3, 'Bode': 4, 'Nanushka': 3, 'Diotima': 3, 'EENK': 3, 'Shushu/Tong': 3, 'Forte Forte': 3,
    'Dunst': 2, 'Darkpark': 3, 'Georgia Hardinge': 2, 'Insomnia Studio': 2, 'No Emotions': 2, 'Nocturne': 2,
    'Halfboy': 3, 'Destree': 3, 'Macabla': 2, 'Pointe Milou': 2, 'Rise & Fall': 2,
  },
  scandi: {
    'Acne Studios': 3, 'By Malene Birger': 3, 'Skall Studio': 2, 'Baum und Pferdgarten': 2, 'Munthe': 2,
    'Rabens Saloner': 2, 'Stella Nova': 2, 'House of Dagmar': 2, 'Mos Mosh': 1, 'TOVE': 3, 'Rhúne': 2,
    'Djerf Avenue': 1, 'OpéraSPORT': 2, 'Our Legacy': 3, 'Tivioli': 2, 'Caro Editions': 2, 'MKDT Studio': 2,
    'Stand Studio': 3, 'Holzweiler': 3, 'Utzon': 2,
  },
  denim: {
    'Agolde': 2, 'Frame': 2, 'Mother': 2, 'Citizens of Humanity': 2, 'Re/Done': 3, 'Levi’s': 1, 'R13': 3,
    'Paige': 2, 'Diesel': 2, 'Haikure': 2, 'Tressé': 2, 'Fortela': 3,
  },
  california: {
    'Reformation': 2, 'Dôen': 2, 'Anine Bing': 2, 'Free People': 1, 'Éterne': 2, 'Simon Miller': 2, 'Varley': 2,
    'Staud': 2, 'Cult Gaia': 3, 'L’Académie': 2, 'Apparis': 1,
  },
  australian: {
    'DISSH': 1, 'SIR.': 2, 'Bec + Bridge': 2, 'Aje': 2, 'Acler': 2, 'Camilla and Marc': 2, 'Scanlan Theodore': 3,
    'Faithfull the Brand': 1, 'Spell': 2, 'Matteau': 2, 'VRG GRL': 1,
  },
  night: {
    'The Attico': 4, '16Arlington': 3, 'Magda Butrym': 4, 'Rat & Boa': 2, 'De La Vali': 2, 'Simkhai': 3,
    'Rotate': 2, 'David Koma': 4, 'Nensi Dojaka': 4, 'Mônot': 3, 'Seam': 2, 'Studio83': 2, 'Scarlet & Sam': 2,
    'Redondo Brand': 2, 'Rumored': 2, 'Saint Art': 2, 'Sloan': 2, 'The Veil': 2,
  },
  finish: {
    'Polène': 2, 'DeMellier': 2, 'Strathberry': 2, 'Mansur Gavriel': 3, 'Anya Hindmarch': 3, 'Métier': 4,
    'Liffner': 2, 'Chylak': 2, 'Elleme': 2, 'Hunting Season': 3, 'Freja': 2, 'MOI&SASS': 1, 'Advene': 3,
    'Mélisse': 2, 'Sarah’s Bag': 3, 'Sensi Studio': 2, 'Furla': 2, 'JW Pei': 1, 'Déhanche': 2,
  },
  shoes: {
    'Manolo Blahnik': 4, 'Aquazzura': 4, 'Roger Vivier': 4, 'Amina Muaddi': 4, 'Aeyde': 3, 'Le Monde Béryl': 3,
    'Loeffler Randall': 2, 'Emme Parsons': 3, 'Anonymous Copenhagen': 2, 'A.Emery': 2, 'Jude': 2,
    'Florrie London': 2, 'Herbert Levine': 3, 'Giaborghini': 3, 'Edward Meller': 3, 'Nomasei': 3, 'Carel': 2,
    'Jonak': 1, 'Bobbies': 1, 'Capulette Paris': 2, 'Roberto Festa': 3,
  },
}

/** Brand-table names that aren't the group's spelling of the same label. */
const NAME_ALIASES: Record<string, string> = {
  'Zimmermannwear': 'Zimmermann', 'heirlome.com': 'Heirlome', 'BODE New York': 'Bode', 'Bec and Bridge': 'Bec + Bridge',
  'DE LA VALI OFFICIAL': 'De La Vali', 'Taller Marmo Store': 'Taller Marmo', 'THE POSSE': 'Posse',
  'frame-denim': 'Frame', 'AMI': 'Ami Paris', 'manseur gavriel': 'Mansur Gavriel', 'FARM RIO ACTIVE': 'Farm Rio',
}

/** Accent-, case- and punctuation-blind: TOTEME = Totême, Jil sander = Jil Sander. */
export function familyKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

const FAMILY_BY_BRAND = new Map<string, string>()
const BRACKET_BY_BRAND = new Map<string, Bracket>()
for (const g of BRAND_GROUPS) {
  for (const b of [...g.brands, ...(g.more ?? [])]) FAMILY_BY_BRAND.set(familyKey(b), g.key)
}
for (const [, brands] of Object.entries(FAMILY_BRACKETS)) {
  for (const [b, bracket] of Object.entries(brands)) BRACKET_BY_BRAND.set(familyKey(b), bracket)
}
for (const [alias, canonical] of Object.entries(NAME_ALIASES)) {
  const k = familyKey(canonical)
  if (FAMILY_BY_BRAND.has(k)) FAMILY_BY_BRAND.set(familyKey(alias), FAMILY_BY_BRAND.get(k)!)
  if (BRACKET_BY_BRAND.has(k)) BRACKET_BY_BRAND.set(familyKey(alias), BRACKET_BY_BRAND.get(k)!)
}

/** A brand by name, or a brand row — whose `aliases` are read too (Lisa Yang Store, TOVE Studio). */
export type BrandRef = string | { name?: string | null; aliases?: string[] | null } | null | undefined

function lookup<T>(ref: BrandRef, map: Map<string, T>): T | null {
  if (!ref) return null
  const names = typeof ref === 'string' ? [ref] : [ref.name, ...(ref.aliases ?? [])]
  for (const n of names) {
    const hit = n ? map.get(familyKey(n)) : undefined
    if (hit != null) return hit
  }
  return null
}

/** The onboarding group a brand belongs to, or null when it is in none. */
export function brandFamily(ref: BrandRef): string | null {
  return lookup(ref, FAMILY_BY_BRAND)
}

export function brandBracket(ref: BrandRef): Bracket | null {
  return lookup(ref, BRACKET_BY_BRAND)
}

/**
 * May a piece by `candidate` fill `slot` in a look anchored by `anchor`? Same
 * family; a finish family in a finish slot; an anywhere family; or an anchor
 * that is itself in no family or an anywhere/finish one — and brackets within
 * one of each other.
 */
export function familyFits(anchor: BrandRef, candidate: BrandRef, slot: string): boolean {
  const fa = brandFamily(anchor)
  const fc = brandFamily(candidate)
  const familyOk =
    fa == null || ANYWHERE_FAMILIES.has(fa) || FINISH_FAMILIES.has(fa) ||
    fa === fc ||
    (fc != null && ANYWHERE_FAMILIES.has(fc)) ||
    (fc != null && FINISH_FAMILIES.has(fc) && FINISH_SLOTS.has(slot))
  return familyOk && !bracketSpreadViolation([anchor, candidate])
}

/** True when two bracketed brands in the look sit more than one bracket apart. */
export function bracketSpreadViolation(brands: BrandRef[]): boolean {
  const b = brands.map(brandBracket).filter((x): x is Bracket => x != null)
  return b.length > 1 && Math.max(...b) - Math.min(...b) > 1
}
