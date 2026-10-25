import { describe, it, expect } from 'vitest'
import { ageAvoids, applyAgeTicks, EMPTY_STYLE_PREFS, SHAPE_PREFERENCES, PIECE_PREFERENCES, AGE_AVOIDS } from '@/lib/pilot-stylist'
import { AGE_RANGES } from '@/app/onboarding/brand-groups'

const none = { shapes: [], types: [] }

describe('ageAvoids', () => {
  it('ticks nothing under 50 or unset', () => {
    expect(ageAvoids(null)).toEqual(none)
    expect(ageAvoids('40-50')).toEqual(none)
  })
  it('50-60 ticks mini length and mini/slip dresses', () => {
    expect(ageAvoids('50-60')).toEqual({ shapes: ['mini_length'], types: ['mini_dress', 'slip_dress'] })
  })
  it('60+ adds to the step below', () => {
    expect(ageAvoids('60-70')).toEqual({ shapes: ['mini_length', 'bare_shoulder'], types: ['mini_dress', 'slip_dress', 'shorts'] })
    expect(ageAvoids('70+')).toEqual(ageAvoids('60-70'))
  })
  it('only names real chips', () => {
    const shapes = new Set(SHAPE_PREFERENCES.map((s) => s.id))
    const types = new Set(PIECE_PREFERENCES.map((t) => t.value))
    for (const s of AGE_AVOIDS) {
      s.shapes.forEach((v) => expect(shapes.has(v)).toBe(true))
      s.types.forEach((v) => expect(types.has(v)).toBe(true))
    }
    expect(AGE_RANGES).toContain('50-60')
  })
})

describe('applyAgeTicks', () => {
  it('ticks the avoids and leaves hand-made ticks alone', () => {
    const prefs = { ...EMPTY_STYLE_PREFS, types_avoided: ['heel'] }
    const r = applyAgeTicks(prefs, none, '50-60')
    expect(r.prefs.types_avoided).toEqual(['heel', 'mini_dress', 'slip_dress'])
    expect(r.prefs.shapes_avoided).toEqual(['mini_length'])
    expect(r.ticked).toEqual({ shapes: ['mini_length'], types: ['mini_dress', 'slip_dress'] })
  })
  it('never ticks a piece she is down as wearing', () => {
    const prefs = { ...EMPTY_STYLE_PREFS, types_loved: ['slip_dress'] }
    const r = applyAgeTicks(prefs, none, '50-60')
    expect(r.prefs.types_avoided).toEqual(['mini_dress'])
    expect(r.prefs.types_loved).toEqual(['slip_dress'])
  })
  it('does not claim a tick Chloe already made', () => {
    const prefs = { ...EMPTY_STYLE_PREFS, types_avoided: ['mini_dress'] }
    const r = applyAgeTicks(prefs, none, '50-60')
    expect(r.ticked.types).toEqual(['slip_dress'])
    // clearing the age lifts only the age's own tick
    expect(applyAgeTicks(r.prefs, r.ticked, null).prefs.types_avoided).toEqual(['mini_dress'])
  })
  it('stepping down an age lifts the older ticks', () => {
    const a = applyAgeTicks(EMPTY_STYLE_PREFS, none, '60-70')
    const b = applyAgeTicks(a.prefs, a.ticked, '50-60')
    expect(b.prefs).toEqual({ ...EMPTY_STYLE_PREFS, shapes_avoided: ['mini_length'], types_avoided: ['mini_dress', 'slip_dress'] })
  })
  it('picking the age again re-applies its ticks', () => {
    const a = applyAgeTicks(EMPTY_STYLE_PREFS, none, '50-60')
    const lifted = { ...a.prefs, types_avoided: ['mini_dress'] } // she wears slip dresses after all
    const b = applyAgeTicks(lifted, a.ticked, '50-60')
    expect(b.prefs.types_avoided).toEqual(['mini_dress', 'slip_dress'])
  })
})
