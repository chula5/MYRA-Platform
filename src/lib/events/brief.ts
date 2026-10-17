// EVENT BRIEF — her words for an occasion, read onto the taxonomy.
//
// "A cocktail dress, probably long" / "let's find a short one" / "something
// black, not too dressy". Deterministic and small: the search parser
// (lib/search-taxonomy) reads colours, materials and garment words; this adds
// what an event needs on top — the LENGTH of a dress, how dressed the night
// is, and what the event's own name says when the brief says nothing.
//
// Pure: no I/O, no model. Tested in __tests__/event-brief.test.ts.

import { parseQuery } from '@/lib/search-taxonomy'

export const DRESS_TYPES = ['mini_dress', 'midi_dress', 'maxi_dress', 'slip_dress', 'shirt_dress'] as const
export type DressLength = 'short' | 'midi' | 'long'
/** How the place will feel in that month, from its usual daytime high. */
export type Climate = 'cold' | 'cool' | 'mild' | 'warm' | 'hot'

// ── Where, and what the weather does there ───────────────────────────────────
//
// An event named after a place ("Florence", "Edinburgh", "a wedding in
// Ibiza") says something about what to wear before she says anything: the
// month's usual daytime high there. No weather service is asked (a cron
// cannot wait on one, and a trip in December is cold every year); the
// table holds the places her clients go, twelve typical daytime highs each
// (°C, January first). A place not in it reads as no climate at all.
const PLACES: Record<string, number[]> = {
  // Britain and Ireland
  london: [8, 9, 12, 15, 18, 21, 24, 23, 20, 16, 11, 9],
  edinburgh: [7, 7, 9, 12, 15, 17, 19, 19, 17, 13, 9, 7],
  glasgow: [7, 7, 9, 12, 15, 18, 19, 19, 17, 13, 9, 7],
  manchester: [7, 8, 10, 13, 16, 19, 21, 20, 18, 14, 10, 8],
  bath: [8, 9, 11, 14, 17, 20, 22, 22, 19, 15, 11, 9],
  cotswolds: [7, 8, 11, 14, 17, 20, 22, 22, 19, 14, 10, 8],
  cornwall: [9, 9, 11, 13, 15, 18, 20, 20, 18, 15, 12, 10],
  'lake district': [6, 7, 9, 12, 15, 18, 19, 19, 16, 12, 9, 7],
  highlands: [6, 6, 8, 11, 14, 16, 18, 18, 15, 12, 8, 6],
  dublin: [8, 8, 10, 12, 15, 18, 20, 19, 17, 14, 10, 8],
  // France
  paris: [7, 8, 12, 16, 20, 23, 25, 25, 21, 16, 11, 8],
  nice: [13, 13, 15, 17, 21, 24, 27, 28, 25, 21, 16, 13],
  cannes: [13, 13, 15, 17, 21, 24, 27, 28, 25, 21, 16, 13],
  'st tropez': [12, 13, 15, 17, 21, 25, 28, 28, 25, 20, 15, 13],
  'saint tropez': [12, 13, 15, 17, 21, 25, 28, 28, 25, 20, 15, 13],
  monaco: [13, 13, 15, 17, 21, 24, 27, 28, 25, 21, 16, 13],
  bordeaux: [10, 12, 15, 17, 21, 24, 27, 27, 24, 19, 13, 10],
  lyon: [7, 9, 13, 17, 21, 25, 28, 27, 23, 17, 11, 7],
  provence: [11, 12, 15, 18, 22, 26, 29, 29, 25, 20, 14, 11],
  // Italy
  florence: [11, 13, 16, 19, 24, 28, 32, 32, 27, 21, 15, 11],
  rome: [12, 13, 16, 19, 23, 28, 31, 31, 27, 22, 17, 13],
  milan: [6, 9, 14, 18, 23, 27, 30, 29, 25, 18, 11, 6],
  venice: [7, 9, 13, 17, 22, 26, 28, 28, 24, 18, 12, 8],
  naples: [13, 13, 16, 18, 23, 27, 30, 30, 27, 22, 17, 14],
  amalfi: [13, 13, 15, 18, 22, 26, 29, 30, 26, 22, 17, 14],
  positano: [13, 13, 15, 18, 22, 26, 29, 30, 26, 22, 17, 14],
  capri: [12, 12, 14, 17, 21, 25, 28, 29, 26, 21, 16, 13],
  'lake como': [6, 9, 13, 17, 22, 26, 29, 28, 24, 18, 11, 7],
  como: [6, 9, 13, 17, 22, 26, 29, 28, 24, 18, 11, 7],
  puglia: [12, 13, 15, 18, 23, 27, 30, 30, 26, 22, 17, 13],
  sicily: [15, 15, 17, 19, 23, 27, 30, 31, 28, 24, 20, 16],
  palermo: [15, 15, 17, 19, 23, 27, 30, 31, 28, 24, 20, 16],
  tuscany: [11, 13, 16, 19, 24, 28, 32, 32, 27, 21, 15, 11],
  // Spain and Portugal
  madrid: [10, 12, 16, 18, 22, 28, 32, 31, 26, 19, 13, 10],
  barcelona: [14, 15, 16, 18, 21, 25, 28, 28, 26, 22, 17, 14],
  seville: [16, 18, 21, 23, 27, 32, 36, 35, 31, 26, 20, 17],
  mallorca: [15, 16, 17, 19, 23, 27, 30, 31, 27, 23, 19, 16],
  majorca: [15, 16, 17, 19, 23, 27, 30, 31, 27, 23, 19, 16],
  ibiza: [15, 15, 17, 19, 22, 26, 29, 30, 27, 23, 19, 16],
  marbella: [16, 17, 18, 20, 23, 26, 29, 29, 27, 23, 19, 17],
  lisbon: [15, 16, 18, 19, 22, 25, 28, 28, 26, 22, 18, 15],
  porto: [14, 15, 17, 18, 20, 23, 25, 25, 24, 21, 17, 14],
  algarve: [16, 16, 18, 20, 22, 25, 28, 28, 26, 23, 19, 16],
  // The rest of Europe
  amsterdam: [6, 7, 10, 14, 18, 20, 22, 22, 19, 15, 10, 7],
  brussels: [6, 7, 11, 14, 18, 21, 23, 23, 20, 15, 10, 7],
  berlin: [3, 5, 9, 15, 19, 22, 25, 24, 20, 14, 8, 4],
  munich: [3, 5, 9, 14, 19, 22, 24, 24, 19, 14, 7, 4],
  vienna: [3, 5, 10, 16, 21, 24, 26, 26, 21, 15, 8, 4],
  prague: [2, 4, 9, 15, 20, 23, 25, 25, 20, 14, 7, 3],
  budapest: [3, 6, 11, 17, 22, 25, 28, 27, 22, 16, 9, 4],
  copenhagen: [3, 3, 6, 11, 16, 19, 22, 21, 18, 12, 7, 4],
  stockholm: [0, 0, 4, 10, 16, 20, 23, 21, 16, 10, 5, 1],
  oslo: [0, 0, 4, 10, 16, 20, 22, 21, 16, 9, 3, 0],
  reykjavik: [2, 3, 3, 6, 10, 12, 14, 14, 11, 7, 4, 2],
  zurich: [3, 5, 10, 14, 19, 22, 25, 24, 20, 14, 8, 4],
  geneva: [4, 6, 11, 15, 20, 24, 27, 26, 21, 15, 9, 5],
  athens: [13, 14, 16, 20, 25, 30, 33, 33, 29, 23, 18, 14],
  mykonos: [14, 14, 16, 19, 23, 27, 28, 28, 26, 22, 18, 15],
  santorini: [14, 14, 16, 19, 23, 27, 29, 29, 26, 22, 18, 15],
  crete: [15, 16, 17, 20, 24, 28, 30, 30, 27, 23, 20, 17],
  istanbul: [9, 9, 11, 16, 21, 26, 28, 28, 25, 20, 15, 11],
  // Snow
  courchevel: [-1, 0, 3, 7, 12, 16, 19, 19, 15, 10, 4, 0],
  verbier: [0, 1, 4, 8, 13, 17, 20, 19, 15, 10, 4, 1],
  'val d isere': [-1, 0, 3, 7, 12, 16, 19, 18, 14, 9, 3, -1],
  zermatt: [0, 1, 4, 8, 13, 17, 19, 19, 15, 10, 4, 1],
  'st anton': [0, 1, 5, 9, 14, 17, 19, 19, 15, 10, 4, 1],
  'st moritz': [-1, 0, 3, 7, 12, 16, 18, 18, 14, 9, 3, 0],
  chamonix: [3, 5, 9, 13, 18, 21, 24, 23, 19, 14, 7, 4],
  // Further
  'new york': [4, 6, 10, 17, 22, 27, 30, 29, 25, 18, 12, 7],
  manhattan: [4, 6, 10, 17, 22, 27, 30, 29, 25, 18, 12, 7],
  'los angeles': [20, 20, 21, 22, 23, 25, 28, 29, 28, 26, 23, 20],
  miami: [24, 25, 26, 28, 30, 31, 32, 32, 31, 29, 27, 25],
  chicago: [0, 2, 8, 15, 21, 27, 29, 28, 24, 17, 9, 2],
  'san francisco': [14, 16, 17, 18, 19, 20, 20, 21, 22, 21, 18, 14],
  'las vegas': [14, 17, 21, 26, 32, 38, 41, 40, 35, 28, 20, 14],
  toronto: [-1, 0, 5, 12, 19, 24, 27, 26, 22, 14, 8, 2],
  'mexico city': [22, 23, 26, 27, 27, 25, 24, 24, 23, 23, 22, 22],
  tulum: [27, 28, 30, 32, 33, 33, 33, 33, 32, 30, 28, 27],
  dubai: [24, 25, 28, 33, 38, 40, 41, 41, 39, 35, 30, 26],
  marrakech: [18, 20, 23, 25, 29, 33, 37, 37, 32, 28, 22, 19],
  'cape town': [26, 27, 25, 23, 20, 18, 18, 18, 19, 21, 24, 25],
  tokyo: [10, 10, 13, 19, 23, 26, 29, 31, 27, 22, 17, 12],
  'hong kong': [19, 19, 22, 25, 29, 30, 31, 31, 30, 28, 24, 20],
  singapore: [30, 31, 32, 32, 32, 32, 31, 31, 31, 31, 31, 30],
  bali: [31, 31, 31, 32, 31, 30, 30, 30, 31, 32, 32, 31],
  maldives: [30, 30, 31, 31, 31, 30, 30, 30, 30, 30, 30, 30],
  sydney: [26, 26, 25, 23, 20, 17, 17, 18, 20, 22, 24, 25],
  melbourne: [26, 26, 24, 20, 17, 14, 14, 15, 17, 20, 22, 24],
}
const PLACE_NAMES = Object.keys(PLACES).sort((a, b) => b.length - a.length)
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The place an event is named after, if MYRA knows it: "Florence" → florence. */
export function readPlace(label: string): string | null {
  const t = ` ${norm(label).replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, ' ').replace(/\s+/g, ' ')} `
  return PLACE_NAMES.find((name) => t.includes(` ${name} `)) ?? null
}

