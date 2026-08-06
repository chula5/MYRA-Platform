// Stock sentinel cron — every 12 hours (see vercel.json). Runs the
// availability sweep, sends the stock email if anything changed, then drains
// the render queue so auto-swapped outfits republish as their renders land.
//
// Also callable manually:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/stock-sentinel

import { NextRequest, NextResponse } from 'next/server'
import { runStockSentinel } from '@/lib/studio/stock-sentinel'
import { sendStockEmail, stockEmailNeeded } from '@/lib/studio/stock-email'
import { processRenderQueue } from '@/lib/studio/render-queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // no secret configured — allow (matches Vercel default)
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })

  const report = await runStockSentinel({ maxItems: 80, budgetMs: 200_000 })
  if (stockEmailNeeded(report)) await sendStockEmail(report)
  const renders = await processRenderQueue(60_000)

  return NextResponse.json({
    checked: report.itemsChecked,
    down: report.itemsDown.length,
    paused: report.outfitsPaused,
    autoSwapped: report.autoSwapped.length,
    needsPick: report.needsPick.length,
    backInStock: report.backInStock.length,
    archived: report.archived,
    renders,
  })
}
