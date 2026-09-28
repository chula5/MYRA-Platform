import { describe, it, expect } from 'vitest'
import { currentSeason, inSeason, seasonOf } from '../season'

describe('currentSeason', () => {
  it('turns to autumn/winter in August and back in February', () => {
    expect(currentSeason(new Date('2026-09-28T00:00:00Z'))).toBe('aw')
    expect(currentSeason(new Date('2026-01-15T00:00:00Z'))).toBe('aw')
    expect(currentSeason(new Date('2026-02-01T00:00:00Z'))).toBe('ss')
    expect(currentSeason(new Date('2026-07-31T00:00:00Z'))).toBe('ss')
  })
})

describe('seasonOf — the shop\'s own codes come first', () => {
  it('reads Antik Batik tags', () => {
    expect(seasonOf({ tags: ['AW25', 'AW26', 'Knitwear', 'syncio-hidden'], title: 'Poncho Rob' })).toMatchObject({ season: 'aw', code: 'AW26', basis: 'code' })
    expect(seasonOf({ tags: ['SS26', 'Dresses'], title: 'Robe longue Fruti' })).toMatchObject({ season: 'ss', code: 'SS26' })
    expect(seasonOf({ tags: ['reconduits-aw26', 'SS25'] }).season).toBe('aw')
  })
  it('calls a carry-over sold both seasons "all"', () => {
    expect(seasonOf({ tags: ['AW25', 'SS25'] }).season).toBe('all')
  })
  it('reads French and English season words in tags', () => {
    expect(seasonOf({ tags: ['Collection Automne-Hiver'] }).season).toBe('aw')
    expect(seasonOf({ tags: ['Resort 26'] }).season).toBe('ss')
  })
  it('does not read the title alone for words', () => {
    expect(seasonOf({ title: 'Winter white blouse', itemType: 'blouse' }).season).toBeNull()
  })
})

describe('seasonOf — then the piece itself', () => {
  it('knows shorts and sandals are summer, coats and knitwear winter', () => {
    expect(seasonOf({ itemType: 'shorts' })).toMatchObject({ season: 'ss', basis: 'type' })
    expect(seasonOf({ itemType: 'coat' })).toMatchObject({ season: 'aw', basis: 'type' })
  })
  it('reads linen against wool', () => {
    expect(seasonOf({ itemType: 'trousers', materialPrimary: 'linen' })).toMatchObject({ season: 'ss', basis: 'material' })
    expect(seasonOf({ itemType: 'trousers', title: 'Pantalon cargo en laine Francisco' })).toMatchObject({ season: 'aw', basis: 'material' })
  })
  it('leaves a plain cotton blouse alone', () => {
    expect(seasonOf({ itemType: 'blouse', materialPrimary: 'cotton' }).season).toBeNull()
  })
})

describe('inSeason', () => {
  const sept = new Date('2026-09-28T00:00:00Z')
  it('hides summer in September and shows the rest', () => {
    expect(inSeason('ss', sept)).toBe(false)
    expect(inSeason('aw', sept)).toBe(true)
    expect(inSeason('all', sept)).toBe(true)
    expect(inSeason(null, sept)).toBe(true)
  })
})
