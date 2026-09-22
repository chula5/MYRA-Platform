import { describe, it, expect } from 'vitest'
import { nearestLookFit, NEAREST_LOOK_WEIGHT } from '@/lib/pilot-composer'
import { VECTOR_DIM } from '@/lib/taste-vector'

// A piece scored on the three dimensions a single garment can express.
const piece = (structure: number, pattern: number, formality: number) =>
  ({ item_id: 'x', structure, pattern, material_formality: formality } as any)

const look = (fill: number) => Array.from({ length: VECTOR_DIM }, () => fill)

describe('nearestLookFit', () => {
  it('says nothing when she has no looks yet', () => {
    expect(nearestLookFit(undefined, piece(3, 1, 3))).toBe(0)
    expect(nearestLookFit([], piece(3, 1, 3))).toBe(0)
  })

  it('lifts a piece that belongs in one of her looks, and only that one', () => {
    const item = piece(4, 1, 3)
    const near = nearestLookFit([look(0.5)], item)
    // One look far away and one close: the close one decides.
    const withFar = nearestLookFit([look(0.02), look(0.5)], item)
    expect(withFar).toBe(near)
    expect(near).toBeGreaterThanOrEqual(0)
    expect(near).toBeLessThanOrEqual(NEAREST_LOOK_WEIGHT)
  })

  it('never punishes — a piece unlike every look scores zero, not below', () => {
    expect(nearestLookFit([look(0.01)], piece(5, 5, 5))).toBeGreaterThanOrEqual(0)
  })

  it('ignores a look stored in a different shape', () => {
    expect(nearestLookFit([[0.5, 0.5, 0.5]], piece(3, 1, 3))).toBe(0)
  })
})

import { lookSignature } from '@/lib/pilot-composer'

describe('lookSignature', () => {
  it('is the combination, not the order it was composed in', () => {
    expect(lookSignature(['b', 'a', 'c'])).toBe(lookSignature(['c', 'a', 'b']))
  })
  it('ignores pieces with no id, and counts a piece once', () => {
    expect(lookSignature(['a', null, 'a', undefined, 'b'])).toBe('a|b')
  })
  it('tells two different looks apart', () => {
    expect(lookSignature(['a', 'b'])).not.toBe(lookSignature(['a', 'c']))
  })
})
