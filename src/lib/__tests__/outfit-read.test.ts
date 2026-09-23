// WHAT MYRA SAYS BACK WHEN SHE BUILDS SOMETHING.
//
// The risk in this feature is not that the rules are wrong — they are the same
// rules the composer already passes. It is TONE. She chose these pieces. If
// MYRA corrects her on a matter of taste she stops trusting it, and if it waves
// through two things that genuinely clash she stops believing it.
//
// So these tests are mostly about where the line sits: what MYRA speaks up
// about, and what it leaves alone.

import { describe, it, expect } from 'vitest'
import { readOutfit, piecesThatWouldHelp } from '@/lib/outfit-read'
import type { HouseItem } from '@/lib/house-style'

const piece = (over: Partial<HouseItem> & { item_id: string }): HouseItem => ({
  slot: 'top',
  item_type: 'blouse',
  product_name: 'Silk blouse',
  brand_name: 'Totême',
  colour_family: 'navy',
  colour_hex: '#1F2A44',
  material_category: 'silk',
  material_formality: 3,
  fit: 3,
  structure: 3,
  waist_definition: 3,
  leg_opening: 3,
  price: 300,
  price_tier: 3,
  ...over,
} as HouseItem)

const TOP = piece({ item_id: 'top-1' })
const TROUSERS = piece({
  item_id: 'bot-1', slot: 'bottom', item_type: 'trousers',
  product_name: 'Tailored trousers', colour_family: 'navy', colour_hex: '#1F2A44',
  material_category: 'wool',
})

describe('before it is an outfit', () => {
  it('says nothing about an empty rail', () => {
    expect(readOutfit({ items: [] }).tone).toBe('empty')
  })

  it('does not pass judgement on a single piece', () => {
    // One garment is not an outfit, and an opinion on it would be invented.
    const r = readOutfit({ items: [TOP] })
    expect(r.tone).toBe('empty')
    expect(r.line).toMatch(/add something/i)
  })
})

describe('when it works, it is brief and it backs her', () => {
  it('gives one short line, not a report', () => {
    const r = readOutfit({ items: [TOP, TROUSERS] })
    expect(r.tone).toBe('good')
    expect(r.line.length).toBeLessThan(120)
    expect(r.wants).toBeUndefined()
  })

  it('says the same thing about the same outfit twice', () => {
    // The wording must not shuffle between visits, or it reads as noise.
    const a = readOutfit({ items: [TOP, TROUSERS] })
    const b = readOutfit({ items: [TOP, TROUSERS] })
    expect(a.line).toBe(b.line)
  })
})

describe('what MYRA leaves alone, because it is taste and not a clash', () => {
  // These are real house-style rules that MYRA holds its OWN looks to. Applied
  // to hers they would be the app overruling her on a matter of preference.
  it('does not correct her for wearing two statement pieces', () => {
    const loud = piece({
      item_id: 'top-2', product_name: 'Sequin top', surface: 5, pattern: 5,
      colour_family: 'gold', colour_hex: '#C9A227',
    })
    const alsoLoud = piece({
      item_id: 'bot-2', slot: 'bottom', item_type: 'skirt', product_name: 'Brocade skirt',
      surface: 5, pattern: 5, colour_family: 'gold', colour_hex: '#C9A227',
    })
    expect(readOutfit({ items: [loud, alsoLoud] }).tone).not.toBe('unsure')
  })

  it('does not correct her on price mixing', () => {
    const cheap = piece({ item_id: 'top-3', price: 40, price_tier: 1 })
    const dear = piece({ item_id: 'bot-3', slot: 'bottom', item_type: 'trousers', price: 1400, price_tier: 5 })
    expect(readOutfit({ items: [cheap, dear] }).tone).not.toBe('unsure')
  })
})

describe('what MYRA does speak up about — things that clash, for anyone', () => {
  it('flags a colour that fights everything next to it', () => {
    const pink = piece({ item_id: 'top-4', colour_family: 'pink', colour_hex: '#FF00A0' })
    const r = readOutfit({ items: [pink, TROUSERS] })
    expect(r.tone).toBe('unsure')
    expect(r.line.length).toBeLessThan(140)
  })

  it('flags a sleeveless layer over a sleeveless piece', () => {
    // The gilet repeats the shape underneath instead of adding to it.
    const cami = piece({ item_id: 'top-5', product_name: 'Strappy cami', sleeve: 1 })
    const gilet = piece({ item_id: 'out-1', slot: 'outerwear', item_type: 'gilet', product_name: 'Quilted gilet', sleeve: 1 })
    const r = readOutfit({ items: [cami, gilet, TROUSERS] })
    expect(r.tone).toBe('unsure')
    expect(r.wants?.slot).toBe('outerwear')
  })

  it('names one thing, never a list', () => {
    const pink = piece({ item_id: 'top-6', colour_family: 'pink', colour_hex: '#FF00A0', surface: 5, pattern: 5 })
    const loudBottom = piece({
      item_id: 'bot-6', slot: 'bottom', item_type: 'trousers', colour_family: 'orange',
      colour_hex: '#FF6A00', surface: 5, pattern: 5, fit: 5, leg_opening: 5,
    })
    const r = readOutfit({ items: [pink, loudBottom] })
    expect(r.tone).toBe('unsure')
    // One sentence. Several problems reported at once is a telling-off.
    expect(r.line.split(/[.!?]/).filter((s) => s.trim()).length).toBeLessThanOrEqual(2)
  })
})

describe('the fix comes off her own rail', () => {
  it('offers pieces she already has in the slot that would settle it', () => {
    const read = { tone: 'unsure' as const, line: 'x', wants: { slot: 'top', why: 'something more fitted' } }
    const shelves = [
      { item_id: 'a', slot: 'top' },
      { item_id: 'b', slot: 'bottom' },
      { item_id: 'c', slot: 'top' },
    ]
    const help = piecesThatWouldHelp(read, shelves, new Set(['a']))
    // 'a' is already in the outfit, 'b' is the wrong slot.
    expect(help.map((p) => p.item_id)).toEqual(['c'])
  })

  it('offers nothing when MYRA is happy — it is not a shop', () => {
    const read = { tone: 'good' as const, line: 'This works.' }
    expect(piecesThatWouldHelp(read, [{ item_id: 'a', slot: 'top' }], new Set())).toEqual([])
  })
})
