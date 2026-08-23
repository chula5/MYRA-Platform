// ── Second-hand reporting ────────────────────────────────────────────────────
//
// What the studio dashboard needs to hold a real conversation with a partner:
// how fast their stock moves, how much interest it draws before it goes, how
// often a sale costs us a saved look — and the one number that decides whether
// the relationship works at all, SIZE COVERAGE.
//
// Size coverage compares the sizes their inventory actually carries against the
// size distribution of our users. A partner whose stock is mostly 6s and 8s
// while half our clients are 12s and 14s isn't a supply problem we can style
// our way out of; it's a buying conversation.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { SIZE_CATEGORIES, ladderFor, type SizeCategory } from '@/lib/size-canonical'
import { STALE_UNIQUE_DAYS } from '@/lib/second-hand'

export interface SecondHandSummary {
  liveUnique: number
  liveSecondHand: number
  soldAllTime: number
  soldLast30: number
  medianDaysToSale: number | null
  medianClickoutsBeforeSale: number | null
  /** Saved looks whose sold piece we managed to restyle, over those we tried. */
  rescueConversion: { restyled: number; total: number; rate: number | null }
  /** Live one-of-ones past STALE_UNIQUE_DAYS with no click-outs at all. */
  stale: { item_id: string; product_name: string; brand_name: string | null; image_url: string | null; days_live: number }[]
}

