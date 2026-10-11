// WAYS TO WEAR IT — the overnight sweep (Vercel cron, 02:00 UTC every third day;
// see vercel.json — Chloe chose every 3 days over nightly, 2026-10-11, while
// members are few and the judge spend is not yet earning its keep).
//
// For every real member, the pieces she is most likely to tap next are
// styled overnight: what she saved, what she looked at through the Mirror, the
// retail pieces in her newest looks, and the Browse pieces she lingered on
// or picked that have no ways yet. Each is queued under the nightly cap
// (STYLED_WAYS_NIGHTLY_CAP, counted apart from the daytime cap) and skipped
// when it already has its three ways, so night two costs only what is new.
// The first jobs run here; /api/cron/styled-ways finishes the rest.
//
//     curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/styled-ways-nightly
//
//   ?dry=1   list what would be queued without queueing it

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { enqueueWarmups, drainStyledWaysQueue, nightlyCap } from '@/lib/styled-ways-queue'
import { uncoveredDemand } from '@/lib/styled-ways-demand'
import type { WayMode } from '@/lib/styled-ways-core'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SAVED = 12
const VIEWED = 12
const VIEWED_DAYS = 21
const LOOKS = 12
const BROWSE = 12
const BROWSE_DAYS = 7
const DRAIN_MS = 200_000

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

interface Wanted { mode: WayMode; ids: string[] }

/** The pieces one member is most likely to tap, in the order they should be styled. */
async function wantedFor(admin: any, memberId: string): Promise<Record<'saved' | 'viewed' | 'looks' | 'browse', Wanted>> {
  const since = new Date(Date.now() - VIEWED_DAYS * 86_400_000).toISOString()
  const [{ data: saved }, { data: viewed }, { data: dels }] = await Promise.all([
    admin.from('member_saved_item').select('item_id').eq('member_id', memberId).order('saved_at', { ascending: false }).limit(SAVED),
    admin.from('recently_viewed').select('item_id').eq('member_id', memberId).gte('viewed_at', since).order('viewed_at', { ascending: false }).limit(VIEWED),
    admin.from('pilot_delivery').select('delivery_id').eq('member_id', memberId),
  ])
  const deliveryIds = ((dels ?? []) as any[]).map((d) => d.delivery_id)
  const { data: looks } = deliveryIds.length
    ? await admin.from('pilot_look').select('items').in('delivery_id', deliveryIds).eq('visible_to_client', true)
      .order('published_at', { ascending: false }).limit(LOOKS)
    : { data: [] }
  const lookIds = Array.from(new Set(((looks ?? []) as any[])
    .flatMap((l) => ((l.items ?? []) as any[]).filter((i) => i.item_id && !i.owned).map((i) => i.item_id as string))))
  const browse = await uncoveredDemand(admin, memberId, 'inspiration', { sinceDays: BROWSE_DAYS, limit: BROWSE })
  return {
    saved: { mode: 'blend', ids: ((saved ?? []) as any[]).map((r) => r.item_id).filter(Boolean) },
    viewed: { mode: 'blend', ids: ((viewed ?? []) as any[]).map((r) => r.item_id).filter(Boolean) },
    looks: { mode: 'blend', ids: lookIds },
    browse: { mode: 'inspiration', ids: browse },
  }
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  const dry = req.nextUrl.searchParams.get('dry') === '1'
  const admin = createAdminClient() as any
  const cap = nightlyCap()

  // Real people who can sign in: never the dry-run personas.
  const { data: rows, error } = await admin.from('pilot_member')
    .select('member_id, name, is_synthetic, auth_user_id').eq('is_synthetic', false).not('auth_user_id', 'is', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const members = (rows ?? []) as { member_id: string; name: string | null }[]

  const report: Record<string, unknown>[] = []
  let queuedAll = 0
  for (const m of members) {
    const wanted = await wantedFor(admin, m.member_id)
    const seen = new Set<string>()
    const out: Record<string, { wanted: number; queued: number; ready: number }> = {}
    let capped = false
    for (const [group, w] of Object.entries(wanted) as [string, Wanted][]) {
      // A piece saved and also in a look is styled once, in blend.
      const ids = w.ids.filter((id) => { const k = `${id}|${w.mode}`; if (seen.has(k) || (w.mode === 'blend' && seen.has(`${id}|blend`))) return false; seen.add(k); return true })
      if (!ids.length) { out[group] = { wanted: 0, queued: 0, ready: 0 }; continue }
      if (dry || capped) { out[group] = { wanted: ids.length, queued: 0, ready: 0 }; continue }
      try {
        const r = await enqueueWarmups(admin, m.member_id, ids, 'nightly', { mode: w.mode, cap })
        out[group] = { wanted: ids.length, queued: r.queued.length, ready: r.ready.length }
        queuedAll += r.queued.length
        if (r.capped) capped = true
      } catch (err) {
        out[group] = { wanted: ids.length, queued: 0, ready: 0 }
        console.error('[styled-ways-nightly]', m.member_id, group, err)
      }
    }
    report.push({ member: m.name ?? m.member_id, capped, ...out })
  }

  const drained = dry || !queuedAll ? null : await drainStyledWaysQueue(DRAIN_MS)
  return NextResponse.json({ members: members.length, cap, queued: queuedAll, dry, report, drained })
}
