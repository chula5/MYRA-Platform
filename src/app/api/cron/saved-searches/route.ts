// SAVED SEARCHES — MYRA keeps looking (Vercel cron; see vercel.json).
//
// Every hour, after Brand Watch (:20) has brought in that hour's pieces: each
// saved search is re-run for what came into MYRA since it last ran
// (lib/saved-search), and every new answer is kept for her chip's N NEW.
//
// Quiet by design: from 17:00 UK, a member with anything unseen gets ONE note
// for the day — all her searches together — and a push where she said yes.
//
//     curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/saved-searches?dry=1"
//
//   ?member=<id>   one member only
//   ?dry=1         run the searches, keep nothing, send nothing
//   ?notify=1      send the note now, whatever the hour (still once a day)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { searchForMember } from '@/lib/member-search'
import { notifyMember } from '@/lib/push/notify'
import {
  runSavedSearch, savedSearchesFor, savedSearchMessage, savedSearchPath, ukDay, ukHour, NOTE_HOUR_UK,
  type SavedSearchRow,
} from '@/lib/saved-search'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  const q = req.nextUrl.searchParams
  const dry = q.get('dry') === '1'
  const admin = createAdminClient() as any
  const started = Date.now()

  let sel = admin.from('saved_search')
    .select('saved_search_id, member_id, query, filters, label, last_run_at, last_seen_at, last_pushed_at, created_at')
    .eq('active', true).order('last_run_at', { ascending: true }).limit(400)
  if (q.get('member')) sel = sel.eq('member_id', q.get('member'))
  const { data, error } = await sel
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data ?? []) as SavedSearchRow[]

  const report: Record<string, unknown>[] = []
  const members = new Set<string>()
  for (const row of rows) {
    // Stalest first; whatever does not fit this run is first next hour.
    if (Date.now() - started > 240_000) break
    members.add(row.member_id)
    const entry: Record<string, unknown> = { query: row.query, member: row.member_id }
    report.push(entry)
    try {
      if (dry) {
        const view = await searchForMember(admin, row.member_id, row.query, row.filters ?? {}, { since: row.last_run_at })
        entry.wouldAdd = view.pieces.length
      } else {
        entry.added = await runSavedSearch(admin, row)
      }
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err)
    }
  }

  // The evening note: once a day, everything unseen across her searches.
  const notes: Record<string, unknown>[] = []
  const now = new Date()
  if (!dry && (q.get('notify') === '1' || ukHour(now) >= NOTE_HOUR_UK)) {
    const today = ukDay(now)
    for (const memberId of Array.from(members)) {
      const mine = rows.filter((r) => r.member_id === memberId)
      if (mine.some((r) => r.last_pushed_at && ukDay(r.last_pushed_at) === today)) continue
      const views = await savedSearchesFor(admin, memberId, 0)
      const msg = savedSearchMessage(views)
      if (!msg) continue
      const only = views.filter((v) => v.fresh > 0)
      const res = await notifyMember(admin,
        { memberId, kind: 'saved_search', body: msg.body },
        { title: msg.title, url: savedSearchPath(only.length === 1 ? only[0].id : undefined), collapseId: 'saved-search' })
      await admin.from('saved_search').update({ last_pushed_at: now.toISOString() }).eq('member_id', memberId)
      notes.push({ member: memberId, body: msg.body, noted: res.noted, pushed: res.push?.sent ?? 0 })
    }
  }

  return NextResponse.json({ searches: rows.length, ran: report.length, dry, notes, report })
}
