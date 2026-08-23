// Second-hand feed pull — every 30 minutes (see vercel.json).
//
// FEED FIRST: a feed row is a statement about availability, a scrape is a
// guess. For one-of-one stock that difference decides whether a look nobody can
// buy stays live for another twelve hours. Every merchant with a feed_url
// configured is pulled here; the risk-tiered sentinel only covers the rest.
//
// Also callable by hand:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/second-hand-feed

import { NextRequest, NextResponse } from 'next/server'
import { runAllFeeds } from '@/lib/studio/second-hand-feed'
import { processRenderQueue } from '@/lib/studio/render-queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })

  const reports = await runAllFeeds()
  // Drain whatever rescue renders the feed just queued, where a renderer exists.
  const renders = await processRenderQueue(60_000)

  return NextResponse.json({
    merchants: reports.length,
    sold: reports.reduce((n, r) => n + r.sold, 0),
    sizeAlerts: reports.reduce((n, r) => n + r.sizeChanges, 0),
    reports,
    renders,
  })
}
