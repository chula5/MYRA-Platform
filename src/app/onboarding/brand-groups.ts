// Curated brand groups shown during new-user onboarding (step 1).
// Grouped by aesthetic + price point. Built from brands actually stocked
// in MYRA's catalogue. Edit freely — these are a taste signal, not a filter.

export interface BrandGroup {
  key: string
  name: string
  blurb: string
  brands: string[]
}

export const BRAND_GROUPS: BrandGroup[] = [
  {
    key: 'parisian',
    name: 'Parisian / French-Girl',
    blurb: 'Effortless, understated, a little undone',
    brands: ['Sézane', 'Claudie Pierlot', 'Sandro', 'ba&sh', 'Soeur', 'A.P.C'],
  },
  {
    key: 'quiet_luxury',
    name: 'Quiet Luxury / Minimalist',
    blurb: 'Clean lines, fine fabrics, no logos',
    brands: ['Totême', 'Lemaire', 'Róhe', 'Tibi', 'St. Agni', 'House of Dagmar'],
  },
  {
    key: 'tailoring',
    name: 'Modern Tailoring / Workwear',
    blurb: 'Sharp, polished, ready for anything',
    brands: ['Max Mara', 'Joseph', 'Vince', 'Veronica Beard', 'ME+EM', 'Whistles'],
  },
  {
    key: 'romantic',
    name: 'Romantic & Feminine',
    blurb: 'Florals, volume, a sense of occasion',
    brands: ['Zimmermann', 'Simone Rocha', 'Erdem', 'Emilia Wickstead', 'Ulla Johnson', 'Magda Butrym'],
  },
  {
    key: 'contemporary',
    name: 'Bold & Contemporary',
    blurb: 'Colour, print and a bit of fun',
    brands: ['Rixo', 'Staud', 'Cult Gaia', 'Bec + Bridge', 'Posse', 'La DoubleJ'],
  },
  {
    key: 'designer',
    name: 'Designer / Luxury',
    blurb: 'The investment pieces',
    brands: ['Khaite', 'Loewe', 'Bottega Veneta', 'Jacquemus', 'Chloé', 'Saint Laurent'],
  },
  {
    key: 'directional',
    name: 'Directional / Avant-Garde',
    blurb: 'Considered, architectural, fashion-forward',
    brands: ['Dries Van Noten', 'Jil Sander', 'JW Anderson', 'Proenza Schouler', 'Christopher Esber'],
  },
]

// Age ranges — shown at onboarding (step 2) and used to tag outfits in admin.
export const AGE_RANGES = ['25-30', '30-40', '40-50', '50-60', '60-70', '70+'] as const
export type AgeRange = (typeof AGE_RANGES)[number]
