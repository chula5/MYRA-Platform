import { describe, it, expect } from 'vitest'
import { currentSeason, currentSeasonCode, inCurrentSeason, inSeason, isFutureSeasonCode, isStaleSeasonCode, seasonOf } from '../season'

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

// The step that makes the queue work on a real shop. A plain blouse says nothing
// about its season, and on THE POSSE that left 319 of 437 queued rows unplaced —
// all of them shown as in-season in September. But a shop clearing stock is
// clearing last season's stock, and it tags it.
describe('seasonOf — last, whether the shop is clearing it', () => {
  const sept = new Date('2026-09-28T00:00:00Z') // autumn
  const june = new Date('2026-06-15T00:00:00Z') // summer

  it('files a clearance piece under the season being cleared', () => {
    // Clearing in September is clearing summer.
    expect(seasonOf({ tags: ['SALE'], itemType: 'blouse' }, sept)).toMatchObject({ season: 'ss', basis: 'sale' })
    expect(seasonOf({ tags: ['EOSS2025'], itemType: 'dress' }, sept)).toMatchObject({ season: 'ss', basis: 'sale' })
    expect(seasonOf({ tags: ['FINAL-SALE'], itemType: 'top' }, sept)).toMatchObject({ season: 'ss', basis: 'sale' })
    // Clearing in June is clearing winter.
    expect(seasonOf({ tags: ['SALE'], itemType: 'blouse' }, june)).toMatchObject({ season: 'aw', basis: 'sale' })
  })

  it('never overrides something the piece itself says', () => {
    // A stated code wins, even on a sale piece.
    expect(seasonOf({ tags: ['SALE', 'AW26'], itemType: 'blouse' }, sept)).toMatchObject({ season: 'aw', basis: 'code' })
    // So does the kind of piece: a coat on sale is still a coat.
    expect(seasonOf({ tags: ['SALE'], itemType: 'coat' }, sept)).toMatchObject({ season: 'aw', basis: 'type' })
    expect(seasonOf({ tags: ['SALE'], itemType: 'trousers', materialPrimary: 'wool' }, sept)).toMatchObject({ season: 'aw', basis: 'material' })
  })

  it('does not read a sale word out of the title', () => {
    // Only tags and the product type are consulted, as with the season words.
    expect(seasonOf({ title: 'Whistles sale dress', itemType: 'blouse' }, sept).season).toBeNull()
  })

  it('still leaves a full-price plain blouse unplaced', () => {
    expect(seasonOf({ tags: ['ALL', 'FULL-PRICE'], itemType: 'blouse' }, sept).season).toBeNull()
  })

  // Two traps found on real shops, both of which filed hundreds of pieces as
  // last season's stock when read carelessly. Getting these wrong is not
  // cosmetic any more: an out-of-season piece is not queued at all.
  it('does not read "non-sale" as being on sale', () => {
    // FRAME tags 956 products "non-sale", which means the opposite.
    expect(seasonOf({ tags: ['non-sale'], itemType: 'blouse' }, sept).season).toBeNull()
    expect(seasonOf({ tags: ['Non-Sale'], itemType: 'blouse' }, sept).season).toBeNull()
    expect(seasonOf({ tags: ['non_sale'], itemType: 'blouse' }, sept).season).toBeNull()
  })

  it('does not read a colour description as clearance', () => {
    // FRAME tags every product "clr-dscrp::BLACK" — clr for colour, not clearance.
    expect(seasonOf({ tags: ['clr-dscrp::BLACK'], itemType: 'blouse' }, sept).season).toBeNull()
    expect(seasonOf({ tags: ['clr-dscrp::WHITE', 'collection::women'], itemType: 'blouse' }, sept).season).toBeNull()
  })

  it('still reads a genuine clearance tag, and a campaign code', () => {
    expect(seasonOf({ tags: ['collection::all sale'], itemType: 'blouse' }, sept)).toMatchObject({ season: 'ss', basis: 'sale' })
    // "SS26-CLR" is a Brora campaign label, so its code is not the season — but
    // it is not a clearance signal either, so the piece stays unplaced.
    expect(seasonOf({ tags: ['SS26-CLR'], itemType: 'blouse' }, sept).season).toBeNull()
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

// The season test only knows the two halves of the year, so it asks "is this the
// opposite season?" — which catches summer in September and misses last autumn
// entirely. Antik Batik's queue held AW26 (281), AW25 (202) and AW24 (21), so 223
// pieces of autumn stock from years past read as perfectly in-season.
describe('currentSeasonCode — and the year it carries', () => {
  it('knows which year autumn belongs to', () => {
    // August to January is the SAME autumn: AW26 runs Aug 2026 to Jan 2027.
    expect(currentSeasonCode(new Date('2026-09-28T00:00:00Z'))).toBe('AW26')
    expect(currentSeasonCode(new Date('2026-08-01T00:00:00Z'))).toBe('AW26')
    expect(currentSeasonCode(new Date('2027-01-15T00:00:00Z'))).toBe('AW26')
    expect(currentSeasonCode(new Date('2027-02-01T00:00:00Z'))).toBe('SS27')
    expect(currentSeasonCode(new Date('2026-07-31T00:00:00Z'))).toBe('SS26')
  })
})

describe('isStaleSeasonCode — a season already gone by', () => {
  const sept = new Date('2026-09-28T00:00:00Z')
  it('calls last autumn and last summer stale', () => {
    expect(isStaleSeasonCode('AW25', sept)).toBe(true)
    expect(isStaleSeasonCode('AW24', sept)).toBe(true)
    expect(isStaleSeasonCode('SS25', sept)).toBe(true)
    expect(isStaleSeasonCode('SS24', sept)).toBe(true)
  })
  it('does not call the current season or the one coming stale', () => {
    expect(isStaleSeasonCode('AW26', sept)).toBe(false)
    expect(isStaleSeasonCode('SS26', sept)).toBe(false)
    expect(isStaleSeasonCode('SS27', sept)).toBe(false)
  })
  it('never calls a piece stale on a missing date', () => {
    expect(isStaleSeasonCode(null, sept)).toBe(false)
    expect(isStaleSeasonCode(undefined, sept)).toBe(false)
    expect(isStaleSeasonCode('', sept)).toBe(false)
    expect(isStaleSeasonCode('AW', sept)).toBe(false)
  })
})

describe('inCurrentSeason — the one test the queue, keep-all and filter share', () => {
  const sept = new Date('2026-09-28T00:00:00Z')
  it('keeps this autumn and the summer just gone is out', () => {
    expect(inCurrentSeason('aw', 'AW26', sept)).toBe(true)
    expect(inCurrentSeason('ss', 'SS26', sept)).toBe(false)
    expect(inCurrentSeason('aw', 'AW25', sept)).toBe(false) // last autumn
    expect(inCurrentSeason('ss', 'SS25', sept)).toBe(false)
  })
  it('keeps a piece it cannot place', () => {
    expect(inCurrentSeason(null, null, sept)).toBe(true)
    expect(inCurrentSeason('aw', null, sept)).toBe(true)
    expect(inCurrentSeason(null, 'AW26', sept)).toBe(true)
    expect(inCurrentSeason('all', null, sept)).toBe(true)
  })
  it('keeps a future dated collection such as SS27', () => {
    expect(isFutureSeasonCode('SS27', sept)).toBe(true)
    expect(inCurrentSeason('ss', 'SS27', sept)).toBe(true)
    expect(inCurrentSeason('ss', 'SS26', sept)).toBe(false)
    expect(isFutureSeasonCode('SS96', sept)).toBe(false)
    expect(inCurrentSeason('ss', 'SS96', sept)).toBe(false)
  })
})

// Brora files 378 products under "SS26-SALE" or "SS26-CLR" and they include
// cashmere scarves and jumpers. The tag names the promotion, not the season, and
// reading it as one called a cashmere scarf summer. Harmless while season only
// sorted the queue; not harmless now that an out-of-season piece is not queued.
describe('seasonOf — a clearance code is a campaign, not a season', () => {
  it('ignores a season code inside a sale or clearance tag', () => {
    expect(seasonOf({ tags: ['SS26-SALE'], productType: 'Scarves', materialPrimary: 'cashmere' }).season).toBe('aw')
    expect(seasonOf({ tags: ['SS26-CLR'], productType: 'Hats', materialPrimary: 'cashmere' }).season).toBe('aw')
    // With nothing else to go on, the clearance itself places it.
    expect(seasonOf({ tags: ['SS26-SALE'] }, new Date('2026-09-28T00:00:00Z'))).toMatchObject({ season: 'ss', basis: 'sale' })
  })
  it('still reads a code that is not part of a sale tag', () => {
    expect(seasonOf({ tags: ['AW26'] })).toMatchObject({ season: 'aw', code: 'AW26', basis: 'code' })
  })

  // Shops tag internal drop codes that look exactly like season codes, and two
  // digits alone cannot be trusted. 16arlington tags "AW25 | AW25 - Pre
  // Collection | AW25PRE | AW44": reading 44 as the year 2044 made AW44 the
  // LATEST code on the piece, so it beat the real AW25 and last year's stock
  // read as current.
  it('ignores a code whose year is not a plausible year', () => {
    const sept = new Date('2026-09-28T00:00:00Z')
    expect(seasonOf({ tags: ['AW25', 'AW25 - Pre Collection', 'AW25PRE', 'AW44'] }, sept)).toMatchObject({ season: 'aw', code: 'AW25' })
    expect(seasonOf({ tags: ['AW25 - MAIN', 'AW25MAIN', 'AW49'] }, sept)).toMatchObject({ season: 'aw', code: 'AW25' })
    // A line code alone places nothing, rather than dating the piece to 2049.
    expect(seasonOf({ tags: ['AW44'] }, sept).season).toBeNull()
  })
})

// The shop's own season collection is the strongest signal, because it is
// stated rather than inferred. POSSE files its stock under "end-of-summer-sale-*",
// "resort-26", "spring-summer-26", "fall-edit" and "pre-fall-26", and a cream
// crochet strapless top sits in a summer one while being tagged "KNITWEAR".
describe('seasonOf — the season collection the shop filed it under wins', () => {
  it('takes the shop\'s own season collection over every other signal', () => {
    expect(seasonOf({ collectionSeason: 'ss' })).toMatchObject({ season: 'ss', basis: 'collection' })
    // Over a code that says the opposite.
    expect(seasonOf({ tags: ['AW26'], collectionSeason: 'ss' })).toMatchObject({ season: 'ss', basis: 'collection' })
    // And over the kind of piece — the case that matters: POSSE tags a cream
    // crochet strapless top both SS26 and KNITWEAR, and knitwear is the wrong
    // word, because a cotton or crochet knit is summer clothing.
    expect(seasonOf({ tags: ['SS26', 'KNITWEAR'], itemType: 'knitwear', collectionSeason: 'ss' })).toMatchObject({ season: 'ss', basis: 'collection' })
    // And over a clearance tag.
    expect(seasonOf({ tags: ['SALE'], itemType: 'blouse', collectionSeason: 'aw' })).toMatchObject({ season: 'aw', basis: 'collection' })
  })

  it('falls back to the other signals when the shop filed it nowhere', () => {
    expect(seasonOf({ tags: ['AW26'], collectionSeason: null })).toMatchObject({ season: 'aw', basis: 'code' })
    expect(seasonOf({ itemType: 'shorts', collectionSeason: null })).toMatchObject({ season: 'ss', basis: 'type' })
  })
})

describe('seasonOf — explicit pre-orders stay eligible', () => {
  it('recognises pre-order wording even when an old summer code is present', () => {
    expect(seasonOf({ tags: ['SS26', 'PRE-ORDER'] })).toMatchObject({ season: 'all', code: null, basis: 'preorder' })
    expect(seasonOf({ title: 'Silk Dress — Preorder' })).toMatchObject({ season: 'all', basis: 'preorder' })
  })

  it('recognises a pre-order collection signal', () => {
    expect(seasonOf({ collectionSeason: 'ss', collectionCode: 'SS26', preOrder: true })).toMatchObject({ season: 'all', basis: 'preorder' })
  })
})
