// NEW IN — the Monday push (Vercel cron; see vercel.json).
//
// Chloe asked (2026-10-24): when the brands a member loves upload new pieces,
// tell her on her phone, on a Monday. For every real member: the week's new
// pieces from her named brands, in her size (lib/new-in.ts), as a note in the
// app and — where she said yes in the app — a push. Tapping it opens Browse
// on exactly those pieces. Nothing new, nothing sent.
//
//   Monday 09:00 UTC, before the event options at 10:00.
//
//     curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/new-in?dry=1"
//
//   ?member=<id>   one member only
//   ?dry=1         count and word it, send nothing
//   ?force=1       send even if she had a new-in note in the last six days

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { newInForMember, newInMessage, newInPath } from '@/lib/new-in'
import { notifyMember } from '@/lib/push/notify'

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
  const force = q.get('force') === '1'
  const admin = createAdminClient() as any

  let members = admin.from('pilot_member')
    .select('member_id, name, brands, brands_input_only, brands_never')
    .eq('is_synthetic', false).not('auth_user_id', 'is', null)
  if (q.get('member')) members = members.eq('member_id', q.get('member'))
  const { data: rows, error } = await members
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const weekAgo = new Date(Date.now() - 6 * 24 * 3600_000).toISOString()
  const report: Record<string, unknown>[] = []
  let told = 0
  let pushed = 0
  for (const m of (rows ?? []) as any[]) {
    const entry: Record<string, unknown> = { member: m.name ?? m.member_id }
    report.push(entry)
    try {
      const found = await newInForMember(admin, m)
      entry.brands = found.brands.map((b) => `${b.name} ${b.count}`)
      const msg = newInMessage(found.brands)
      if (!msg) { entry.sent = false; continue }
      entry.title = msg.title
      entry.body = msg.body
      if (dry) { entry.sent = false; continue }
      if (!force) {
        const { count } = await admin.from('pilot_notification').select('notification_id', { count: 'exact', head: true })
          .eq('member_id', m.member_id).eq('kind', 'new_in').gte('created_at', weekAgo)
        if (count) { entry.sent = false; entry.skipped = 'told this week'; continue }
      }
      const res = await notifyMember(admin,
        { memberId: m.member_id, kind: 'new_in', body: msg.body },
        { title: msg.title, url: newInPath(found.since), collapseId: 'new-in' })
      entry.sent = res.noted
      entry.push = res.push
      if (res.noted) told++
      if (res.push?.sent) pushed++
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err)
    }
  }
  return NextResponse.json({ members: (rows ?? []).length, dry, told, pushed, report })
}
