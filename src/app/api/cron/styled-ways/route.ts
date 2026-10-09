// Styled-ways drainer — keeps WAYS TO WEAR IT warm-ups moving (migration 0094)
// and recovers after a crashed invocation. Taps are drained the moment they
// are made (waitUntil); this is the safety net and the warm-up engine.
//
//     open http://localhost:3000/api/cron/styled-ways
//
//   ?retryFailed=1   first re-queue jobs that previously failed (attempts reset)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { drainStyledWaysQueue } from '@/lib/styled-ways-queue'

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
    const { data } = await (createAdminClient() as any)
      .from('styled_way_job')
      .update({ status: 'queued', attempts: 0, error: null, started_at: null, finished_at: null })
      .eq('status', 'failed')
      .select('job_id')
    requeued = (data ?? []).length
  }
  const result = await drainStyledWaysQueue(240_000)
  return NextResponse.json({ ...(requeued != null ? { requeued } : {}), ...result })
}
