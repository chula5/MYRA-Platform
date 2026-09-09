import { describe, it, expect } from 'vitest'
import { tooSimilarVariant } from '@/lib/pilot-composer'

const HERO = 'blouse'

describe('style three ways', () => {
  it('rejects the same outfit in different shoes', () => {
    // The real pair: same blouse, same trousers, same bag, one sandal changed.
    const a = [HERO, 'trousers', 'sandal-white', 'bag']
    const b = [HERO, 'trousers', 'sandal-black', 'bag']
    expect(tooSimilarVariant(a, b, HERO)).toBe(true)
  })

  it('accepts a genuinely different way to wear the same piece', () => {
    const a = [HERO, 'trousers', 'sandal-white', 'tote']
    const b = [HERO, 'skirt', 'boot', 'clutch']
    expect(tooSimilarVariant(a, b, HERO)).toBe(false)
  })

  it('counts only the supporting pieces — the hero is shared by definition', () => {
    const a = [HERO, 'trousers', 'flat']
    const b = ['other-hero', 'skirt', 'boot']
    expect(tooSimilarVariant(a, b, HERO)).toBe(false)
  })

  it('needs more than one supporting piece changed', () => {
    const a = [HERO, 'a', 'b', 'c']
    // One of three changed is the shoe-swap case — still the same outfit.
    expect(tooSimilarVariant(a, [HERO, 'a', 'b', 'z'], HERO)).toBe(true)
    // Two of three is a different way to wear it.
    expect(tooSimilarVariant(a, [HERO, 'a', 'y', 'z'], HERO)).toBe(false)
    expect(tooSimilarVariant(a, [HERO, 'x', 'y', 'z'], HERO)).toBe(false)
  })

  it('treats two empty looks as the same', () => {
    expect(tooSimilarVariant([HERO], [HERO], HERO)).toBe(true)
  })
})