export interface SizeCoverageRow {
  category: SizeCategory
  /** Canonical value → how many live second-hand pieces cover it. */
  stock: Record<number, number>
  /** Canonical value → how many users wear it (main or listed adjacent). */
  users: Record<number, number>
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export async function loadSecondHandSummary(): Promise<SecondHandSummary> {
  const admin = createAdminClient()
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString()

  const [{ data: liveItems }, { data: sales }, { data: rescues }] = await Promise.all([
    admin
      .from('item' as any)
      .select('item_id, product_name, image_url, stock_class, live_since, status, brand(name, source_type), merchant(source_type)')
      .eq('status', 'live'),
    admin.from('second_hand_sale' as any).select('days_live, clickouts, sold_at'),
    admin.from('outfit_rescue' as any).select('state'),
  ])

  const live = ((liveItems ?? []) as any[]).filter(
    (i) =>
      i.stock_class === 'unique' ||
      ['second_hand', 'vintage'].includes(i.merchant?.source_type) ||
      ['second_hand', 'vintage'].includes(i.brand?.source_type),
  )
  const liveUnique = live.filter((i) => i.stock_class === 'unique').length

  const saleRows = (sales ?? []) as any[]
  const daysList = saleRows.map((s) => Number(s.days_live)).filter((n) => Number.isFinite(n))
  const clickList = saleRows.map((s) => Number(s.clickouts)).filter((n) => Number.isFinite(n))

  const rescueRows = (rescues ?? []) as any[]
  const restyled = rescueRows.filter((r) => r.state === 'ready').length

  // Click-outs on live one-of-ones, so ">14 days live, nothing" is answerable.
  const uniqueIds = live.filter((i) => i.stock_class === 'unique').map((i) => i.item_id)
  const clickedIds = new Set<string>()
  if (uniqueIds.length) {
    const { data: clicks } = await admin
      .from('item_click' as any)
      .select('item_id')
      .in('item_id', uniqueIds)
    for (const c of (clicks ?? []) as any[]) clickedIds.add(c.item_id)
  }

  const now = Date.now()
  const stale = live
    .filter((i) => i.stock_class === 'unique' && i.live_since && !clickedIds.has(i.item_id))
    .map((i) => ({
      item_id: i.item_id,
      product_name: i.product_name,
      brand_name: i.brand?.name ?? null,
      image_url: i.image_url,
      days_live: (now - new Date(i.live_since).getTime()) / 864e5,
    }))
    .filter((i) => i.days_live > STALE_UNIQUE_DAYS)
    .sort((a, b) => b.days_live - a.days_live)

  return {
    liveUnique,
    liveSecondHand: live.length,
    soldAllTime: saleRows.length,
    soldLast30: saleRows.filter((s) => s.sold_at >= since30).length,
    medianDaysToSale: median(daysList),
    medianClickoutsBeforeSale: median(clickList),
    rescueConversion: {
      restyled,
      total: rescueRows.length,
      rate: rescueRows.length ? restyled / rescueRows.length : null,
    },
    stale,
  }
}

/**
 * Size coverage: our second-hand stock against our users' sizes.
 *
 * Both sides are counted on the SAME canonical ladder, so the two rows are
 * directly comparable — which is the whole point. A user is counted once for
 * her main size and once for any adjacent size she listed, because both are
 * sizes she'd actually buy.
 */
export async function loadSizeCoverage(): Promise<SizeCoverageRow[]> {
  const admin = createAdminClient()

  const [{ data: rows }, { data: profiles }] = await Promise.all([
    admin
      .from('item_size_availability' as any)
      .select('item_id, canonical_category, canonical_values, in_stock, item!inner(status, stock_class, merchant(source_type), brand(source_type))')
      .eq('in_stock', true)
      .eq('item.status', 'live'),
    admin.from('user_size_profile' as any).select('*'),
  ])

  const stockBy = new Map<SizeCategory, Map<number, number>>()
  for (const r of (rows ?? []) as any[]) {
    const item = r.item
    const secondHand =
      item?.stock_class === 'unique' ||
      ['second_hand', 'vintage'].includes(item?.merchant?.source_type) ||
      ['second_hand', 'vintage'].includes(item?.brand?.source_type)
    if (!secondHand) continue
    const cat = r.canonical_category as SizeCategory | null
    if (!cat) continue
    const map = stockBy.get(cat) ?? new Map<number, number>()
    // An alpha size covering two numbers counts for both — that IS its coverage.
    for (const v of (r.canonical_values ?? []) as number[]) {
      map.set(Number(v), (map.get(Number(v)) ?? 0) + 1)
    }
    stockBy.set(cat, map)
  }

  const usersBy = new Map<SizeCategory, Map<number, number>>()
  for (const p of (profiles ?? []) as any[]) {
    for (const cat of SIZE_CATEGORIES) {
      const map = usersBy.get(cat) ?? new Map<number, number>()
      for (const key of [cat, `${cat}_adjacent`]) {
        const v = p[key]
        if (v == null) continue
        map.set(Number(v), (map.get(Number(v)) ?? 0) + 1)
      }
      usersBy.set(cat, map)
    }
  }

  return SIZE_CATEGORIES.map((category) => {
    const ladder = ladderFor(category)
    const stock: Record<number, number> = {}
    const users: Record<number, number> = {}
    for (const size of ladder) {
      stock[size] = stockBy.get(category)?.get(size) ?? 0
      users[size] = usersBy.get(category)?.get(size) ?? 0
    }
    return { category, stock, users }
  })
}

/**
 * The gap that matters: sizes where a meaningful share of users sit and stock
 * doesn't. Sorted worst-first — this is the list to take to a partner.
 */
export interface CoverageGap {
  category: SizeCategory
  size: number
  userShare: number
  stockShare: number
  gap: number
}

export function coverageGaps(rows: SizeCoverageRow[], minUserShare = 0.05): CoverageGap[] {
  const gaps: CoverageGap[] = []
  for (const row of rows) {
    const userTotal = Object.values(row.users).reduce((a, b) => a + b, 0)
    const stockTotal = Object.values(row.stock).reduce((a, b) => a + b, 0)
    if (!userTotal) continue
    for (const [sizeStr, count] of Object.entries(row.users)) {
      const size = Number(sizeStr)
      const userShare = count / userTotal
      if (userShare < minUserShare) continue
      const stockShare = stockTotal ? row.stock[size] / stockTotal : 0
      const gap = userShare - stockShare
      if (gap > 0) gaps.push({ category: row.category, size, userShare, stockShare, gap })
    }
  }
  return gaps.sort((a, b) => b.gap - a.gap)
}
