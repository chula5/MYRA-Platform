// Saved-piece stock alerts — delivery.
//
//   ?mode=urgent  hourly. Only the alerts that can't wait: a one-of-one that
//                 sold, and low stock on a unique or fast-moving piece.
//   ?mode=batch   daily. Everything outstanding, in ONE email per person —
//                 never one email per event.
//
// Private-stylist clients are skipped here; theirs ride inside the existing
// stylist digest rather than arriving as a second email from the same brand.

import { NextRequest, NextResponse } from 'next/server'
import { deliverAlerts } from '@/lib/stock-alerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  const mode = req.nextUrl.searchParams.get('mode') === 'urgent' ? 'urgent' : 'batch'
  const result = await deliverAlerts(mode)
  return NextResponse.json({ mode, ...result })
}
