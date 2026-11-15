// YOUR MONDAY EDIT — the weekly email (Vercel cron, Monday 08:00 UTC; see vercel.json).
//
// For every real member: the looks styled for her this week, the new pieces
// at her brands in her size, and what is marked down at her brands with the
// original and the sale price (lib/studio/monday-edit). One email, Monday
// morning, before the new-in push at 09:00 and the event options at 10:00.
// Nothing to show → nothing sent.
//
// HELD until Chloe approves the drafts (2026-11-15): a real send needs
// MONDAY_EDIT_SEND=on in the environment. Previews, dry runs and trial sends
// to her own address work without it.
//
//     curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/monday-edit?dry=1"
//
//   ?dry=1          gather everything, send nothing, report what would go
//   ?member=<id>    one member only
//   ?preview=1      return that member's email as HTML to look at, send nothing
//   ?to=a@b.c       a TRIAL: send the member's email to this address instead of hers
//   ?force=1        send even if she had a Monday edit in the last six days
//   ?site=http://localhost:3000   preview/trial only: links open here instead of the live site

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendStudioEmail } from '@/lib/studio/email'
import { gatherMondayEdit, mondayEditHtml, mondaySubject, isEmpty, type MondayMember } from '@/lib/studio/monday-edit'

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
  const preview = q.get('preview') === '1'
  const force = q.get('force') === '1'
  const toOverride = q.get('to')
  const site = (preview || toOverride) && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(q.get('site') ?? '') ? q.get('site')! : undefined
  const held = !dry && !preview && !toOverride && process.env.MONDAY_EDIT_SEND !== 'on'
  if (held) return NextResponse.json({ skipped: 'held until MONDAY_EDIT_SEND=on' })
  const admin = createAdminClient() as any

  let members = admin.from('pilot_member')
    .select('member_id, name, auth_user_id, brands, brands_input_only, brands_never')
    .eq('is_synthetic', false).not('auth_user_id', 'is', null).order('name')
  if (q.get('member')) members = members.eq('member_id', q.get('member'))
  const { data: rows, error } = await members
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 3600_000).toISOString()
  const report: Record<string, unknown>[] = []
  let sent = 0
  for (const m of (rows ?? []) as MondayMember[]) {
    const entry: Record<string, unknown> = { member: m.name ?? m.member_id }
    report.push(entry)
    try {
      const edit = await gatherMondayEdit(admin, m)
      entry.looks = edit.looks.length
      entry.newIn = `${edit.newIn.pieces.length} shown of ${edit.newIn.total}`
      entry.sale = `${edit.sale.pieces.length} shown of ${edit.sale.total} at ${edit.sale.brands.length} brands`
      if (isEmpty(edit)) { entry.sent = false; entry.skipped = 'nothing to show'; continue }
      entry.subject = mondaySubject(edit)
      if (preview) return new NextResponse(mondayEditHtml(m, edit, site), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      if (dry) { entry.sent = false; continue }

      let email: string | null = toOverride
      if (!email) { try { email = (await admin.auth.admin.getUserById(m.auth_user_id!)).data?.user?.email ?? null } catch { /* no address, no note */ } }
      if (!email) { entry.sent = false; entry.skipped = 'no email address'; continue }
      if (!toOverride && !force) {
        const { data: recent } = await admin.from('email_log').select('id').eq('kind', 'shopper_monday_edit')
          .gte('sent_at', sixDaysAgo).contains('meta', { memberId: m.member_id }).limit(1)
        if (recent?.length) { entry.sent = false; entry.skipped = 'sent this week'; continue }
      }
      const res = await sendStudioEmail({
        kind: 'shopper_monday_edit', subject: mondaySubject(edit), html: mondayEditHtml(m, edit, site), to: email,
        meta: { memberId: m.member_id, looks: edit.looks.length, newIn: edit.newIn.pieces.length, sale: edit.sale.pieces.length, trial: !!toOverride, site: site ?? null },
      })
      entry.sent = res.sent
      if (res.error) entry.error = res.error
      if (res.sent) sent++
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err)
    }
  }
  if (preview) return new NextResponse('<p style="font-family:Helvetica,Arial,sans-serif">Nothing to show this member this week — no email would go.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  return NextResponse.json({ members: (rows ?? []).length, dry, sent, report })
}
