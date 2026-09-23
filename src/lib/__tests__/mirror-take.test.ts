import { describe, expect, it } from 'vitest'
import { blendConfidence } from '@/lib/mirror/confidence'

describe('blendConfidence — one number she can trust', () => {
  it('weights brand .35 / piece .40 / size .15 / wardrobe .10 when everything is known', () => {
    expect(blendConfidence({ brand: 1, piece: 1, size: 1, wardrobe: 1 })).toBe(100)
    expect(blendConfidence({ brand: 0, piece: 0, size: 0, wardrobe: 0 })).toBe(0)
    expect(blendConfidence({ brand: 1, piece: 0, size: 0, wardrobe: 0 })).toBe(35)
    expect(blendConfidence({ brand: 0, piece: 1, size: 0, wardrobe: 0 })).toBe(40)
  })
  it('hands missing components to brand and piece rather than punishing her for not telling us', () => {
    expect(blendConfidence({ brand: 1, piece: 1, size: null, wardrobe: null })).toBe(100)
    expect(blendConfidence({ brand: 0.5, piece: 0.5, size: null, wardrobe: null })).toBe(50)
  })
  it('a wrong size drags a loved brand down but not to nothing', () => {
    const v = blendConfidence({ brand: 0.95, piece: 0.7, size: 0.1, wardrobe: null })
    expect(v).toBeGreaterThan(55)
    expect(v).toBeLessThan(75)
  })
})
