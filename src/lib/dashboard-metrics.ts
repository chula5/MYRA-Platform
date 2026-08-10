// The performance layer behind /admin.
//
// Every headline number on the dashboard is defined exactly once, here, with the
// query that produces it, the direction that counts as good, and the area of the
// studio you land in when you click it. The dashboard renders this; the
// drill-down pages render this; nothing recomputes a metric locally.
//
// Weeks are Monday-start UTC. The tile always reports the last COMPLETE week —
// comparing a Tuesday against a finished week makes everything look like it's
// collapsing.

import { createAdminClient } from '@/lib/supabase-server'
import type { FormatKind } from '@/components/admin/charts/format'
import { SERIES, NETWORK_COLOR } from '@/components/admin/charts/palette'
import {
  weekBuckets,
  readSince,
  bucketCount,
  bucketSum,
  ratioSeries,
  sum,
  lastComplete,
  change,
  type Bucket,
} from '@/lib/metrics-core'

export const METRIC_KEYS = [
  'outfits-generated',
  'swap-rate',
  'commission',
  'retailer-clicks',
  'saves',
  'signups',
  'outfit-views',
  'ad-spend',
  'cost-per-signup',
  'composer-reject-rate',
  'render-failure-rate',
  'search-zero-rate',
] as const

export type MetricKey = (typeof METRIC_KEYS)[number]

export interface MetricSnapshot {
  key: MetricKey
  label: string
  /** One line explaining exactly how the number is derived. Shown on drill-down. */
  definition: string
  format: FormatKind
  /** Value for the last complete week. */
  current: number
  previous: number | null
  /** Fractional week-on-week change; null when there's no baseline. */
  delta: number | null
  /** True when a FALL is the good outcome (swap rate, error rates, cost per sign-up). */
  inverted: boolean
  series: number[]
  labels: string[]
  colour: string
  /** Where to go to act on this number. */
  area: { label: string; href: string }
  /** Extra context under the number on the tile. */
  sub?: string
  /** False when the underlying table isn't there yet (migration not run). */
  available: boolean
  /** Set when the metric has crossed a threshold that needs attention. */
  alert?: string
}

export interface AreaHealth {
  label: string
  href: string
  /** The headline health figure for this area, pre-formatted. */
  value: string
  /** What the figure is. */
  caption: string
  tone: 'good' | 'warning' | 'critical' | 'neutral'
  detail: string
}

export interface DashboardMetrics {
  buckets: Bucket[]
  metrics: Record<MetricKey, MetricSnapshot>
  areas: AreaHealth[]
  /** Rolled-up money view for the hero strip. */
  money: {
    commissionThisWeek: number
    commissionPrevWeek: number
    spendThisWeek: number
    spendPrevWeek: number
    netThisWeek: number
    commissionSeries: number[]
    spendSeries: number[]
    /** Commission split by network over the whole window. */
    byNetwork: { network: string; label: string; value: number; colour: string }[]
    commissionsTableReady: boolean
    adSpendTableReady: boolean
  }
}

const WEEKS = 10

