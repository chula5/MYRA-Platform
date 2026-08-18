// Brand Watch cron — Mondays 07:00 UTC (see vercel.json). Scans every active
// watched brand's Shopify catalogue, diffs against what has already been seen,
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

  const results = await runBrandWatch()
  return NextResponse.json({
    brands: results.length,
    queued: results.reduce((n, r) => n + r.queued, 0),
    results,
  })
}
