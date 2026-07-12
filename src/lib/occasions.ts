// Occasion tiles shown on the Edit landing. The first six are the always-on
// base; the rest are extras that surface (and reorder) based on the user's
// taste vector, so the page rearranges itself per person.
export const OCCASION_LABELS: Record<string, string> = {
  'weekend away': 'WEEKEND AWAY',
  'summer office': 'SUMMER OFFICE ATTIRE',
  'wedding guest': 'WEDDING GUEST',
  'date night': 'DATE NIGHT',
  'city summer evening': 'CITY SUMMER EVENING',
  'casual summer weekend': 'CASUAL SUMMER WEEKEND',
  'dinner': 'DINNER',
  'garden party': 'GARDEN PARTY',
  'city break': 'CITY BREAK',
  'lunch': 'LUNCH',
  'gallery opening': 'GALLERY OPENING',
  'holiday': 'HOLIDAY',
  'boat day': 'BOAT DAY',
}

// The six always-on occasions (default order when there's no taste signal).
export const BASE_OCCASIONS = [
  'weekend away',
  'summer office',
  'wedding guest',
  'date night',
  'city summer evening',
  'casual summer weekend',
]

// Every occasion eligible to appear as a tile (base + discoverable extras).
export const CANDIDATE_OCCASIONS = Object.keys(OCCASION_LABELS)

// How many occasion tiles to show at once.
export const OCCASION_TILE_COUNT = 9

export function occasionLabel(tag: string): string {
  return OCCASION_LABELS[tag] ?? tag.toUpperCase()
}

// Some occasion chips should match MORE than their own tag — e.g. an outfit
// tagged just "office" should still surface under "summer office". Maps a chip
// tag → the set of occasion_tags that satisfy it.
const OCCASION_ALIASES: Record<string, string[]> = {
  'summer office': ['summer office', 'office'],
}
export function occasionMatchTags(tag: string): string[] {
  return OCCASION_ALIASES[tag] ?? [tag]
}
