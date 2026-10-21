// Press — every article written about MYRA. To add one, put a new entry at
// the TOP of PRESS (newest first); /press lists it and /press/<slug> shows it.
//
// `body` is the full article, shown on MYRA with a link out to the original.
// Only put an article's text here when the writer has said MYRA may run it in
// full; until then the page shows `summary` (MYRA's own words) and the link.

export type PressBlock =
  | string // a paragraph
  | { heading: string }
  | { quote: string }
  | { image: string; caption?: string }

export type PressArticle = {
  slug: string
  title: string
  subtitle?: string
  publication: string
  author: string
  date: string // ISO, YYYY-MM-DD
  url: string
  image?: string
  summary: string[] // MYRA's own words, a paragraph per entry
  body?: PressBlock[] // the full article, with the writer's OK
}

export const PRESS: PressArticle[] = [
  {
    slug: 'the-data-fashion-brief-cant-get-dressed',
    title: 'I’m A Fashion Data Analyst, But Still Can’t Get Dressed',
    subtitle:
      'The data behind decision fatigue, and the decision that got me dressed for Milan Fashion Week and a wedding back to back',
    publication: 'The Data Fashion Brief',
    author: 'Carmen',
    date: '2026-06-30',
    url: 'https://thedatafashionbrief.substack.com/p/i-make-my-living-studying-trends',
    image: '/press/16arlington-flora-skirt-looks.jpg',
    summary: [
      'A fashion data analyst on why knowing the trends still doesn’t make getting dressed any easier, and what the numbers say about decision fatigue.',
      'With Milan Fashion Week and a wedding back to back, Carmen turned to an early-access MYRA: describe the occasion, get a complete look from a curated set of brands, each one signed off by a stylist.',
    ],
  },
]

export function pressBySlug(slug: string) {
  return PRESS.find((a) => a.slug === slug) ?? null
}

export function formatPressDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .toUpperCase()
}
