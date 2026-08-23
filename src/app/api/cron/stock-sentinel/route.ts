// Stock sentinel cron — every 30 minutes (see vercel.json).
//
// The cadence is set by the fastest tier the risk model can assign: Tier A
// (saved by someone in her size, or clicked in the last 24h) is checked every
// 30 minutes, so the sweep itself has to run at least that often. Each run only
// picks up items that are actually DUE, so the frequency costs nothing for the
// daily-tier majority.
//
// Also callable manually:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/stock-sentinel

import { NextRequest, NextResponse } from 'next/server'
import { runStockSentinel } from '@/lib/studio/stock-sentinel'
import { sendStockEmail, stockEmailNeeded } from '@/lib/studio/stock-email'
import { countEmailsToday } from '@/lib/studio/email'
import { processRenderQueue } from '@/lib/studio/render-queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Running every 30 minutes must not mean 48 emails a day. Routine housekeeping
// is capped; anything IRREVERSIBLE (a one-of-one sold — looks retired, saved
// looks rescued) always sends, because there is no later run that can undo it.
const MAX_ROUTINE_STOCK_EMAILS_PER_DAY = 3

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // no secret configured — allow (matches Vercel default)
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })

  const report = await runStockSentinel({ maxItems: 80, budgetMs: 200_000 })

  let emailed = false
  if (stockEmailNeeded(report)) {
    const irreversible = report.uniqueSold.length > 0
    const sentToday = await countEmailsToday('stock_report')
    if (irreversible || sentToday < MAX_ROUTINE_STOCK_EMAILS_PER_DAY) {
      await sendStockEmail(report)
      emailed = true
    }
  }

  const renders = await processRenderQueue(60_000)

  return NextResponse.json({
    checked: report.itemsChecked,
    down: report.itemsDown.length,
    paused: report.outfitsPaused,
    autoSwapped: report.autoSwapped.length,
    needsPick: report.needsPick.length,
    backInStock: report.backInStock.length,
    uniqueSold: report.uniqueSold,
    sizeAlerts: report.sizeAlerts,
    archived: report.archived,
    deferred: report.deferred,
    emailed,
    renders,
  })
}