/** The month (1–12) an event date names — a day or a month ("2026-12"). */
export function monthOf(eventDate?: string | null): number | null {
  const m = Number((eventDate ?? '').split('-')[1])
  return m >= 1 && m <= 12 ? m : null
}

/** How a known place feels in a month, from its usual daytime high. */
export function climateOf(place: string | null, month: number | null): Climate | null {
  if (!place || !month || !PLACES[place]) return null
  const high = PLACES[place][month - 1]
  if (high < 9) return 'cold'
  if (high < 16) return 'cool'
  if (high < 23) return 'mild'
  if (high < 29) return 'warm'
  return 'hot'
}

/** "Edinburgh" as it is said: the table's key, each word capitalised. */
export function sayPlace(place: string): string {
  return place.split(' ').map((w) => (w === 'd' ? "d'" : w === 'st' ? 'St' : w.charAt(0).toUpperCase() + w.slice(1))).join(' ').replace("d' ", "d'")
}

export interface EventBrief {
  /** Hero garment types to look for, best first. Always non-empty. */
  itemTypes: string[]
  /** Colour families she named, if any (a hard preference while something matches). */
  colours: string[]
  /** Material tags she named ("satin", "lace"). */
  materials: string[]
  /** Dress length read from her words, when she gave one. */
  length: DressLength | null
  /** A dressed-up night: a cocktail, black tie, a party, New Year's Eve. */
  dressy: boolean
  /** True when nothing in the brief or the label asked for a dress in particular. */
  defaulted: boolean
  /** The place the event is named after, when MYRA knows it (see PLACES). */
  place: string | null
  /** The month of the event (1–12), when its date says one. */
  month: number | null
  /** How that place feels in that month — what the pieces should be ready for. */
  climate: Climate | null
}

