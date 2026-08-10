// What sits underneath a headline number.
//
// A metric on its own tells you something moved. These breakdowns tell you what
// moved it — which advertiser, which item, which query came back empty — so the
// drill-down page ends in something you can act on rather than another chart.

import { createAdminClient } from '@/lib/supabase-server'
import { weekBuckets } from '@/lib/metrics-core'
import type { MetricKey } from '@/lib/dashboard-metrics'
import type { RankRow } from '@/components/admin/charts/RankBars'
import { NETWORK_COLOR } from '@/components/admin/charts/palette'

export interface Breakdown {
  title: string
  /** How the values in this list should read. */
  format: 'count' | 'gbp'
  rows: RankRow[]
  empty: string
}

const WINDOW_WEEKS = 10

function windowStart(): Date {
  return weekBuckets(WINDOW_WEEKS)[0].start
}

function top<T>(map: Map<string, T>, value: (v: T) => number, limit = 10): [string, T][] {
  return Array.from(map.entries()).sort((a, b) => value(b[1]) - value(a[1])).slice(0, limit)
}

export async function getBreakdowns(key: MetricKey): Promise<Breakdown[]> {
  const admin = createAdminClient()
  const since = windowStart().toISOString()

  try {
    switch (key) {
      case 'commission': {
        const { data } = await admin
          .from('commission_transaction' as any)
          .select('network, status, advertiser_name, commission_gbp')
          .gte('occurred_at', since)
          .limit(2000)
        const rows = (data ?? []) as any[]

        const byAdvertiser = new Map<string, number>()
        const byStatus = new Map<string, number>()
        const byNetwork = new Map<string, number>()
        for (const r of rows) {
          const c = Number(r.commission_gbp ?? 0)
          if (r.status !== 'declined') {
            byAdvertiser.set(r.advertiser_name ?? 'UNATTRIBUTED', (byAdvertiser.get(r.advertiser_name ?? 'UNATTRIBUTED') ?? 0) + c)
            byNetwork.set(r.network, (byNetwork.get(r.network) ?? 0) + c)
          }
          byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + c)
        }

        return [
          {
            title: 'BY ADVERTISER',
            format: 'gbp',
            rows: top(byAdvertiser, (v) => v).map(([label, value]) => ({ label: label.toUpperCase(), value })),
            empty: 'NO COMMISSION SYNCED YET',
          },
          {
            title: 'BY NETWORK',
            format: 'gbp',
            rows: top(byNetwork, (v) => v).map(([label, value]) => ({
              label: label.toUpperCase(),
              value,
              colour: NETWORK_COLOR[label],
            })),
            empty: 'NO COMMISSION SYNCED YET',
          },
          {
            title: 'BY STATUS',
            format: 'gbp',
            rows: ['approved', 'paid', 'pending', 'declined']
              .filter((s) => byStatus.has(s))
              .map((s) => ({ label: s.toUpperCase(), value: byStatus.get(s) ?? 0 })),
            empty: 'NO COMMISSION SYNCED YET',
          },
        ]
      }

      case 'retailer-clicks': {
        const { data } = await admin
          .from('item_click' as any)
          .select('item_id')
          .gte('clicked_at', since)
          .limit(20000)
        const counts = new Map<string, number>()
        for (const r of (data ?? []) as any[]) counts.set(r.item_id, (counts.get(r.item_id) ?? 0) + 1)
        const ids = top(counts, (v) => v, 12).map(([id]) => id)
        const labels = await labelItems(ids)
        return [
          {
            title: 'MOST-CLICKED ITEMS',
            format: 'count',
            rows: ids.map((id) => ({
              label: labels.get(id) ?? id.slice(0, 8),
              value: counts.get(id) ?? 0,
              href: `/admin/items/${id}`,
            })),
            empty: 'NO CLICKS IN THIS WINDOW',
          },
        ]
      }

      case 'saves': {
        const [{ data: so }, { data: si }] = await Promise.all([
          admin.from('saved_outfit' as any).select('outfit_id').gte('created_at', since).limit(20000),
          admin.from('saved_item' as any).select('item_id').gte('created_at', since).limit(20000),
        ])
        const outfitCounts = new Map<string, number>()
        for (const r of (so ?? []) as any[]) outfitCounts.set(r.outfit_id, (outfitCounts.get(r.outfit_id) ?? 0) + 1)
        const itemCounts = new Map<string, number>()
        for (const r of (si ?? []) as any[]) itemCounts.set(r.item_id, (itemCounts.get(r.item_id) ?? 0) + 1)

        const outfitIds = top(outfitCounts, (v) => v, 10).map(([id]) => id)
        const itemIds = top(itemCounts, (v) => v, 10).map(([id]) => id)
        const [outfitLabels, itemLabels] = await Promise.all([labelOutfits(outfitIds), labelItems(itemIds)])

        return [
          {
            title: 'MOST-SAVED OUTFITS',
            format: 'count',
            rows: outfitIds.map((id) => ({
              label: outfitLabels.get(id) ?? id.slice(0, 8),
              value: outfitCounts.get(id) ?? 0,
              href: `/admin/outfit-review`,
            })),
            empty: 'NO OUTFIT SAVES IN THIS WINDOW',
          },
          {
            title: 'MOST-SAVED ITEMS',
            format: 'count',
            rows: itemIds.map((id) => ({
              label: itemLabels.get(id) ?? id.slice(0, 8),
              value: itemCounts.get(id) ?? 0,
              href: `/admin/items/${id}`,
            })),
            empty: 'NO ITEM SAVES IN THIS WINDOW',
          },
        ]
      }

      case 'outfits-generated':
      case 'composer-reject-rate':
      case 'render-failure-rate': {
        const { data } = await admin
          .from('composed_outfit' as any)
          .select('lane, status, prerender_status, reasons')
          .gte('created_at', since)
          .limit(5000)
        const rows = (data ?? []) as any[]

        const byLane = new Map<string, number>()
        const byStatus = new Map<string, number>()
        const byReason = new Map<string, number>()
        const byRender = new Map<string, number>()
        for (const r of rows) {
          byLane.set(r.lane ?? 'standard', (byLane.get(r.lane ?? 'standard') ?? 0) + 1)
          byStatus.set(r.status ?? 'pending', (byStatus.get(r.status ?? 'pending') ?? 0) + 1)
          byRender.set(r.prerender_status ?? 'none', (byRender.get(r.prerender_status ?? 'none') ?? 0) + 1)
          const reasons = Array.isArray(r.reasons) ? r.reasons : []
          for (const reason of reasons) {
            const text = typeof reason === 'string' ? reason : (reason?.reason ?? reason?.message ?? JSON.stringify(reason))
            const clean = String(text).slice(0, 70).toUpperCase()
            byReason.set(clean, (byReason.get(clean) ?? 0) + 1)
          }
        }

        return [
          {
            title: 'BY LANE',
            format: 'count',
            rows: top(byLane, (v) => v).map(([label, value]) => ({ label: label.toUpperCase(), value })),
            empty: 'NO CANDIDATES IN THIS WINDOW',
          },
          {
            title: 'BY OUTCOME',
            format: 'count',
            rows: top(byStatus, (v) => v).map(([label, value]) => ({ label: label.toUpperCase(), value })),
            empty: 'NO CANDIDATES IN THIS WINDOW',
          },
          {
            title: 'WHY CANDIDATES SCORED LOW',
            format: 'count',
            rows: top(byReason, (v) => v, 12).map(([label, value]) => ({ label, value })),
            empty: 'NO CRITIQUE REASONS RECORDED',
          },
          {
            title: 'PRE-RENDER OUTCOME',
            format: 'count',
            rows: top(byRender, (v) => v).map(([label, value]) => ({ label: label.toUpperCase(), value })),
            empty: 'NO PRE-RENDERS IN THIS WINDOW',
          },
        ]
      }

      case 'swap-rate': {
        const { data } = await admin
          .from('item_ejection' as any)
          .select('item_id, slot, formality_band')
          .gte('created_at', since)
          .limit(5000)
        const rows = (data ?? []) as any[]
        const byItem = new Map<string, number>()
        const bySlot = new Map<string, number>()
        for (const r of rows) {
          if (r.item_id) byItem.set(r.item_id, (byItem.get(r.item_id) ?? 0) + 1)
          bySlot.set(r.slot ?? 'UNKNOWN', (bySlot.get(r.slot ?? 'UNKNOWN') ?? 0) + 1)
        }
        const ids = top(byItem, (v) => v, 12).map(([id]) => id)
        const labels = await labelItems(ids)

        return [
          {
            title: 'MOST-SWAPPED-OUT ITEMS',
            format: 'count',
            rows: ids.map((id) => ({
              label: labels.get(id) ?? id.slice(0, 8),
              value: byItem.get(id) ?? 0,
              href: `/admin/items/${id}`,
            })),
            empty: 'NO SWAPS RECORDED IN THIS WINDOW',
          },
          {
            title: 'BY SLOT',
            format: 'count',
            rows: top(bySlot, (v) => v).map(([label, value]) => ({ label: label.toUpperCase(), value })),
            empty: 'NO SWAPS RECORDED IN THIS WINDOW',
          },
        ]
      }

      case 'search-zero-rate': {
        const { data } = await admin
          .from('landing_event' as any)
          .select('path, result_count')
          .eq('event_type', 'search')
          .gte('occurred_at', since)
          .limit(10000)
        const empty = new Map<string, number>()
        const all = new Map<string, number>()
        for (const r of (data ?? []) as any[]) {
          const q = String(r.path ?? '').trim().toUpperCase()
          if (!q) continue
          all.set(q, (all.get(q) ?? 0) + 1)
          if ((r.result_count ?? 0) === 0) empty.set(q, (empty.get(q) ?? 0) + 1)
        }
        return [
          {
            title: 'SEARCHES THAT RETURNED NOTHING',
            format: 'count',
            rows: top(empty, (v) => v, 15).map(([label, value]) => ({ label, value })),
            empty: 'EVERY SEARCH RETURNED RESULTS',
          },
          {
            title: 'MOST-SEARCHED TERMS',
            format: 'count',
            rows: top(all, (v) => v, 15).map(([label, value]) => ({ label, value })),
            empty: 'NO SEARCHES IN THIS WINDOW',
          },
        ]
      }

      case 'ad-spend':
      case 'cost-per-signup': {
        const { data } = await admin
          .from('ad_spend_daily' as any)
          .select('campaign_name, campaign_id, spend_gbp, clicks, impressions')
          .gte('spend_date', since.slice(0, 10))
          .limit(2000)
        const byCampaign = new Map<string, { spend: number; clicks: number }>()
        for (const r of (data ?? []) as any[]) {
          const name = (r.campaign_name ?? r.campaign_id ?? '(ACCOUNT)').toUpperCase()
          const prev = byCampaign.get(name) ?? { spend: 0, clicks: 0 }
          byCampaign.set(name, { spend: prev.spend + Number(r.spend_gbp ?? 0), clicks: prev.clicks + Number(r.clicks ?? 0) })
        }
        return [
          {
            title: 'SPEND BY CAMPAIGN',
            format: 'gbp',
            rows: top(byCampaign, (v) => v.spend, 12).map(([label, v]) => ({
              label,
              value: v.spend,
              note: `${v.clicks.toLocaleString('en-GB')} CLICKS`,
            })),
            empty: 'NO SPEND SYNCED YET',
          },
        ]
      }

      case 'outfit-views': {
        const { data } = await admin
          .from('landing_event' as any)
          .select('path')
          .eq('event_type', 'outfit_view')
          .gte('occurred_at', since)
          .limit(20000)
        const counts = new Map<string, number>()
        for (const r of (data ?? []) as any[]) counts.set(r.path, (counts.get(r.path) ?? 0) + 1)
        const ids = top(counts, (v) => v, 12).map(([id]) => id)
        const labels = await labelOutfits(ids)
        return [
          {
            title: 'MOST-VIEWED OUTFITS',
            format: 'count',
            rows: ids.map((id) => ({ label: labels.get(id) ?? id.slice(0, 8), value: counts.get(id) ?? 0 })),
            empty: 'NO OUTFIT VIEWS IN THIS WINDOW',
          },
        ]
      }

      default:
        return []
    }
  } catch (err) {
    console.error('[getBreakdowns]', err)
    return []
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function labelItems(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const clean = ids.filter((i) => UUID_RE.test(i))
  if (!clean.length) return out
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('item' as any).select('item_id, product_name, brand(name)').in('item_id', clean)
    for (const r of (data ?? []) as any[]) {
      out.set(r.item_id, [r.brand?.name, r.product_name].filter(Boolean).join(' — ').toUpperCase() || r.item_id)
    }
  } catch {
    /* labels are a nicety — ids still render */
  }
  return out
}

async function labelOutfits(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const clean = ids.filter((i) => UUID_RE.test(i))
  if (!clean.length) return out
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('outfit' as any).select('outfit_id, aesthetic_label, occasion_tags').in('outfit_id', clean)
    for (const r of (data ?? []) as any[]) {
      out.set(r.outfit_id, String(r.aesthetic_label || r.occasion_tags?.[0] || 'OUTFIT').toUpperCase())
    }
  } catch {
    /* labels are a nicety — ids still render */
  }
  return out
}
