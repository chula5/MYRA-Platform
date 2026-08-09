// Monday-morning calibration report (Vercel cron — see vercel.json).
// Also callable manually; requires CRON_SECRET when one is configured.
import { NextRequest, NextResponse } from 'next/server'
import { buildCalibrationReport } from '@/lib/calibration'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const res = await buildCalibrationReport()
  if (!res) return NextResponse.json({ error: 'Report failed' }, { status: 500 })
  return NextResponse.json({ ok: true, week_start: res.report.week_start, report: res.report })
}
