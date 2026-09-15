import { describe, it, expect } from 'vitest'
import { paleTone, mixesWhiteAndCream, toneOfShade, TONE_HEX } from '../pale-tone'

describe('paleTone — from the colour, not the label', () => {
  it('reads the "cream" pieces from Alison\'s looks as the white they are', () => {
    expect(paleTone({ colour_family: 'cream', colour_hex: '#F5F5F0' })).toBe('white') // halter top
    expect(paleTone({ colour_family: 'cream', colour_hex: '#F5F1ED' })).toBe('white') // wide-leg trouser
    expect(paleTone({ colour_family: 'cream', colour_hex: '#F5F1EB' })).toBe('white') // blazer
  })

  it('reads optic white and warm cream correctly', () => {
    expect(paleTone({ colour_family: 'white', colour_hex: '#FFFFFF' })).toBe('white')
    expect(paleTone({ colour_family: 'white', colour_hex: '#FFFEF0' })).toBe('cream') // "antique white" is warm
    expect(paleTone({ colour_family: 'cream', colour_hex: '#F3E6CC' })).toBe('cream')
  })

  it('does not call a raffia/sand tone white or cream', () => {
    expect(paleTone({ colour_family: 'cream', colour_hex: '#D4AF8F' })).toBeNull()
  })

  it('falls back to the label only when there is no hex', () => {
    expect(paleTone({ colour_family: 'cream' })).toBe('cream')
    expect(paleTone({ colour_family: 'white', colour_hex: null })).toBe('white')
    expect(paleTone({ colour_family: 'navy' })).toBeNull()
  })
})

describe('mixesWhiteAndCream', () => {
  it('catches white hiding under a cream label next to real cream', () => {
    expect(mixesWhiteAndCream([
      { colour_family: 'cream', colour_hex: '#F5F1EB' }, // white blazer
      { colour_family: 'cream', colour_hex: '#F3E6CC' }, // cream skirt
    ])).toBe(true)
  })

  it('allows a look that is all white, or all cream', () => {
    expect(mixesWhiteAndCream([{ colour_hex: '#FFFFFF' }, { colour_hex: '#F5F5F0' }])).toBe(false)
    expect(mixesWhiteAndCream([{ colour_hex: '#F3E6CC' }, { colour_family: 'cream' }])).toBe(false)
  })

  it('ignores pieces that are not pale', () => {
    expect(mixesWhiteAndCream([{ colour_hex: '#FFFFFF' }, { colour_family: 'black', colour_hex: '#111111' }])).toBe(false)
  })
})


describe('shades read from the photo', () => {
  it('puts ivory on the white side and butter on the cream side', () => {
    expect(toneOfShade('ivory')).toBe('white')
    expect(toneOfShade('off_white')).toBe('white')
    expect(toneOfShade('butter')).toBe('cream')
    expect(toneOfShade('ecru')).toBe('cream')
    expect(toneOfShade('not_pale')).toBeNull()
  })

  it('writes codes that the colour rule reads on the same side', () => {
    expect(paleTone({ colour_hex: TONE_HEX.white })).toBe('white')
    expect(paleTone({ colour_hex: TONE_HEX.cream })).toBe('cream')
  })

  it("catches Alison's look: ivory satin blouse with a soft cream skirt", () => {
    expect(mixesWhiteAndCream([
      { colour_family: 'white', colour_hex: TONE_HEX[toneOfShade('ivory')!] },
      { colour_family: 'cream', colour_hex: TONE_HEX[toneOfShade('butter')!] },
    ])).toBe(true)
  })
})
