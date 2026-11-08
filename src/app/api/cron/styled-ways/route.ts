// Styled-ways drainer — keeps WAYS TO WEAR IT warm-ups moving (migration 0094)
// and recovers after a crashed invocation. Taps are drained the moment they
// are made (waitUntil); this is the safety net and the warm-up engine.
//
//     open http://localhost:3000/api/cron/styled-ways
//
//   ?retryFailed=1   first re-queue jobs that previously failed (attempts reset)
//
// The cron tick (not a kick) also keeps the library snapshot young
// (lib/library-snapshot): inside ten minutes while anyone has styled in the
// last three hours, inside an hour always — so a tap reads the shop in a
// couple of seconds instead of the half-minute the database takes.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { drainStyledWaysQueue } from '@/lib/styled-ways-queue'
import { refreshLibrarySnapshotIfDue } from '@/lib/library-snapshot'

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
  // ?kick=1 is a tap (kickStyledWaysDrain) borrowing this function's 300s;
  // ?budget= caps the run. The cron itself takes the full four minutes.
  const kicked = req.nextUrl.searchParams.get('kick') === '1'
  const budget = Math.min(240_000, Math.max(10_000, Number(req.nextUrl.searchParams.get('budget')) || 240_000))
  const result = await drainStyledWaysQueue(budget)
  if (kicked) console.log('[styled-ways] kicked drain', JSON.stringify(result))
  let snapshot: { refreshed: boolean; ageMs: number | null } | undefined
  if (!kicked) {
    try {
      const admin = createAdminClient() as any
      const { count } = await admin.from('styled_way_job').select('job_id', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 3 * 3_600_000).toISOString())
      snapshot = await refreshLibrarySnapshotIfDue({ demand: (count ?? 0) > 0, admin })
      if (snapshot.refreshed) console.log('[styled-ways] library snapshot refreshed', JSON.stringify(snapshot))
    } catch (err) {
      console.error('[styled-ways] snapshot', err)
    }
  }
  return NextResponse.json({ ...(requeued != null ? { requeued } : {}), kicked, ...result, ...(snapshot ? { snapshot } : {}) })
}
