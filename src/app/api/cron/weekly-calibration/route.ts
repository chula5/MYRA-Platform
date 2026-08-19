// Weekly calibration cron — Mondays 07:00 UTC (see vercel.json).
// 1. Builds the calibration report (fast-lane share, quarantines, swap rules,
//    catalogue gaps) and stores it for /admin/style-brain.
// 2. Runs the brand-affinity weekly job: recompute brand vectors, re-expand
//    from confirmed (learned ≥ 0.8) brands, run health checks.
// 3. Sends the Monday calibration email with both, health failures first.

import { NextRequest, NextResponse } from 'next/server'
import { buildCalibrationReport } from '@/lib/calibration'
import { runBrandAffinityWeekly } from '@/lib/brand-affinity'
import { emailShell, sendStudioEmail, siteUrl } from '@/lib/studio/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

function healthSection(report: Awaited<ReturnType<typeof runBrandAffinityWeekly>>['report']): string {
  const line = (label: string, rows: string[]) =>
    `<tr><td style="padding:6px 12px;font-size:12px;color:${rows.length ? '#B3202A' : '#3D7A50'};white-space:nowrap">${label} · ${rows.length}</td>` +
    `<td style="padding:6px 12px;font-size:12px;color:#4A4E57">${rows.slice(0, 6).join('<br>') || 'clear'}${rows.length > 6 ? `<br>+${rows.length - 6} more` : ''}</td></tr>`
  return `<table style="border-collapse:collapse;width:100%">
    ${line('Code drift (buy vs identity)', (report.code_drift ?? []).map((r) => r.message))}
    ${line('Price extraction failures', (report.price_extraction_failures ?? []).map((r) => `${r.brand}: ${r.reasons}`))}
    ${line('Orphan brands', report.orphan_brands.map((r) => r.name))}
    ${line('Incoherent families', report.incoherent_families.map((r) => `${r.family} (avg ${r.avg_similarity})`))}
    ${line('Tier violations', report.tier_violations.map((r) => `${r.family}: ${r.brands}`))}
    ${line('Stale vectors', report.stale_vectors.map((r) => `${r.name} — ${r.reason}`))}
    ${line('Starved feeds', report.starved_feeds.map((r) => `${r.user_id.slice(0, 8)} (${r.brands} brands)`))}
    ${line('Dead expansions', report.dead_expansions.map((r) => `${r.brand} (${r.impressions} impressions)`))}
    ${line('Runaway learning', report.runaway_learning.map((r) => `${r.brand} moved ${r.moved}`))}
    ${line('Free-text brands', report.free_text_brands.slice(0, 8).map((r) => `${r.raw_name} ×${r.count}`))}
  </table>`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })

  const calibration = await buildCalibrationReport()

  let brand: Awaited<ReturnType<typeof runBrandAffinityWeekly>> | null = null
  let brandError: string | null = null
  try {
    brand = await runBrandAffinityWeekly()
  } catch (e) {
    brandError = e instanceof Error ? e.message : String(e) // 0032 not run yet, most likely
  }

  let emailed = false
  try {
    const mdAsHtml = calibration?.md
      ? `<pre style="font-family:inherit;font-size:12px;color:#4A4E57;white-space:pre-wrap">${calibration.md.replace(/</g, '&lt;')}</pre>`
      : '<p style="font-size:12px;color:#A8A8A4">No calibration report this week.</p>'
    const body = `
      <h3 style="font-size:13px;letter-spacing:2px;color:#4A4E57">BRAND AFFINITY HEALTH</h3>
      ${brand ? healthSection(brand.report) : `<p style="font-size:12px;color:#A8A8A4">${brandError ?? 'not run'}</p>`}
      ${brand ? `<p style="font-size:11px;color:#A8A8A4">${brand.vectors} brand vectors recomputed · ${brand.reExpanded} affinities re-expanded from confirmed brands · full detail in the <a href="${siteUrl('/studio/taste')}">Taste Inspector</a></p>` : ''}
      <h3 style="font-size:13px;letter-spacing:2px;color:#4A4E57;margin-top:24px">CALIBRATION</h3>
      ${mdAsHtml}`
    const res = await sendStudioEmail({
      kind: 'calibration_report',
      subject: `Monday calibration — ${new Date().toISOString().slice(0, 10)}`,
      html: emailShell('MONDAY CALIBRATION', body),
      meta: { brandVectors: brand?.vectors ?? null, reExpanded: brand?.reExpanded ?? null },
    })
    emailed = res.sent
  } catch { /* email is best-effort; the cron result reports it */ }

  return NextResponse.json({
    calibration: calibration ? 'built' : 'skipped',
    brandAffinity: brand ? { vectors: brand.vectors, reExpanded: brand.reExpanded } : brandError,
    emailed,
  })
}
