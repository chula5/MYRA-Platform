// Daily commission maintenance:
//   1. Journey pass — unattributed pending orders get another look via
//      Shopify's 30-day customer journey (attribution computes asynchronously,
//      so day-of misses become matches here).
//   2. Approval pass — pending rows whose return window has closed become
//      approved (MYRA-attributed) or void (never ours).
//
// Also callable manually:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/commissions

import { NextRequest, NextResponse } from 'next/server'
import { resolveJourneyAttribution, approveMaturedCommissions } from '@/lib/ledger/store'
import { sweepApprovedCommissions } from '@/lib/billing/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // no secret configured — allow (matches Vercel default)
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })

  const journey = await resolveJourneyAttribution(50)
  const approval = await approveMaturedCommissions()
  // 3. Sweep — prefunded merchants' approved commission settles against balance.
  const sweep = await sweepApprovedCommissions()

  return NextResponse.json({ ok: true, journey, approval, sweep })
}
