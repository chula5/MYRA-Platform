import { describe, it, expect } from 'vitest'
import {
  parseSizeLabel, canonicalise, matchQuality, acceptedValues, sizeCategoryFor,
  shiftCanonical, offsetFor, profileIsEmpty, canonicalLabel,
  type SizeProfile,
} from '@/lib/size-canonical'

describe('one canonical value across systems', () => {
  it('resolves UK 10, EU 38 and IT 42 to the same value', () => {
    const uk = parseSizeLabel('UK 10', 'tops')!.values[0]
    const eu = parseSizeLabel('EU 38', 'tops')!.values[0]
    const it = parseSizeLabel('IT 42', 'tops')!.values[0]
    expect(uk).toBe(10)
    expect(eu).toBe(10)
    expect(it).toBe(10)
  })

  it('treats FR as EU + 2, not as EU', () => {
    // FR 40 = EU 38 = UK 10. Reading FR as EU would make it a UK 12.
    expect(parseSizeLabel('FR 40', 'tops')!.values[0]).toBe(10)
    expect(parseSizeLabel('EU 40', 'tops')!.values[0]).toBe(12)
  })

  it('reads a bare number by magnitude', () => {
    expect(parseSizeLabel('38', 'tops')!.values[0]).toBe(10)   // EU clothing
    expect(parseSizeLabel('6', 'tops')!.values[0]).toBe(10)    // US clothing
    expect(parseSizeLabel('39', 'shoes')!.values[0]).toBe(6)   // EU shoe
    expect(parseSizeLabel('5', 'shoes')!.values[0]).toBe(5)    // UK shoe
  })

  it('spans both numbers an alpha size covers', () => {
    expect(parseSizeLabel('M', 'tops')!.values).toEqual([10, 12])
  })

  it('returns null rather than guessing on jeans waist and one-size', () => {
    expect(parseSizeLabel('28', 'bottoms')!.values).toEqual([])
    expect(parseSizeLabel('ONE SIZE', 'tops')!.values).toEqual([])
    expect(parseSizeLabel('Luwak', 'tops')).toBeNull()
  })
})

describe('brand offsets', () => {
  it('shifts a labelled size to the size it actually fits', () => {
    // Runs small: a labelled UK 10 fits like an 8.
    expect(canonicalise('UK 10', 'tops', { default: -1 }).value).toBe(8)
    // Runs large: a labelled UK 10 fits like a 12.
    expect(canonicalise('UK 10', 'tops', { tops: 1 }).value).toBe(12)
    expect(canonicalise('UK 10', 'tops', {}).value).toBe(10)
  })

  it('prefers a category offset over the default', () => {
    expect(offsetFor({ default: 1, shoes: -1 }, 'shoes')).toBe(-1)
    expect(offsetFor({ default: 1, shoes: -1 }, 'tops')).toBe(1)
  })

  it('clamps at the ends of the ladder', () => {
    expect(shiftCanonical(4, 'tops', -3)).toBe(4)
    expect(shiftCanonical(22, 'tops', 3)).toBe(22)
  })
})

describe('match quality', () => {
  const profile: SizeProfile = {
    tops: { value: 10, adjacent: 12 },
    shoes: { value: 6, adjacent: null },
  }

  it('exact canonical match is full', () => {
    expect(matchQuality(profile, 'tops', [10])).toBe('full')
  })

  it('an adjacent size SHE listed is acceptable', () => {
    expect(matchQuality(profile, 'tops', [12])).toBe('acceptable')
  })

  it('an adjacent size she did NOT list is no match', () => {
    // She listed 12, not 8 — we never infer the other neighbour for her.
    expect(matchQuality(profile, 'tops', [8])).toBe('none')
    expect(matchQuality(profile, 'shoes', [5])).toBe('none')
  })

  it('is unknown, not a mismatch, when we have no size for the category', () => {
    expect(matchQuality(profile, 'bottoms', [10])).toBe('unknown')
    expect(matchQuality(profile, 'tops', [])).toBe('unknown')
    expect(matchQuality(profile, null, [10])).toBe('unknown')
  })

  it('accepts both her sizes for a query filter', () => {
    expect(acceptedValues(profile, 'tops')).toEqual([10, 12])
    expect(acceptedValues(profile, 'shoes')).toEqual([6])
    expect(acceptedValues(profile, 'bottoms')).toEqual([])
  })
})

describe('categories', () => {
  it('maps garments to the ladder they are sized on', () => {
    expect(sizeCategoryFor('midi_dress')).toBe('tops')
    expect(sizeCategoryFor('jeans')).toBe('bottoms')
    expect(sizeCategoryFor('trench')).toBe('outerwear')
    expect(sizeCategoryFor('boot')).toBe('shoes')
  })

  it('gives bags and jewellery no category, so they are never size-gated', () => {
    expect(sizeCategoryFor('tote')).toBeNull()
    expect(sizeCategoryFor('necklace')).toBeNull()
  })
})

describe('display', () => {
  it('shows every system so she recognises hers', () => {
    expect(canonicalLabel(10, 'tops')).toContain('UK 10')
    expect(canonicalLabel(10, 'tops')).toContain('IT 42')
    expect(canonicalLabel(6, 'shoes')).toBe('UK 6 · US 8 · EU 39')
  })

  it('knows an empty profile', () => {
    expect(profileIsEmpty(null)).toBe(true)
    expect(profileIsEmpty({ tops: { value: null, adjacent: null } })).toBe(true)
    expect(profileIsEmpty({ tops: { value: 10, adjacent: null } })).toBe(false)
  })
})