function metric(
  partial: Omit<MetricSnapshot, 'current' | 'previous' | 'delta'> & { series: number[] },
): MetricSnapshot {
  const { current, previous } = lastComplete(partial.series)
  return { ...partial, current, previous, delta: change(current, previous) }
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const buckets = weekBuckets(WEEKS)
  const labels = buckets.map((b) => b.label)
  const since = buckets[0].start

  const admin = createAdminClient()

  const [
    composed,
    outfits,
    itemClicks,
    savedOutfits,
    savedItems,
    landing,
    commissions,
    adSpend,
    signupDates,
    stockCounts,
  ] = await Promise.all([
    readSince<{ created_at: string; decided_at: string | null; status: string; overridden: boolean; lane: string; prerender_status: string }>(
      'composed_outfit',
      'created_at',
      since,
      'created_at, decided_at, status, overridden, lane, prerender_status',
    ),
    readSince<{ created_at: string; published_at: string | null; status: string }>(
      'outfit',
      'created_at',
      since,
      'created_at, published_at, status',
    ),
    readSince<{ clicked_at: string }>('item_click', 'clicked_at', since, 'clicked_at'),
    readSince<{ created_at: string }>('saved_outfit', 'created_at', since, 'created_at'),
    readSince<{ created_at: string }>('saved_item', 'created_at', since, 'created_at'),
    readSince<{ occurred_at: string; event_type: string; result_count: number | null }>(
      'landing_event',
      'occurred_at',
      since,
      'occurred_at, event_type, result_count',
    ),
    readSince<{ occurred_at: string; commission_gbp: number; status: string; network: string }>(
      'commission_transaction',
      'occurred_at',
      since,
      'occurred_at, commission_gbp, status, network',
    ),
    readSince<{ spend_date: string; spend_gbp: number; platform: string }>(
      'ad_spend_daily',
      'spend_date',
      since,
      'spend_date, spend_gbp, platform',
      { columnType: 'date' },
    ),
    listSignupDates(),
    currentStockCounts(),
  ])

  // ── Composition ───────────────────────────────────────────────────────────
  // Outfits generated = candidates the composer staged. Falls back to real
  // outfit rows for the period before the pipeline existed.
  const generatedSeries = bucketCount(composed.rows, 'created_at', buckets)
  const outfitCreatedSeries = bucketCount(outfits.rows, 'created_at', buckets)
  const generated = sum(generatedSeries) > 0 ? generatedSeries : outfitCreatedSeries
  const usingFallback = sum(generatedSeries) === 0 && sum(outfitCreatedSeries) > 0

  const decided = composed.rows.filter((r) => r.decided_at)
  const decidedSeries = bucketCount(decided, 'decided_at', buckets)
  const swappedSeries = bucketCount(decided, 'decided_at', buckets, (r) => r.overridden === true)
  const rejectedSeries = bucketCount(decided, 'decided_at', buckets, (r) => r.status === 'rejected')

  // Swap rate reads against outfits PRODUCED in the week, which is what the
  // autonomy gate measures too — decided-but-untouched looks still count in the
  // denominator, so the rate can't be gamed by reviewing less.
  const swapRateSeries = ratioSeries(swappedSeries, decidedSeries)
  const rejectRateSeries = ratioSeries(rejectedSeries, decidedSeries)

  const renderAttempted = composed.rows.filter((r) => r.prerender_status === 'done' || r.prerender_status === 'failed')
  const renderFailSeries = ratioSeries(
    bucketCount(renderAttempted, 'created_at', buckets, (r) => r.prerender_status === 'failed'),
    bucketCount(renderAttempted, 'created_at', buckets),
  )

  // ── Demand ────────────────────────────────────────────────────────────────
  const clickSeries = bucketCount(itemClicks.rows, 'clicked_at', buckets)
  const savedItemSeries = bucketCount(savedItems.rows, 'created_at', buckets)
  const saveSeries = bucketCount(savedOutfits.rows, 'created_at', buckets).map((v, i) => v + savedItemSeries[i])
  const viewSeries = bucketCount(landing.rows, 'occurred_at', buckets, (r) => r.event_type === 'outfit_view')
  const searches = landing.rows.filter((r) => r.event_type === 'search')
  const searchZeroSeries = ratioSeries(
    bucketCount(searches, 'occurred_at', buckets, (r) => (r.result_count ?? 0) === 0),
    bucketCount(searches, 'occurred_at', buckets),
  )
  const signupSeries = bucketCount(
    signupDates.map((d) => ({ created_at: d })),
    'created_at',
    buckets,
  )

  // ── Money ─────────────────────────────────────────────────────────────────
  // Declined transactions are excluded — a returned order was never revenue.
  const earning = commissions.rows.filter((r) => r.status !== 'declined')
  const commissionSeries = bucketSum(earning, 'occurred_at', 'commission_gbp', buckets)
  // spend_date is a DATE; normalise to midday UTC so a bucket boundary can't
  // drop a day to the wrong week.
  const spendRows = adSpend.rows.map((r) => ({ ...r, _t: `${r.spend_date}T12:00:00Z` }))
  const spendSeries = bucketSum(spendRows, '_t', 'spend_gbp', buckets)
  const costPerSignupSeries = spendSeries.map((s, i) => (signupSeries[i] > 0 ? s / signupSeries[i] : 0))

  const networkTotals = new Map<string, number>()
  for (const r of earning) {
    networkTotals.set(r.network, (networkTotals.get(r.network) ?? 0) + Number(r.commission_gbp ?? 0))
  }

  const m: Record<MetricKey, MetricSnapshot> = {
    'outfits-generated': metric({
      key: 'outfits-generated',
      label: 'OUTFITS GENERATED',
      definition: usingFallback
        ? 'Outfit rows created per week. The composer pipeline has no staged candidates in this window, so real outfits are counted instead.'
        : 'Candidates the composer staged per week (composed_outfit rows created), before review.',
      format: 'count',
      series: generated,
      labels,
      inverted: false,
      colour: SERIES[0],
      area: { label: 'OUTFIT COMPOSER', href: '/admin/composer' },
      sub: 'PER WEEK',
      available: composed.available || outfits.available,
    }),
    'swap-rate': metric({
      key: 'swap-rate',
      label: 'SWAP RATE',
      definition:
        'Share of outfits decided in the week where at least one item was swapped before approval (composed_outfit.overridden), over all outfits decided that week. This is the figure the autonomy gate watches — above 10% demotes the stylist to full review.',
      format: 'pct',
      series: swapRateSeries,
      labels,
      inverted: true,
      colour: SERIES[2],
      area: { label: 'OUTFIT REVIEW', href: '/admin/outfit-review' },
      sub: 'OF OUTFITS PRODUCED',
      available: composed.available,
      alert: (lastComplete(swapRateSeries).current ?? 0) > 0.1 ? 'ABOVE THE 10% AUTONOMY CEILING' : undefined,
    }),
    commission: metric({
      key: 'commission',
      label: 'COMMISSION',
      definition:
        'Commission earned per week across Awin, Rakuten and CJ, excluding declined transactions. Pending sales are included — they are inside the return window, not lost.',
      format: 'gbp0',
      series: commissionSeries,
      labels,
      inverted: false,
      colour: SERIES[0],
      area: { label: 'COMMISSIONS', href: '/admin/commissions' },
      sub: 'ALL NETWORKS',
      available: commissions.available,
    }),
    'retailer-clicks': metric({
      key: 'retailer-clicks',
      label: 'RETAILER CLICKS',
      definition: 'Click-throughs from MYRA to a retailer product page per week (item_click). Every outbound click is logged, affiliate or not.',
      format: 'count',
      series: clickSeries,
      labels,
      inverted: false,
      colour: SERIES[1],
      area: { label: 'ANALYTICS', href: '/admin/analytics' },
      sub: 'OUTBOUND',
      available: itemClicks.available,
    }),
    saves: metric({
      key: 'saves',
      label: 'SAVES',
      definition: 'Outfits and individual items saved to a wardrobe per week (saved_outfit + saved_item).',
      format: 'count',
      series: saveSeries,
      labels,
      inverted: false,
      colour: SERIES[3],
      area: { label: 'PREFERENCES', href: '/admin/signup-preferences' },
      sub: 'OUTFITS + ITEMS',
      available: savedOutfits.available || savedItems.available,
    }),
    signups: metric({
      key: 'signups',
      label: 'SIGN-UPS',
      definition: 'Accounts created per week (Supabase Auth users).',
      format: 'count',
      series: signupSeries,
      labels,
      inverted: false,
      colour: SERIES[1],
      area: { label: 'SIGN UPS', href: '/admin/signups' },
      sub: 'NEW ACCOUNTS',
      available: true,
    }),
    'outfit-views': metric({
      key: 'outfit-views',
      label: 'OUTFIT VIEWS',
      definition: 'Outfit detail views per week (landing_event of type outfit_view).',
      format: 'count',
      series: viewSeries,
      labels,
      inverted: false,
      colour: SERIES[1],
      area: { label: 'ANALYTICS', href: '/admin/analytics' },
      sub: 'THE EDIT',
      available: landing.available,
    }),
    'ad-spend': metric({
      key: 'ad-spend',
      label: 'AD SPEND',
      definition: 'Paid media spend per week, in GBP, pulled from the Meta ad account.',
      format: 'gbp0',
      series: spendSeries,
      labels,
      inverted: true,
      colour: SERIES[2],
      area: { label: 'AD SPEND', href: '/admin/ad-spend' },
      sub: 'META',
      available: adSpend.available,
    }),
    'cost-per-signup': metric({
      key: 'cost-per-signup',
      label: 'COST PER SIGN-UP',
      definition:
        'Ad spend divided by accounts created in the same week. First-party — it counts MYRA sign-ups from Supabase, not Meta-attributed conversions.',
      format: 'gbp',
      series: costPerSignupSeries,
      labels,
      inverted: true,
      colour: SERIES[2],
      area: { label: 'AD SPEND', href: '/admin/ad-spend' },
      sub: 'SPEND ÷ SIGN-UPS',
      available: adSpend.available,
    }),
    'composer-reject-rate': metric({
      key: 'composer-reject-rate',
      label: 'COMPOSER REJECT RATE',
      definition: 'Share of decided composer candidates that were rejected outright. The composer\'s error rate — how often it proposes a look that is simply wrong.',
      format: 'pct',
      series: rejectRateSeries,
      labels,
      inverted: true,
      colour: SERIES[2],
      area: { label: 'PIPELINE', href: '/admin/pipeline' },
      sub: 'OF DECIDED',
      available: composed.available,
    }),
    'render-failure-rate': metric({
      key: 'render-failure-rate',
      label: 'RENDER FAILURE RATE',
      definition: 'Share of pre-renders that failed, over all pre-renders that finished (prerender_status failed vs done).',
      format: 'pct',
      series: renderFailSeries,
      labels,
      inverted: true,
      colour: SERIES[2],
      area: { label: 'PIPELINE', href: '/admin/pipeline' },
      sub: 'OF ATTEMPTED',
      available: composed.available,
    }),
    'search-zero-rate': metric({
      key: 'search-zero-rate',
      label: 'EMPTY SEARCH RATE',
      definition: 'Share of searches that returned nothing. Search is meant never to come back empty, so anything above zero is a gap in the library or the taxonomy.',
      format: 'pct',
      series: searchZeroSeries,
      labels,
      inverted: true,
      colour: SERIES[2],
      area: { label: 'PREFERENCES', href: '/admin/signup-preferences' },
      sub: 'OF SEARCHES',
      available: landing.available,
    }),
  }

  // ── Area health ───────────────────────────────────────────────────────────
  const pendingReview = await countRows(admin, 'composed_outfit', (q) => q.eq('status', 'pending'))
  const needsDesktop = await countRows(admin, 'outfit', (q) => q.eq('status', 'needs_desktop'))
  const liveOutfits = await countRows(admin, 'outfit', (q) => q.eq('status', 'live'))

  const flaggedRate = stockCounts.total > 0 ? stockCounts.flagged / stockCounts.total : 0

  const areas: AreaHealth[] = [
    {
      label: 'OUTFIT COMPOSER',
      href: '/admin/composer',
      value: pct(m['composer-reject-rate'].current),
      caption: 'REJECT RATE',
      tone: rateTone(m['composer-reject-rate'].current, 0.2, 0.35),
      detail: `${fmtInt(m['outfits-generated'].current)} GENERATED LAST WEEK`,
    },
    {
      label: 'OUTFIT REVIEW',
      href: '/admin/outfit-review',
      value: pct(m['swap-rate'].current),
      caption: 'SWAP RATE',
      tone: rateTone(m['swap-rate'].current, 0.1, 0.2),
      detail: `${fmtInt(pendingReview)} AWAITING REVIEW`,
    },
    {
      label: 'PIPELINE',
      href: '/admin/pipeline',
      value: pct(m['render-failure-rate'].current),
      caption: 'RENDER FAILURE RATE',
      tone: rateTone(m['render-failure-rate'].current, 0.05, 0.15),
      detail: `${fmtInt(needsDesktop)} KICKED BACK FROM MOBILE`,
    },
    {
      label: 'STOCK',
      href: '/admin/stock-impact',
      value: pct(flaggedRate),
      caption: 'ITEMS FLAGGED',
      tone: rateTone(flaggedRate, 0.1, 0.25),
      detail: `${fmtInt(stockCounts.out)} OUT · ${fmtInt(stockCounts.low)} LOW`,
    },
    {
      label: 'SEARCH',
      href: '/admin/signup-preferences',
      value: pct(m['search-zero-rate'].current),
      caption: 'EMPTY RESULT RATE',
      tone: rateTone(m['search-zero-rate'].current, 0.001, 0.05),
      detail: 'SEARCH SHOULD NEVER RETURN EMPTY',
    },
    {
      label: 'THE EDIT',
      href: '/admin/the-edit',
      value: fmtInt(liveOutfits),
      caption: 'OUTFITS LIVE',
      tone: liveOutfits > 0 ? 'good' : 'warning',
      detail: `${fmtInt(m['outfit-views'].current)} VIEWS LAST WEEK`,
    },
  ]

  const commissionThisWeek = m.commission.current
  const commissionPrevWeek = m.commission.previous ?? 0
  const spendThisWeek = m['ad-spend'].current
  const spendPrevWeek = m['ad-spend'].previous ?? 0

  return {
    buckets,
    metrics: m,
    areas,
    money: {
      commissionThisWeek,
      commissionPrevWeek,
      spendThisWeek,
      spendPrevWeek,
      netThisWeek: commissionThisWeek - spendThisWeek,
      commissionSeries,
      spendSeries,
      byNetwork: ['awin', 'rakuten', 'cj'].map((n) => ({
        network: n,
        label: n.toUpperCase(),
        value: networkTotals.get(n) ?? 0,
        colour: NETWORK_COLOR[n],
      })),
      commissionsTableReady: commissions.available,
      adSpendTableReady: adSpend.available,
    },
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

function fmtInt(v: number): string {
  return Math.round(v).toLocaleString('en-GB')
}

/** Green under `warn`, amber under `bad`, red at or above it. */
function rateTone(v: number, warn: number, bad: number): AreaHealth['tone'] {
  if (!Number.isFinite(v)) return 'neutral'
  if (v >= bad) return 'critical'
  if (v > warn) return 'warning'
  return 'good'
}

async function countRows(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  refine?: (q: any) => any,
): Promise<number> {
  try {
    let q = admin.from(table as any).select('*', { count: 'exact', head: true })
    if (refine) q = refine(q)
    const { count, error } = await q
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

async function currentStockCounts(): Promise<{ total: number; out: number; low: number; flagged: number }> {
  const admin = createAdminClient()
  try {
    const [{ count: total }, { count: out }, { count: low }] = await Promise.all([
      admin.from('item').select('*', { count: 'exact', head: true }),
      admin.from('item').select('*', { count: 'exact', head: true }).eq('stock_status', 'out_of_stock'),
      admin.from('item').select('*', { count: 'exact', head: true }).eq('stock_status', 'low_stock'),
    ])
    return { total: total ?? 0, out: out ?? 0, low: low ?? 0, flagged: (out ?? 0) + (low ?? 0) }
  } catch {
    return { total: 0, out: 0, low: 0, flagged: 0 }
  }
}

/** Every auth user's created_at, paged. Returns [] if the admin API is unavailable. */
async function listSignupDates(): Promise<string[]> {
  const admin = createAdminClient()
  const out: string[] = []
  try {
    for (let page = 1; page <= 10; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      const users = data?.users ?? []
      out.push(...users.map((u) => u.created_at as string).filter(Boolean))
      if (users.length < 200) break
    }
  } catch {
    /* listUsers unavailable in this environment */
  }
  return out
}

export function getMetric(all: DashboardMetrics, key: string): MetricSnapshot | null {
  return (METRIC_KEYS as readonly string[]).includes(key) ? all.metrics[key as MetricKey] : null
}
