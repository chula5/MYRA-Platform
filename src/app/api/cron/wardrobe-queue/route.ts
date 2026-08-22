// Wardrobe-queue drainer — keeps the sequential extraction queue moving
// (detect → cutout → score), retries, and recovers after a crashed invocation.
// Safe to hit from Vercel cron or by hand:
//
//     open http://localhost:3000/api/cron/wardrobe-queue
//
//   ?retryFailed=1   first re-queue jobs that previously failed (attempts reset)

import { NextRequest, NextResponse } from 'next/server'
import { processWardrobeQueue } from '@/lib/wardrobe/queue'
import { admin } from '@/lib/wardrobe/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  let requeued: number | null = null
  if (req.nextUrl.searchParams.get('retryFailed') === '1') {
    const { data } = await admin()
      .from('wardrobe_job')
      .update({ status: 'queued', attempts: 0, error: null, started_at: null, finished_at: null })
      .eq('status', 'failed')
      .select('job_id')
    requeued = (data ?? []).length
  }
  const result = await processWardrobeQueue(240_000)
  return NextResponse.json({ ...(requeued != null ? { requeued } : {}), ...result })
}