const LONG_WORDS = /\b(long|longer|floor[- ]length|full[- ]length|maxi|gown|ankle[- ]length)\b/
const SHORT_WORDS = /\b(short|shorter|mini|above the knee)\b/
const MIDI_WORDS = /\b(midi|knee[- ]length|mid[- ]length|tea[- ]length)\b/
const DRESSY_WORDS = /\b(cocktail|black[- ]tie|gala|ball|evening|party|new year|nye|wedding|formal|glam|glamorous|dressy|celebration|christmas party|awards)\b/
const DRESS_WORD = /\b(dress|dresses|gown|frock)\b/
// An event whose name alone says "a dress": a party, a wedding, a night out.
const DRESS_EVENT = /\b(party|wedding|new year|nye|ball|gala|black tie|cocktail|dinner|drinks|date|christmas|birthday|celebration|awards|prom)\b/

const norm = (s: string) => (s ?? '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()

function lengthOf(text: string): DressLength | null {
  // Explicit midi first ("mid-length"), then long, then short — "not too
  // long, a short one" is rare enough that the plainer read wins.
  if (MIDI_WORDS.test(text)) return 'midi'
  if (LONG_WORDS.test(text)) return 'long'
  if (SHORT_WORDS.test(text)) return 'short'
  return null
}

function dressTypesFor(length: DressLength | null, dressy: boolean): string[] {
  if (length === 'long') return ['maxi_dress', 'midi_dress', 'slip_dress']
  if (length === 'short') return ['mini_dress']
  if (length === 'midi') return ['midi_dress', 'slip_dress']
  // No length: a dressed-up night leans long, a daytime one leans midi.
  return dressy ? ['midi_dress', 'maxi_dress', 'slip_dress', 'mini_dress'] : ['midi_dress', 'mini_dress', 'maxi_dress', 'slip_dress', 'shirt_dress']
}

/**
 * Read the brief for one event. `label` is the event's own name ("new Years
 * eve"); `brief` is what she said she is looking for, if anything.
 */
export function readEventBrief(label: string, brief?: string | null, eventDate?: string | null): EventBrief {
  const words = norm(brief ?? '')
  const name = norm(label)
  const both = `${name} ${words}`.trim()
  const parsed = parseQuery(words || name)
  const place = readPlace(label)
  const month = monthOf(eventDate)
  const climate = climateOf(place, month)

  const dressy = DRESSY_WORDS.test(both) || (parsed.formalityRange != null && parsed.formalityRange[0] >= 4)
  const length = lengthOf(words)
  const wantsDress = DRESS_WORD.test(both) || length != null || parsed.itemTypes.some((t) => (DRESS_TYPES as readonly string[]).includes(t))

  // The garment she named — "a blazer", "wide trousers" — when it is not a
  // dress. The search parser turns "short" into shorts; a short DRESS is a
  // length, not shorts, so garment words only count when no dress is meant.
  const named = parsed.itemTypes.filter((t) => !(DRESS_TYPES as readonly string[]).includes(t) && t !== 'shorts')
  const nonDressGarment = named.filter((t) => !['heel', 'flat', 'boot', 'sandal', 'mule', 'sneaker', 'tote', 'clutch', 'crossbody', 'shoulder_bag', 'structured_bag', 'necklace', 'earrings', 'bracelet', 'ring', 'brooch', 'belt', 'scarf', 'hat', 'sunglasses'].includes(t))

  let itemTypes: string[]
  let defaulted = false
  if (wantsDress) {
    itemTypes = dressTypesFor(length, dressy)
  } else if (nonDressGarment.length) {
    itemTypes = nonDressGarment
  } else {
    // Nothing named: an occasion with a dress in its name gets dresses; any
    // other event gets a dress first and a top second, so there is always
    // something to pick.
    defaulted = true
    itemTypes = DRESS_EVENT.test(name) || dressy ? dressTypesFor(null, dressy)
      // A place in the cold months asks for layers before it asks for a dress;
      // in the warm ones, the dresses lead and a knit is not offered at all.
      : climate === 'cold' ? ['knitwear', 'coat', 'midi_dress', 'maxi_dress', 'shirt_dress', 'blouse']
      : climate === 'cool' ? ['midi_dress', 'knitwear', 'coat', 'shirt_dress', 'blouse', 'mini_dress']
      : climate === 'warm' || climate === 'hot' ? ['midi_dress', 'mini_dress', 'maxi_dress', 'slip_dress', 'blouse']
      : [...dressTypesFor(null, false), 'blouse', 'knitwear']
  }

  return {
    itemTypes,
    colours: parsed.colourFamilies,
    materials: parsed.materials,
    length,
    dressy,
    defaulted,
    place,
    month,
    climate,
  }
}

/** "Edinburgh in December, cold" — where she is going and how it will feel, for a note. */
export function sayClimate(b: Pick<EventBrief, 'place' | 'month' | 'climate'>): string {
  if (!b.place || !b.climate) return ''
  const when = b.month ? ` in ${MONTH_NAMES[b.month - 1]}` : ''
  return `${sayPlace(b.place)}${when}, ${b.climate}`
}

/** Her brief, said back in one line for a note: "a long cocktail dress, in black". */
export function describeBrief(b: EventBrief): string {
  const parts: string[] = []
  const lead = b.itemTypes[0] ?? ''
  const isDress = (DRESS_TYPES as readonly string[]).includes(lead)
  const len = b.length === 'long' ? 'long' : b.length === 'short' ? 'short' : b.length === 'midi' ? 'midi' : ''
  if (isDress) parts.push(['a', len, b.dressy ? 'dressed-up' : '', 'dress'].filter(Boolean).join(' '))
  else parts.push(`a ${lead.replace(/_/g, ' ')}`)
  if (b.colours.length) parts.push(`in ${b.colours.join(' or ')}`)
  if (b.materials.length) parts.push(b.materials.join(' or '))
  const where = sayClimate(b)
  return parts.join(', ') + (where ? ` — ${where}` : '')
}
