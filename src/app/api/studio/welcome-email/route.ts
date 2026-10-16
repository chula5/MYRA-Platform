// Send her welcome, as MYRA, through Resend. Admin-gated.
//
//   /api/studio/welcome-email?to=her@example.com&name=Alison
//
// A one-off send from the browser while signed in as admin: the same email the
// member flow will send when she is let in, so it can be read in a real inbox
// first. Returns Resend's own answer, like /api/studio/test-email.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { sendWelcomeEmail } from '@/lib/studio/welcome-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) return new NextResponse('Not found', { status: 404 })

  const to = req.nextUrl.searchParams.get('to')?.trim() ?? ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return NextResponse.json({ error: `Not a valid address: ${to || '(none)'} — add ?to=` }, { status: 400 })
  const name = req.nextUrl.searchParams.get('name')?.trim() || 'there'

  const result = await sendWelcomeEmail(to, name)
  return NextResponse.json(
    { ...result, note: result.sent ? 'Resend accepted it — check the inbox, and Emails in the Resend dashboard for delivery.' : 'Resend rejected it — the error above is its own wording.' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
