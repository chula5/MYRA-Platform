// queueMirrorProducts — the Mirror route for a shop no server can read
// (Reformation behind Cloudflare, Massimo Dutti behind Akamai). The pieces she
// walks past on the site arrive in the same queue as a scan, with the same
// gates. Pinned here: the brand's own bar refuses off-taste tiles, and a tile
// off a storefront that does not say it is British stays UNPRICED rather than
// recorded as pounds — a $248 piece must never sit in the queue as £248.

import { describe, expect, it, vi } from 'vitest'

// The scoring read and the library lookups — stubbed so the test is about the
// queue row, not about a shop or a library.
vi.mock('@/lib/brand-watch', () => ({
  classifyExternalProduct: () => ({
    score: 8, nonFashion: false, menswear: false, colourFamily: 'black',
    materialCategory: 'knitwear', materialPrimary: 'wool', itemType: 'jumper',
  }),
  fetchKnownForBrand: async () => [],
  houseBanFor: () => null,
  isKnown: () => false,
  resolveBrandId: async () => 'brand-1',
}))

import { queueMirrorProducts } from '@/lib/mirror/watchlist'

/** Captures every queue insert and every watchlist-row update. */
function fakeAdmin() {
  const inserted: any[] = []
  const patched: any[] = []
  const admin = {
    from(table: string) {
      if (table === 'brand_watch_queue') {
        return {
          insert: async (rows: any[]) => { inserted.push(...rows); return { error: null } },
        }
      }
      if (table === 'watched_brand') {
        return {
          update: (patch: any) => ({ eq: async () => { patched.push(patch); return { error: null } } }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as any
  return { admin, inserted, patched }
}

const watched = () => ({
  watched_brand_id: 'wb-1', name: 'Testshop', platform: 'mirror',
  base_url: 'https://www.testshop.com', min_score: 5, active: true,
}) as any

const tile = (over: Record<string, unknown> = {}) => ({
  url: 'https://www.testshop.co.uk/products/wool-turtleneck',
  title: 'Wool Turtleneck', price: 248, available: true,
  image: 'https://cdn.testshop.com/img.jpg', ...over,
})

describe('queueMirrorProducts', () => {
  it('queues a British tile with its price in pounds', async () => {
    const { admin, inserted } = fakeAdmin()
    const queued = await queueMirrorProducts(admin, watched(), [tile()])
    expect(queued).toBe(1)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].price).toBe('248')
    expect(inserted[0].currency).toBe('GBP')
    expect(inserted[0].price_gbp).toBe(248)
  })

  it('leaves a tile off a non-British storefront unpriced, never pounds', async () => {
    const { admin, inserted } = fakeAdmin()
    const queued = await queueMirrorProducts(admin, watched(), [
      tile({ url: 'https://www.thereformation.com/products/wool-turtleneck' }),
    ])
    expect(queued).toBe(1)
    expect(inserted[0].currency).toBeNull()
    expect(inserted[0].price).toBe('248')
    // $248 is not £248 — the promise of currencyFor, honoured.
    expect(inserted[0].price_gbp).toBeNull()
  })

  it('refuses a tile below the brand’s own bar', async () => {
    const { admin, inserted } = fakeAdmin()
    const queued = await queueMirrorProducts(admin, { ...watched(), min_score: 9 }, [tile()])
    expect(queued).toBe(0)
    expect(inserted).toHaveLength(0)
  })
})
