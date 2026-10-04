// The add flow's last fallback. A shop behind a bot wall — Reformation answers
// Cloudflare's "Just a moment…" challenge on every path, /products.json, its
// sitemap and robots.txt included — answers neither the Shopify route nor the
// sitemap one. The row used to be deleted here, so a brand she asked for again
// and again never landed on the watchlist. It now stays, as mirror-fed:
// nothing is fetched, and the pieces she walks past on the site arrive from
// the extension with the same gates as a scan (mirror/watchlist.ts).

import { describe, expect, it, vi } from 'vitest'

// brand-onboarding rides on Next/Vercel server primitives; the scan under test
// never reaches them in a way that needs the real ones.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@vercel/functions', () => ({ waitUntil: (work: unknown) => work }))
vi.mock('@/lib/supabase-server', () => ({
  // scanNewBrand takes the admin client as an argument — the module-level one
  // must never be built in a test.
  createAdminClient: () => { throw new Error('createAdminClient must not be called here') },
}))
vi.mock('@/lib/currency', () => ({ toGbpAmount: () => null }))

// The shop: a Shopify read that is blocked on both routes, and a sitemap read
// whose answer the test sets per case.
const shop = {
  sitemap: [] as string[],
  reads: 0,
}
vi.mock('@/lib/brand-watch', () => {
  // The catalogue read throws while the row is still on the Shopify platform
  // and succeeds once it has been switched — the fallback under test.
  const read = (watched: { platform?: string }) => {
    if (watched.platform === 'browser') {
      shop.reads += 1
      return { name: 'Testshop', scanned: 100, newProducts: 12, queued: 12, belowScore: 0, skippedStock: 0, suppressedByLearning: 0, restocked: 0 }
    }
    throw new Error('Shopify route blocked: 403')
  }
  return {
    baselineBrand: read, onboardBrand: read,
    mirrorFedResult: (watched: { name?: string }) => ({
      name: watched.name, scanned: 0, newProducts: 0, queued: 0, belowScore: 0,
      skippedStock: 0, suppressedByLearning: 0, restocked: 0,
      note: 'fed by the Mirror — this shop cannot be read from a server, so its pieces arrive as you browse it',
    }),
    classifyExternalProduct: () => ({}), detectStoreCurrency: () => null, fetchCatalogue: () => [],
    foldBrandName: (name: string) => name, houseBanFor: () => null, normaliseBaseUrl: (url: string) => url,
    provisionalNameFromUrl: () => 'Testshop', vendorMode: () => null,
  }
})
vi.mock('@/lib/brand-watch-browser', () => ({
  discoverProductUrls: async () => shop.sitemap,
  fetchNewProductPages: async () => [],
}))

import { scanNewBrand } from '@/lib/brand-onboarding'

/** The calls made against the watchlist row, in order. */
const calls = { updates: [] as { platform?: string; scan_state?: unknown }[], deletes: 0 }
const fakeAdmin: any = {
  from(table: string) {
    if (table !== 'watched_brand') throw new Error(`unexpected table ${table}`)
    return {
      update: (patch: any) => ({
        eq: async (_col: string, _id: string) => { calls.updates.push({ platform: patch.platform, scan_state: patch.scan_state }) },
      }),
      delete: () => ({ eq: async (_col: string, _id: string) => { calls.deletes += 1 } }),
    }
  },
}

const watchedRow = () => ({
  watched_brand_id: 'wb-1', name: 'Testshop', platform: 'shopify',
  base_url: 'https://testshop.com', min_score: 5, active: true,
}) as any

describe('scanNewBrand — a shop no server can read', () => {
  it('keeps the row as mirror-fed instead of deleting it', async () => {
    shop.sitemap = []
    calls.updates.length = 0
    calls.deletes = 0

    const result = await scanNewBrand(fakeAdmin, watchedRow(), 'watch')

    expect(calls.deletes).toBe(0)
    expect(calls.updates.at(-1)?.platform).toBe('mirror')
    expect(calls.updates.at(-1)?.scan_state).toEqual({ running: false })
    expect(result.queued).toBe(0)
    expect(result.note).toMatch(/mirror/i)
    expect(result.note).toMatch(/pieces you see are queued/)
  })

  it('still switches a readable sitemap to the browser route', async () => {
    shop.sitemap = Array.from({ length: 12 }, (_, i) => `https://testshop.com/products/p-${i}`)
    calls.updates.length = 0
    calls.deletes = 0

    const result = await scanNewBrand(fakeAdmin, watchedRow(), 'watch')

    expect(calls.deletes).toBe(0)
    expect(calls.updates.some((u) => u.platform === 'browser')).toBe(true)
    expect(shop.reads).toBe(1)
    expect(result.queued).toBe(12)
  })
})
