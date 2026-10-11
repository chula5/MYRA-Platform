// The shared Outfit Review recipe composes on a HOUSE BASE model under the
// stylist's own: both blend in at their own confidence, and their skip-pairs
// are pooled.
import { describe, it, expect } from 'vitest'
import { composeReviewLooks, reviewLibrary } from '@/lib/review-compose'
import { emptyModel, type StyleModel } from '@/lib/style-brain'
import { rulesForMember } from '@/lib/style-rules'
import { lookVectorFromItems, VECTOR_DIM } from '@/lib/taste-vector'

const item = (id: string, type: string, colour: string, over: Record<string, unknown> = {}) => ({
  item_id: id,
  item_type: type,
  product_name: id,
  image_url: `https://cdn.example.com/${id}.jpg`,
  colour_family: colour,
  material_formality: 3,
  surface: 3,
  sheen: 2,
  pattern: 1,
  structure: 3,
  brand: { brand_id: `b-${id}`, name: `Brand ${id}`, price_tier: 3 },
  ...over,
}) as any

// A statement dress (pattern 4) on smooth, plain supporting pieces: the House
// Style Constitution wants exactly one statement element and few textures.
const anchor = item('dress', 'midi_dress', 'navy', { pattern: 4, surface: 1 })
const library = [
  item('shoe-black', 'flat', 'black', { surface: 1 }),
  item('shoe-cream', 'flat', 'cream', { surface: 1 }),
  item('bag-black', 'tote', 'black', { surface: 1 }),
  item('bag-cream', 'tote', 'cream', { surface: 1 }),
]

/** A model that has learned, with full confidence, that black is approved. */
function lovesBlack(): StyleModel {
  return { ...emptyModel(), decisions: 40, approves: 40, singles: { 'colour:black': [40, 0] } }
}

function topColours(picks: ReturnType<typeof composeReviewLooks>['picks']) {
  return picks[0].items.map((i) => i.item.colour_family)
}

describe('composeReviewLooks — house base', () => {
  it('ranks by the base model when the stylist has none of her own', () => {
    const none = composeReviewLooks({ anchor, library, count: 4 })
    const withBase = composeReviewLooks({ anchor, library, count: 4, baseStyleModel: lovesBlack() })
    expect(none.picks.length).toBeGreaterThan(0)
    // Black leads once the house has taught it; the all-cream look is last.
    expect(topColours(withBase.picks)).toContain('black')
    expect(withBase.picks[withBase.picks.length - 1].items.map((i) => i.item.colour_family)).toEqual(['cream', 'cream'])
    // Same looks, re-ordered: the base re-ranks, it does not invent.
    const key = (p: typeof none.picks[number]) => p.items.map((i) => i.item.item_id).sort().join('|')
    expect(new Set(withBase.picks.map(key))).toEqual(new Set(none.picks.map(key)))
  })

  it('adds the stylist\'s own learning on top of the base rather than replacing it', () => {
    const base = lovesBlack()
    const stylist: StyleModel = { ...emptyModel(), decisions: 40, approves: 40, singles: { 'colour:cream': [40, 0] } }
    const baseOnly = composeReviewLooks({ anchor, library, count: 4, baseStyleModel: base })
    const both = composeReviewLooks({ anchor, library, count: 4, baseStyleModel: base, styleModel: stylist })
    const scoreOf = (r: typeof both, colours: string[]) =>
      r.picks.find((p) => p.items.map((i) => i.item.colour_family).join() === colours.join())!.score
    // With both models, the cream look gains exactly what the stylist taught;
    // the black look keeps what the house taught.
    expect(scoreOf(both, ['cream', 'cream'])).toBeGreaterThan(scoreOf(baseOnly, ['cream', 'cream']))
    expect(scoreOf(both, ['black', 'black'])).toBeCloseTo(scoreOf(baseOnly, ['black', 'black']), 6)
  })

  it('composes exactly as before when no base is given', () => {
    const a = composeReviewLooks({ anchor, library, count: 4, styleModel: lovesBlack() })
    const b = composeReviewLooks({ anchor, library, count: 4, styleModel: lovesBlack(), baseStyleModel: null })
    expect(a.picks.map((p) => p.score)).toEqual(b.picks.map((p) => p.score))
  })
})

describe('reviewLibrary', () => {
  it('drops outerwear, the anchor, and a duplicate listing of it', () => {
    const dup = item('dup', 'midi_dress', 'navy', { product_name: 'dress' })
    const coat = item('coat', 'coat', 'black')
    const lib = reviewLibrary([anchor, dup, coat, ...library], anchor)
    const ids = lib.map((i) => i.item_id)
    expect(ids).not.toContain('dress')
    expect(ids).not.toContain('dup')
    expect(ids).not.toContain('coat')
    expect(ids).toContain('shoe-black')
  })
})

