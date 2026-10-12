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
export function readEventBrief(label: string, brief?: string | null): EventBrief {
  const words = norm(brief ?? '')
  const name = norm(label)
  const both = `${name} ${words}`.trim()
  const parsed = parseQuery(words || name)

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
    itemTypes = DRESS_EVENT.test(name) || dressy ? dressTypesFor(null, dressy) : [...dressTypesFor(null, false), 'blouse', 'knitwear']
  }

  return {
    itemTypes,
    colours: parsed.colourFamilies,
    materials: parsed.materials,
    length,
    dressy,
    defaulted,
  }
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
  return parts.join(', ')
}
