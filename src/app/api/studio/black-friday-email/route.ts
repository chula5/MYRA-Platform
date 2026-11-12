// The Black Friday announcement, as MYRA, through Resend. Admin-gated.
//
//   /api/studio/black-friday-email?to=you@example.com&name=Chloe
//       one copy to one address (a final look in a real inbox)
//
//   /api/studio/black-friday-email?members=1
//       DRY RUN: lists every real member it would go to, sends nothing
//
//   /api/studio/black-friday-email?members=1&confirm=send
//       sends to every real member, "Hello <first name>," in each
//
// Safe to press twice: a member already sent it (per email_log) is skipped.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { sendBlackFridayEmail } from '@/lib/studio/black-friday-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

// Resend's default limit is 2 requests a second; stay under it.
const pause = () => new Promise((r) => setTimeout(r, 600))

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) return new NextResponse('Not found', { status: 404 })

  const q = req.nextUrl.searchParams

  if (!q.get('members')) {
    const to = q.get('to')?.trim() ?? ''
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: `Not a valid address: ${to || '(none)'} — add ?to=, or ?members=1 for everyone` }, 400)
    const name = q.get('name')?.trim() || ''
    const result = await sendBlackFridayEmail(to, name, { sample: true })
    return json({ ...result, note: result.sent ? 'Resend accepted it — check the inbox.' : 'Not sent — the error above says why.' })
  }

  const admin = createAdminClient() as any
  const { data: members, error } = await admin.from('pilot_member')
    .select('member_id, name, auth_user_id, email, invite_email')
    .eq('is_synthetic', false)
  if (error) return json({ error: error.message }, 500)

  // Who already has it, so a second press never sends twice.
  const { data: logged } = await admin.from('email_log').select('meta').eq('kind', 'shopper_black_friday')
  const already = new Set(((logged ?? []) as any[]).map((r) => r.meta?.memberId).filter(Boolean))

  const send = q.get('confirm') === 'send'
  const report: Record<string, unknown>[] = []
  let sent = 0
  const seen = new Set<string>()
  for (const m of (members ?? []) as any[]) {
    const first = (m.name ?? '').trim().split(/\s+/)[0] ?? ''
    const entry: Record<string, unknown> = { member: m.name ?? m.member_id, greeting: first ? `Hello ${first},` : 'Hello,' }
    report.push(entry)
    if (already.has(m.member_id)) { entry.skipped = 'already sent'; continue }
    // Every real member, signed up or not: her login's address first, else the
    // one Chloe wrote down for her (Chloe, 2026-11-12: "I want them all to receive it").
    let email: string | null = null
    if (m.auth_user_id) {
      try { email = (await admin.auth.admin.getUserById(m.auth_user_id)).data?.user?.email ?? null } catch { /* no address */ }
    }
    email = email || m.email || m.invite_email || null
    entry.status = m.auth_user_id ? 'signed up' : 'added, not signed in yet'
    if (!email) { entry.skipped = 'no email address on file'; continue }
    entry.to = email
    if (seen.has(email.toLowerCase())) { entry.skipped = 'same address as another member'; continue }
    seen.add(email.toLowerCase())
    if (!send) continue
    const res = await sendBlackFridayEmail(email, m.name ?? '', { memberId: m.member_id })
    entry.sent = res.sent
    if (res.error) entry.error = res.error
    if (res.sent) sent++
    await pause()
  }

  return json({
    mode: send ? 'SENT' : 'DRY RUN — nothing sent. Add &confirm=send to send.',
    members: (members ?? []).length,
    willReceive: report.filter((r) => r.to && !r.skipped).length,
    sent,
    report,
  })
}
