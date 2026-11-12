// ONE-OFF: sends the Black Friday announcement to every member through
// Resend on Vercel, then emails Chloe the list of who it went to.
// Scheduled once in vercel.json (09:30 UTC, 12 Nov 2026), at Chloe's ask:
// "just send it how you normally send with resend … go through vercel".
// Safe to run again: anyone already sent it is skipped. Does nothing after
// 14 Nov 2026, so the yearly cron line cannot fire again next year.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendBlackFridayToEveryone, sendReportHtml } from '@/lib/studio/black-friday-email'
import { sendStudioEmail } from '@/lib/studio/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const LAST_DAY = Date.parse('2026-11-14T23:59:59Z')

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) return new NextResponse('Unauthorized', { status: 401 })
  if (Date.now() > LAST_DAY) return NextResponse.json({ skipped: 'past its one-off date' })

  const send = req.nextUrl.searchParams.get('dry') !== '1'
  const result = await sendBlackFridayToEveryone(createAdminClient() as any, send)
  const mode = send ? 'SENT' : 'DRY RUN'
  await sendStudioEmail({
    kind: 'black_friday_report',
    subject: `MYRA — Black Friday email: ${'sent' in result ? result.sent : 0} sent`,
    html: sendReportHtml(result as any, mode),
  })
  return NextResponse.json({ mode, ...result })
}
