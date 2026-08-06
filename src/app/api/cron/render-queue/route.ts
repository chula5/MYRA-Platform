// Render-queue drainer — keeps the single sequential Higgsfield queue moving
// between approvals/sentinel runs (retries, recovery after a crashed
// invocation). Approvals always process ahead of stock swaps.

import { NextRequest, NextResponse } from 'next/server'
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
  const result = await processRenderQueue(240_000)
  return NextResponse.json(result)
}