describe('composeReviewLooks — member hooks', () => {
  // No statement piece anywhere: the whole constitution refuses, a
  // global-only rule layer does not care, a fuchsia piece is banned for all.
  const plainDress = item('plain', 'midi_dress', 'navy', { pattern: 1, surface: 1 })
  const fuchsia = item('shoe-fuchsia', 'flat', 'fuchsia', { surface: 1, colour_hex: '#ff00aa' })

  it('judges through a member\'s rule layer: global-only keeps the bans, drops the statement rule', () => {
    const whole = composeReviewLooks({ anchor: plainDress, library, count: 4 })
    expect(whole.picks).toHaveLength(0)
    const global = composeReviewLooks({ anchor: plainDress, library, count: 4, rules: rulesForMember(null, false) })
    expect(global.picks.length).toBeGreaterThan(0)
    const withFuchsia = composeReviewLooks({ anchor: plainDress, library: [...library, fuchsia], count: 8, rules: rulesForMember(null, false) })
    expect(withFuchsia.picks.every((p) => !p.items.some((i) => i.item.item_id === 'shoe-fuchsia'))).toBe(true)
  })

  it('lowers the score for a soft rule instead of discarding the look', () => {
    const chloe = composeReviewLooks({ anchor: plainDress, library, count: 4, rules: rulesForMember(null, true) })
    const global = composeReviewLooks({ anchor: plainDress, library, count: 4, rules: rulesForMember(null, false) })
    expect(chloe.picks.length).toBe(global.picks.length)
    expect(chloe.picks[0].score).toBeLessThan(global.picks[0].score)
  })

  it('fills an extra slot when required and lets an optional one be left out', () => {
    const coat = item('coat', 'coat', 'black', { surface: 1 })
    const lib = [...library, coat]
    const required = composeReviewLooks({ anchor, library: lib, count: 4, extraSlots: [{ slot: 'outerwear', required: true }] })
    expect(required.picks.length).toBeGreaterThan(0)
    expect(required.picks.every((p) => p.items.some((i) => i.slot === 'outerwear'))).toBe(true)
    const optional = composeReviewLooks({ anchor, library: lib, count: 8, extraSlots: [{ slot: 'outerwear', required: false }] })
    expect(optional.picks.some((p) => !p.items.some((i) => i.slot === 'outerwear'))).toBe(true)
    const none = composeReviewLooks({ anchor, library, count: 4, extraSlots: [{ slot: 'outerwear', required: true }] })
    expect(none.picks).toHaveLength(0)
  })

  it('keeps a pinned piece in every pick and never draws it from the library', () => {
    const pinnedBag = item('her-bag', 'tote', 'black', { surface: 1 })
    const r = composeReviewLooks({ anchor, library: [...library, pinnedBag], count: 4, pinned: [{ item: pinnedBag, slot: 'bag' }] })
    expect(r.picks.length).toBeGreaterThan(0)
    for (const p of r.picks) expect(p.items.filter((i) => i.slot === 'bag').map((i) => i.item.item_id)).toEqual(['her-bag'])
  })
})

describe('lookVectorFromItems', () => {
  it('is a 34-dim vector that differs between a dress look and a jeans look', () => {
    const a = lookVectorFromItems([anchor, library[0], library[2]])
    const b = lookVectorFromItems([item('jeans', 'jeans', 'blue', { material_formality: 1 }), item('tee', 't-shirt', 'white', { material_formality: 1 }), library[1]])
    expect(a).toHaveLength(VECTOR_DIM)
    expect(a).not.toEqual(b)
  })
})

describe('composeReviewLooks — a plain anchor still finds its statement piece', () => {
  it('keeps shortlist places for statement pieces when the top of the list is all plain', () => {
    const plain = item('plain-dress', 'midi_dress', 'navy', { pattern: 1, surface: 1 })
    // Six perfectly compatible plain shoes, one printed shoe that fits a little worse.
    const plainShoes = ['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => item(id, 'flat', 'navy', { surface: 1 }))
    const printed = item('printed', 'flat', 'navy', { surface: 1, pattern: 4, material_formality: 2 })
    const bags = ['b1', 'b2'].map((id) => item(id, 'tote', 'navy', { surface: 1 }))
    const r = composeReviewLooks({ anchor: plain, library: [...plainShoes, printed, ...bags], count: 4 })
    expect(r.picks.length).toBeGreaterThan(0)
    expect(r.picks.every((p) => p.items.some((i) => i.item.item_id === 'printed'))).toBe(true)
  })
})

describe('composeReviewLooks — widens the shortlist when nothing passes', () => {
  it('reaches past five near-identical pieces to the one that completes a look', () => {
    const plain = item('plain-dress', 'midi_dress', 'navy', { pattern: 1, surface: 1 })
    // Seven plain navy shoes tie at the top; the only shoe the constitution
    // can use (a statement, in a colour that echoes nothing else) sits eighth.
    const plainShoes = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map((id) => item(id, 'flat', 'navy', { surface: 1 }))
    const statement = item('statement', 'flat', 'navy', { surface: 1, pattern: 4, material_formality: 1 })
    const bags = ['b1', 'b2'].map((id) => item(id, 'tote', 'navy', { surface: 1 }))
    const narrow = composeReviewLooks({ anchor: plain, library: [...plainShoes, statement, ...bags], count: 4, perSlotPool: 1 })
    expect(narrow.picks.length).toBeGreaterThan(0)
    expect(narrow.picks.every((p) => p.items.some((i) => i.item.item_id === 'statement'))).toBe(true)
  })
})

describe('composeReviewLooks — no near-twin looks', () => {
  it('never offers the same look twice with only one piece swapped', () => {
    const top = item('statement-top', 'blouse', 'navy', { pattern: 4, surface: 1 })
    const lib = [
      item('skirt-a', 'skirt', 'black', { surface: 1 }),
      item('skirt-b', 'skirt', 'cream', { surface: 1 }),
      item('shoe-a', 'flat', 'black', { surface: 1 }),
      item('shoe-b', 'flat', 'cream', { surface: 1 }),
      item('bag-a', 'tote', 'black', { surface: 1 }),
      item('bag-b', 'tote', 'cream', { surface: 1 }),
    ]
    const r = composeReviewLooks({ anchor: top, library: lib, count: 6, noTwins: true })
    expect(r.picks.length).toBeGreaterThan(1)
    const ids = r.picks.map((p) => new Set(p.items.map((i) => i.item.item_id)))
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const shared = [...ids[i]].filter((id) => ids[j].has(id)).length
        expect(shared).toBeLessThanOrEqual(1)
      }
    }
  })
})
