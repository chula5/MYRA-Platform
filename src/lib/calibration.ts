// Weekly calibration report — every Monday (cron) or on demand:
//   • fast-lane share of staged outfits + override rate
//   • newly quarantined items ("retire or keep?")
//   • top swap-delta rules learned this week
//   • catalogue gaps where visitor demand outruns supply (taste radar)
import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { loadSiteTasteProfile } from '@/lib/style-brain-store'
import { loadSwapRules, loadQuarantinedItems, loadPipelineConfig } from '@/lib/pipeline-store'
import { QUARANTINE_AFTER } from '@/lib/pipeline'

export interface CalibrationReport {
  week_start: string
  window: { from: string; to: string }
  fastLane: { staged: number; fast: number; share: number; decided: number; overrides: number; overrideRate: number; threshold: number }
  newlyQuarantined: { item_id: string; name: string; ejections: number }[]
  topSwapRules: { rule: string; count: number }[]
  catalogueGaps: { axis: string; demand: number; supply: number; gap: number }[]
}

// Monday 00:00 of the week containing `d` (UTC).
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = x.getUTCDay()
  x.setUTCDate(x.getUTCDate() - ((day + 6) % 7))
  return x
}

export async function buildCalibrationReport(now = new Date()): Promise<{ report: CalibrationReport; md: string } | null> {
  try {
    const admin = createAdminClient()
    const weekStart = mondayOf(now)
    const from = new Date(weekStart.getTime() - 7 * 24 * 3600 * 1000) // the week just ended
    const fromIso = from.toISOString()
    const toIso = weekStart.toISOString()

    // Fast-lane share + override rate over the window.
    const { data: stagedRows } = await admin
      .from('composed_outfit' as any)
      .select('lane, status, overridden, created_at, decided_at')
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
    const staged = (stagedRows ?? []) as any[]
    const fastStaged = staged.filter((r) => r.lane === 'fast' || r.overridden).length
    const decided = staged.filter((r) => r.status !== 'pending')
    const overrides = staged.filter((r) => r.overridden).length
    const config = await loadPipelineConfig()

    // Newly quarantined: crossed the threshold during the window.
    const { data: ej } = await admin
      .from('item_ejection' as any)
      .select('item_id, created_at')
      .limit(20000)
    const before = new Map<string, number>()
    const after = new Map<string, number>()
    for (const r of (ej ?? []) as any[]) {
      if (r.created_at < fromIso) before.set(r.item_id, (before.get(r.item_id) ?? 0) + 1)
      if (r.created_at < toIso) after.set(r.item_id, (after.get(r.item_id) ?? 0) + 1)
    }
    const newIds = [...Array.from(after.entries())]
      .filter(([id, n]) => n >= QUARANTINE_AFTER && (before.get(id) ?? 0) < QUARANTINE_AFTER)
      .map(([id]) => id)
    let newlyQuarantined: CalibrationReport['newlyQuarantined'] = []
    if (newIds.length) {
      const { data: items } = await admin
        .from('item' as any)
        .select('item_id, product_name, brand:brand_id(name)')
        .in('item_id', newIds)
      newlyQuarantined = ((items ?? []) as any[]).map((it) => ({
        item_id: it.item_id,
        name: [it.brand?.name, it.product_name].filter(Boolean).join(' — '),
        ejections: after.get(it.item_id) ?? 0,
      }))
    }

    // Top swap-delta rules learned this week.
    const rules = await loadSwapRules(3, fromIso)
    const topSwapRules = rules.map((r) => ({
      rule: `${r.slot} · ${r.formality_band}: ${r.dimension.replace(/_/g, ' ')} ${r.from_value} → ${r.to_value}`,
      count: r.count,
    }))

    // Catalogue gaps: taste-radar axes where the visitor (dashed) line exceeds
    // the catalogue line by a meaningful margin.
    const profile = await loadSiteTasteProfile()
    const catalogueGaps = (profile?.hasPeople ? profile.axes : [])
      .filter((a) => a.people - a.catalogue > 0.05)
      .map((a) => ({ axis: a.label, demand: a.people, supply: a.catalogue, gap: a.people - a.catalogue }))
      .sort((a, b) => b.gap - a.gap)

    const report: CalibrationReport = {
      week_start: weekStart.toISOString().slice(0, 10),
      window: { from: fromIso, to: toIso },
      fastLane: {
        staged: staged.length,
        fast: fastStaged,
        share: staged.length ? fastStaged / staged.length : 0,
        decided: decided.length,
        overrides,
        overrideRate: fastStaged ? overrides / fastStaged : 0,
        threshold: config.fast_lane_threshold,
      },
      newlyQuarantined,
      topSwapRules,
      catalogueGaps,
    }

    const pc = (x: number) => `${Math.round(x * 100)}%`
    const L: string[] = []
    L.push(`# Calibration report — week of ${report.week_start}`)
    L.push('')
    L.push('## Fast lane')
    L.push(`- ${report.fastLane.staged} outfits staged, ${report.fastLane.fast} fast-lane (${pc(report.fastLane.share)} share)`)
    L.push(`- Override rate: ${pc(report.fastLane.overrideRate)} (${report.fastLane.overrides} overrides)`)
    L.push(`- Current threshold: ${report.fastLane.threshold}`)
    L.push('')
    L.push('## Newly quarantined items (retire or keep?)')
    if (report.newlyQuarantined.length) report.newlyQuarantined.forEach((q) => L.push(`- ${q.name} — ejected ${q.ejections}×`))
    else L.push('- None this week')
    L.push('')
    L.push('## Top swap-delta rules learned')
    if (report.topSwapRules.length) report.topSwapRules.forEach((r) => L.push(`- ${r.rule} (${r.count}×)`))
    else L.push('- No new rules this week')
    L.push('')
    L.push('## Catalogue gaps (demand > supply)')
    if (report.catalogueGaps.length) {
      report.catalogueGaps.forEach((g) =>
        L.push(`- ${g.axis}: visitors ${g.demand.toFixed(2)} vs catalogue ${g.supply.toFixed(2)} (gap ${g.gap.toFixed(2)})`),
      )
    } else L.push('- No meaningful gaps — supply tracks demand')
    const md = L.join('\n')

    await (admin.from('calibration_report') as any).upsert(
      { week_start: report.week_start, report, report_md: md },
      { onConflict: 'week_start' },
    )
    return { report, md }
  } catch (err) {
    console.error('[buildCalibrationReport]', err)
    return null
  }
}

export async function loadLatestCalibrationReport(): Promise<{ week_start: string; report_md: string } | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('calibration_report' as any)
      .select('week_start, report_md')
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data as any) ?? null
  } catch {
    return null
  }
}
