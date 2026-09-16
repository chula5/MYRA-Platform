// Email-scan drainer — works through queued inbox scans in chunks and resumes
// where the last run stopped. Safe from Vercel cron or by hand:
//
//     open http://localhost:3000/api/cron/email-scan

import { NextRequest, NextResponse } from 'next/server'
import { processEmailScans } from '@/lib/email/connections'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  return NextResponse.json(await processEmailScans(240_000))
}
