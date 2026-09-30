import { describe, it, expect } from 'vitest'
import { pickNewInCollection, pickPreOrderCollections, pickSeasonCollections } from '../brand-watch-collections'

// The collection names are the real ones, read from nine shops' /collections.json.
describe('pickNewInCollection', () => {
  it('finds the new-in section under each shop\'s own name for it', () => {
    expect(pickNewInCollection([{ handle: 'new-arrivals', title: 'New Arrivals' }])?.handle).toBe('new-arrivals')
    expect(pickNewInCollection([{ handle: 'new-in', title: 'New In' }])?.handle).toBe('new-in')
    expect(pickNewInCollection([{ handle: 'nouveautes', title: 'Nouveautés' }])?.handle).toBe('nouveautes')
    expect(pickNewInCollection([{ handle: 'just-in', title: 'Just In' }])?.handle).toBe('just-in')
  })

  it('prefers the plain name over one that merely contains it', () => {
    const picked = pickNewInCollection([
      { handle: 'sale-new-in', title: 'Sale New In' },
      { handle: 'new-in', title: 'New In' },
      { handle: 'new-in-back-to-work-wardrobe', title: 'New In: Back to Work' },
    ])
    expect(picked?.handle).toBe('new-in')
  })

  it('ignores collections that are not about new stock at all', () => {
    expect(pickNewInCollection([
      { handle: 'dresses', title: 'Dresses' },
      { handle: 'beverly-nguyens-new-york-edit', title: "Beverly Nguyen's New York Edit" },
      { handle: 'gifts-for-a-new-mum', title: 'Gifts for a New Mum' },
    ])).toBeNull()
  })

  // Nili Lotan's only new-in collection is the menswear one. Marking those as
  // hers would put the wrong products at the top of her queue, so it is better
  // to report no new-in section at all.
  it('refuses a menswear new-in section when that is all there is', () => {
    expect(pickNewInCollection([{ handle: 'mens-new-in', title: "Men's New In" }])).toBeNull()
    expect(pickNewInCollection([{ handle: 'all-styles-for-men-new-in', title: "Men's New In" }])).toBeNull()
  })

  it('takes the womenswear one when a shop has both', () => {
    const picked = pickNewInCollection([
      { handle: 'all-styles-for-men-new-in', title: "Men's New In" },
      { handle: 'blouses-tops-for-women-new-arrivals', title: "Women's New Arrivals" },
    ])
    expect(picked?.handle).toBe('blouses-tops-for-women-new-arrivals')
  })

  it('returns null rather than guessing when there is no new-in section', () => {
    expect(pickNewInCollection([])).toBeNull()
    expect(pickNewInCollection([{ handle: 'sale', title: 'Sale' }, { handle: 'knitwear', title: 'Knitwear' }])).toBeNull()
  })
})

// POSSE's real handles. Membership of one of these IS the season, stated by the
// shop, which is why it outranks every inferred signal.
describe('pickSeasonCollections', () => {
  it('reads POSSE\'s season collections the right way round', () => {
    const picked = pickSeasonCollections([
      { handle: 'end-of-summer-sale', title: 'End of Summer Sale' },
      { handle: 'end-of-summer-sale-knitwear', title: 'End of Summer Sale Knitwear' },
      { handle: 'resort-26', title: 'Resort 26' },
      { handle: 'spring-summer-26-vol-i', title: 'Spring Summer 26 Vol I' },
      { handle: 'fall-edit', title: 'Fall Edit' },
      { handle: 'pre-fall-26', title: 'Pre-Fall 26' },
    ])
    expect(picked.ss.sort()).toEqual(['end-of-summer-sale', 'end-of-summer-sale-knitwear', 'resort-26', 'spring-summer-26-vol-i'])
    expect(picked.aw).toEqual(['fall-edit', 'pre-fall-26'])
  })

  it('ignores collections that do not name a season', () => {
    const picked = pickSeasonCollections([
      { handle: 'dresses', title: 'Dresses' },
      { handle: 'knitwear', title: 'Knitwear' },
      { handle: 'new-arrivals', title: 'New Arrivals' },
      { handle: 'the-falling-edit', title: 'The Falling Edit' },
    ])
    expect(picked.ss).toEqual([])
    expect(picked.aw).toEqual([])
  })

  // "holiday" means Christmas at some shops and a summer holiday at others, and
  // the name cannot tell us which. Filing real stock under the wrong season now
  // means not queueing it, so an undecidable name is left alone.
  it('leaves "holiday" alone, because it means Christmas or a summer holiday', () => {
    const picked = pickSeasonCollections([{ handle: 'holiday-edit', title: 'Holiday Edit' }])
    expect(picked.ss).toEqual([])
    expect(picked.aw).toEqual([])
  })

  it('drops a handle naming both seasons rather than guessing', () => {
    const picked = pickSeasonCollections([{ handle: 'summer-to-fall', title: 'Summer to Fall' }])
    expect(picked.ss).toEqual([])
    expect(picked.aw).toEqual([])
  })
})

describe('pickPreOrderCollections', () => {
  it('recognises explicit pre-order collections only', () => {
    expect(pickPreOrderCollections([
      { handle: 'pre-order', title: 'Pre-Order' },
      { handle: 'presale-27', title: 'Presale 27' },
      { handle: 'new-arrivals', title: 'New Arrivals' },
    ])).toEqual(['pre-order', 'presale-27'])
  })
})
