import { describe, it, expect } from 'vitest'
import {
  patternKey, patternLabel, gatherPatterns, promotions, attribution,
  stylistFit, transferSeries, predictedCleanRate,
  type Signal, type ClientRun,
} from '@/lib/learning-scope'

const CHLOE = 'stylist-chloe'
const sig = (over: Partial<Signal> & { member_id: string }): Signal => ({
  action: 'swap', stylist_id: CHLOE, occasion: 'work_elevated',
  item: { item_type: 'structured_bag', material_category: 'raffia' },
  ...over,
})

describe('patterns', () => {
  it('generalises to the description, not the item', () => {
    const k = patternKey(sig({ member_id: 'a' }))
    expect(k).toBe('swap:type:structured_bag+material:raffia@work_elevated')
    expect(patternLabel(sig({ member_id: 'a' }))).toBe('raffia structured bag swapped out of work elevated looks')
  })

  it('keeps the occasion in the key — the same piece is right for a beach and wrong for a meeting', () => {
    const smart = patternKey(sig({ member_id: 'a', occasion: 'work_elevated' }))
    const beach = patternKey(sig({ member_id: 'a', occasion: 'travel' }))
    expect(smart).not.toBe(beach)
  })

  it('has nothing to say about an item it cannot describe', () => {
    expect(patternKey(sig({ member_id: 'a', item: { item_type: 'blouse' } }))).toBeNull()
    expect(patternKey(sig({ member_id: 'a', item: null }))).toBeNull()
  })
})

describe('promotion', () => {
  it('needs three occurrences before a pattern becomes the style', () => {
    const twice = [sig({ member_id: 'alison' }), sig({ member_id: 'alison' })]
    expect(promotions(gatherPatterns(twice))).toEqual([])

    const thrice = [...twice, sig({ member_id: 'alison' })]
    const p = promotions(gatherPatterns(thrice))
    expect(p).toHaveLength(1)
    expect(p[0].scope).toBe('style')
    expect(p[0].reason).toBe('3 times for one client')
  })

  it('never lets ONE client write a stylist rule, however often she repeats it', () => {
    // This is how Alison's quirks stay Alison's.
    const many = Array.from({ length: 12 }, () => sig({ member_id: 'alison', profile_id: 'scandi' }))
    const p = promotions(gatherPatterns(many))
    expect(p.every((x) => x.scope === 'style')).toBe(true)
  })

  it('promotes to the stylist when two clients on DIFFERENT profiles agree', () => {
    const signals = [
      sig({ member_id: 'alison', profile_id: 'scandi' }),
      sig({ member_id: 'devika', profile_id: 'tailored' }),
    ]
    const p = promotions(gatherPatterns(signals))
    expect(p).toHaveLength(1)
    expect(p[0].scope).toBe('stylist')
    expect(p[0].stylistId).toBe(CHLOE)
    expect(p[0].reason).toBe('2 clients on 2 different style profiles')
  })

  it('does not promote to the stylist when both clients share one profile', () => {
    // Two people matched to the same reference profile agreeing says something
    // about that profile, not about the stylist's rules.
    const signals = [
      sig({ member_id: 'alison', profile_id: 'scandi' }),
      sig({ member_id: 'devika', profile_id: 'scandi' }),
    ]
    expect(promotions(gatherPatterns(signals)).some((p) => p.scope === 'stylist')).toBe(false)
  })

  it('never builds a rule out of what she liked', () => {
    const liked = Array.from({ length: 5 }, () => sig({ member_id: 'alison', action: 'liked' }))
    expect(promotions(gatherPatterns(liked))).toEqual([])
  })
})

