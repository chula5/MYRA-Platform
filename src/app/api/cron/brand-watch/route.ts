// Brand Watch cron — hourly (see vercel.json). Each run scans the active
// watched brands not read in the last ~6.5 days, stalest first, until its time
// budget is spent; so every brand is still scanned about weekly, without one
// 300s run having to reach all ~180. Diffs against what has already been seen
// and queues new on-taste pieces as draft items for /admin/brand-watch.
//
// Also callable manually:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/brand-watch

import { NextRequest, NextResponse } from 'next/server'
import { runBrandWatch } from '@/lib/brand-watch'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // no secret configured — allow (matches Vercel default)
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })

  const results = await runBrandWatch({ budgetMs: 240_000, dueAfterMs: 6.5 * 24 * 3600_000 })
  return NextResponse.json({
    brands: results.length,
    queued: results.reduce((n, r) => n + r.queued, 0),
    results,
  })
}
