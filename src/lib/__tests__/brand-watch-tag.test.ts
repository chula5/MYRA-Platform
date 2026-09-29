import { describe, it, expect } from 'vitest'
import {
  TAG_DIMENSIONS, parseTagLine, tagFromRules, isTransientError, applicableDimensions,
} from '@/lib/brand-watch-tag'

const line = (values: Array<number | 'x'>) => values.join(',')
const allX = Array(TAG_DIMENSIONS.length).fill('x' as const)

describe('parseTagLine', () => {
  it('reads a full line in dimension order', () => {
    const values = TAG_DIMENSIONS.map((_, i) => ((i % 5) + 1))
    const tags = parseTagLine(line(values))
    expect(tags).not.toBeNull()
    TAG_DIMENSIONS.forEach((d, i) => expect(tags![d]).toBe(values[i]))
  })

  it('treats x as "does not apply" rather than a value', () => {
    const values = [...allX]
    values[0] = 3
    const tags = parseTagLine(line(values))
    expect(tags).toEqual({ fit: 3 })
  })

  it('refuses a line with the wrong number of values', () => {
    expect(parseTagLine('3,4,5')).toBeNull()
    expect(parseTagLine(line([...allX, 'x']))).toBeNull()
  })

  /** A misread is not a reading. Keeping it would poison the training set. */
  it('drops values outside 1-5 instead of storing them', () => {
    const values = [...allX]
    values[0] = 9 as any
    values[1] = 0 as any
    values[2] = 4
    expect(parseTagLine(line(values))).toEqual({ rise: 4 })
  })

  it('ignores any preamble and reads the last line', () => {
    const values = [...allX]
    values[0] = 2
    expect(parseTagLine(`Here you go:\n${line(values)}`)).toEqual({ fit: 2 })
  })

  it('returns null when nothing could be read at all', () => {
    expect(parseTagLine(line(allX))).toBeNull()
    expect(parseTagLine('')).toBeNull()
  })
})

describe('tagFromRules', () => {
  it('reads what the feed states outright', () => {
    expect(tagFromRules('Relaxed Cashmere High Neck Long Sleeve Vest')).toMatchObject({
      neckline: 1, sleeve: 5,
    })
    expect(tagFromRules('High-Rise Wide Leg Jean')).toMatchObject({ rise: 5, leg_opening: 5 })
    expect(tagFromRules('Sleeveless Midi Dress')).toMatchObject({ sleeve: 1, length: 4 })
  })

  it('says nothing about a name that states nothing', () => {
    expect(tagFromRules('MAEVE')).toEqual({})
  })

  /** A wrong tag is worse than no tag: it scores the piece AND files it. */
  it('does not read a mini BAG as a garment length', () => {
    expect(tagFromRules('Mini Leather Bag').length).toBeUndefined()
    expect(tagFromRules('Mini Skirt').length).toBe(2)
  })

  it('lets the first, more specific rule win', () => {
    // 'long sleeve' must not be overwritten by a looser sleeve rule later.
    expect(tagFromRules('Long Sleeve Short Dress').sleeve).toBe(5)
  })
})

describe('isTransientError', () => {
  it('knows an API failure from a verdict about a garment', () => {
    expect(isTransientError('You have reached your specified API usage limits')).toBe(true)
    expect(isTransientError('429 rate limit')).toBe(true)
    expect(isTransientError('503 overloaded')).toBe(true)
    expect(isTransientError('ANTHROPIC_API_KEY not configured')).toBe(true)
  })

  it('does not mistake an unreadable image for an outage', () => {
    expect(isTransientError('no image')).toBe(false)
    expect(isTransientError('unrecognised image format')).toBe(false)
    expect(isTransientError('reply did not match the format')).toBe(false)
    expect(isTransientError(undefined)).toBe(false)
  })
})

describe('applicableDimensions', () => {
  it('does not expect a rise or a neckline on a bag', () => {
    const dims = applicableDimensions('tote')
    expect(dims).not.toContain('rise')
    expect(dims).not.toContain('neckline')
    expect(dims).toContain('surface')
  })

  it('expects the full set on a dress, bar the jewellery pair', () => {
    const dims = applicableDimensions('midi_dress')
    expect(dims).toContain('neckline')
    expect(dims).toContain('sleeve')
    expect(dims).not.toContain('jewellery_scale')
  })

  it('expects jewellery dimensions on jewellery', () => {
    expect(applicableDimensions('earrings')).toContain('jewellery_scale')
  })
})