describe('attribution', () => {
  it('splits her edits by the layer they reached', () => {
    const a = attribution([
      sig({ member_id: 'a', scope: 'client' }),
      sig({ member_id: 'a', scope: 'client' }),
      sig({ member_id: 'a', scope: 'style' }),
      sig({ member_id: 'a', scope: 'stylist' }),
    ])
    expect(a.byScope).toEqual({ client: 2, style: 1, stylist: 1, global: 0 })
    expect(a.clientOnlyShare).toBeCloseTo(0.5)
    expect(a.promotedShare).toBeCloseTo(0.5)
  })

  it('treats an untagged signal as hers alone', () => {
    expect(attribution([sig({ member_id: 'a' })]).byScope.client).toBe(1)
  })
})

describe('stylist fit', () => {
  const edits = (n: number, passed: boolean, from = 0) =>
    Array.from({ length: n }, (_, i) => ({ lookId: `l${from + i}`, constitutionPassed: passed }))

  it('says nothing until there are enough looks', () => {
    const fit = stylistFit(edits(5, true))
    expect(fit.mismatch).toBe(false)
    expect(fit.note).toMatch(/more reviewed looks/)
  })

  it('flags a mismatch when she keeps overruling rules the composer applied correctly', () => {
    const fit = stylistFit([...edits(10, true), ...edits(15, false, 10)])
    expect(fit.looks).toBe(25)
    expect(fit.constitutionShare).toBeCloseTo(10 / 25)
    expect(fit.mismatch).toBe(true)
    expect(fit.note).toMatch(/STYLIST MISMATCH/)
  })

  it('does not flag when her edits are mostly composer mistakes', () => {
    const fit = stylistFit([...edits(4, true), ...edits(21, false, 4)])
    expect(fit.mismatch).toBe(false)
    expect(fit.note).toMatch(/composer mistakes/)
  })
})

describe('transfer metric', () => {
  const run = (name: string, at: string, clean: boolean[], stylist = CHLOE): ClientRun =>
    ({ memberId: name, name, stylistId: stylist, onboardedAt: at, looksClean: clean })
  const pattern = (n: number, cleanCount: number) =>
    Array.from({ length: n }, (_, i) => i < cleanCount)

  it('measures each client against the first one under her stylist', () => {
    const series = transferSeries([
      run('alison', '2026-08-16', pattern(10, 1)),
      run('second', '2026-09-01', pattern(10, 5)),
    ])
    expect(series[0].cleanRate).toBeCloseTo(0.1)
    expect(series[0].deltaVsBaseline).toBeNull()
    expect(series[1].cleanRate).toBeCloseTo(0.5)
    expect(series[1].deltaVsBaseline).toBeCloseTo(0.4)
  })

  it('keeps stylists apart — a new stylist starts its own baseline', () => {
    const series = transferSeries([
      run('alison', '2026-08-16', pattern(10, 1), CHLOE),
      run('other', '2026-09-01', pattern(10, 9), 'stylist-two'),
    ])
    expect(series.find((s) => s.name === 'other')!.deltaVsBaseline).toBeNull()
  })

  it('only counts the first ten looks', () => {
    const series = transferSeries([run('a', '2026-08-16', pattern(30, 3))])
    expect(series[0].looks).toBe(10)
    expect(series[0].cleanRate).toBeCloseTo(0.3)
  })
})

describe('predicted start', () => {
  it('lifts the baseline by what has actually been learned', () => {
    const p = predictedCleanRate(0.1, { stylist: 4, style: 6 })
    expect(p.predicted).toBeCloseTo(0.3)
    expect(p.basis).toMatch(/4 stylist rules \+ 6 style rules/)
  })

  it('predicts nothing above baseline when nothing transferable exists', () => {
    // The honest answer for a second client when the first taught only herself.
    const p = predictedCleanRate(0.1, { stylist: 0, style: 0 })
    expect(p.predicted).toBeCloseTo(0.1)
    expect(p.lift).toBe(0)
  })

  it('says so plainly when there is no baseline yet', () => {
    expect(predictedCleanRate(null, { stylist: 3, style: 1 }).predicted).toBeNull()
  })
})
