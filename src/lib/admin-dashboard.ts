// The admin dashboard's data, loaded once and remembered.
//
// /admin used to run every query on every load — some thirty-five reads,
// several of them whole-table scans — against a database that is also
// serving the hourly crons. When the instance was busy the page took half a
// minute or died on a statement timeout. Now the whole load is cached for
// five minutes (Next's data cache, shared across function instances on
// Vercel), a stale answer is served while the next one is computed behind
// it, and every block has a time budget: a block that does not answer is
// shown as zero and NAMED on the page, never allowed to take the page down.
//
// A partial load is never cached — the next visit tries again in full.

import { unstable_cache } from 'next/cache'
import { getAdminStats } from '@/lib/admin-queries'
import { getDashboardMetrics } from '@/lib/dashboard-metrics'
import { getNetworkStatuses } from '@/lib/networks/sync'
import { getStylistBySlug, loadAutonomy } from '@/lib/stylist-store'
import { autonomyProgress } from '@/lib/autonomy'
import { loadDashboardCounts } from '@/lib/admin-queries'

export const DASHBOARD_TAG = 'admin-dashboard'
/** How long a loaded dashboard is served before it is recomputed behind the next visit. */
export const DASHBOARD_TTL_S = 300
/** The longest any one block may take before it is shown as missing. */
const BLOCK_BUDGET_MS = 25_000

export type AdminStats = Awaited<ReturnType<typeof getAdminStats>>
export type DashboardPerf = Awaited<ReturnType<typeof getDashboardMetrics>>
export type NetworkStatuses = Awaited<ReturnType<typeof getNetworkStatuses>>
export type Autonomy = ReturnType<typeof autonomyProgress>

export interface DashboardData {
  stats: AdminStats
  perf: DashboardPerf
  networks: NetworkStatuses
  waitlistCount: number
  needsDesktopCount: number
  autonomy: Autonomy | null
  /** When this data was read. */
  loadedAt: string
  /** Blocks that did not answer inside their budget and are shown as zero. */
  missing: string[]
}

class PartialDashboard extends Error {
  constructor(public data: DashboardData) {
    super('dashboard loaded partially')
  }
}

function withBudget<T>(label: string, p: Promise<T>, ms = BLOCK_BUDGET_MS): Promise<{ label: string; value: T }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} did not answer in ${Math.round(ms / 1000)}s`)), ms)
    p.then((value) => { clearTimeout(t); resolve({ label, value }) }, (err) => { clearTimeout(t); reject(err) })
  })
}

const EMPTY_STATS: AdminStats = {
  totalItems: 0, draftItems: 0, readyItems: 0, liveItems: 0, outOfStockItems: 0, lowStockItems: 0,
  totalOutfits: 0, draftOutfits: 0, liveOutfits: 0, totalProjects: 0, draftProjects: 0, liveProjects: 0, publishedToday: 0,
}

async function readDashboard(): Promise<DashboardData> {
  const t0 = Date.now()
  const missing: string[] = []
  const settled = await Promise.allSettled([
    withBudget('LIBRARY COUNTS', getAdminStats()),
    withBudget('PERFORMANCE', getDashboardMetrics()),
    withBudget('NETWORKS', getNetworkStatuses(), 10_000),
    withBudget('COUNTS', loadDashboardCounts()),
    withBudget('AUTONOMY', (async () => {
      const chloe = await getStylistBySlug('chloe')
      return chloe ? autonomyProgress(await loadAutonomy(chloe.stylist_id)) : null
    })(), 10_000),
  ])

  const take = <T,>(i: number, fallback: T): T => {
    const r = settled[i]
    if (r.status === 'fulfilled') return r.value.value as T
    const label = ['LIBRARY COUNTS', 'PERFORMANCE', 'NETWORKS', 'COUNTS', 'AUTONOMY'][i]
    console.error(`[admin dashboard] ${label}:`, r.reason instanceof Error ? r.reason.message : r.reason)
    missing.push(label)
    return fallback
  }

  const stats = take<AdminStats>(0, EMPTY_STATS)
  const perf = take<DashboardPerf | null>(1, null)
  const networks = take<NetworkStatuses>(2, [])
  const counts = take<Awaited<ReturnType<typeof loadDashboardCounts>> | null>(3, null)
  const autonomy = take<Autonomy | null>(4, null)

  if (!perf) {
    // Without the performance series there is no dashboard to draw; the
    // page shows a "busy" notice and nothing is cached.
    throw new Error('PERFORMANCE did not load')
  }

  const data: DashboardData = {
    stats,
    perf,
    networks,
    waitlistCount: counts?.waitlist ?? 0,
    needsDesktopCount: counts?.outfits.needs_desktop ?? 0,
    autonomy,
    loadedAt: new Date().toISOString(),
    missing: Array.from(new Set(missing)),
  }
  console.log(`[admin dashboard] read in ${((Date.now() - t0) / 1000).toFixed(1)}s${data.missing.length ? ` · missing ${data.missing.join(', ')}` : ''}`)
  if (data.missing.length) throw new PartialDashboard(data)
  return data
}

const cachedDashboard = unstable_cache(readDashboard, ['admin-dashboard-v1'], {
  revalidate: DASHBOARD_TTL_S,
  tags: [DASHBOARD_TAG],
})

/**
 * The dashboard's data: from the cache when it has one, otherwise read now.
 * A partial read (a block over budget) is returned for THIS page view only.
 */
export async function loadDashboard(): Promise<DashboardData> {
  try {
    return await cachedDashboard()
  } catch (err) {
    if (err instanceof PartialDashboard) return err.data
    throw err
  }
}
