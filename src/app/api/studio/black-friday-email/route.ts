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
import { sendBlackFridayEmail, sendBlackFridayToEveryone } from '@/lib/studio/black-friday-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })


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

  const send = q.get('confirm') === 'send'
  const result = await sendBlackFridayToEveryone(createAdminClient() as any, send)
  return json({ mode: send ? 'SENT' : 'DRY RUN — nothing sent. Add &confirm=send to send.', ...result })
}
