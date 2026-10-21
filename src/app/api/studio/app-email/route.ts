// Send "your account is ready, here is the app", as MYRA, through Resend. Admin-gated.
//
//   /api/studio/app-email?to=her@example.com&name=Alison
//
// Same shape as /api/studio/welcome-email: a one-off send from the browser
// while signed in as admin, to preview in a real inbox before it goes to her.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { sendAppReadyEmail } from '@/lib/studio/app-ready-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) return new NextResponse('Not found', { status: 404 })

  const to = req.nextUrl.searchParams.get('to')?.trim() ?? ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return NextResponse.json({ error: `Not a valid address: ${to || '(none)'} — add ?to=` }, { status: 400 })
  const name = req.nextUrl.searchParams.get('name')?.trim() || 'there'

  const result = await sendAppReadyEmail(to, name)
  return NextResponse.json(
    { ...result, note: result.sent ? 'Resend accepted it — check the inbox, and Emails in the Resend dashboard for delivery.' : 'Not sent — the error above says why.' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
