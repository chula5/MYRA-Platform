// Start "Connect calendar" for a member: her own session, or the member Chloe
// names from HER VIEW (admin only). Same signed-state + cookie-nonce round trip
// as Connect Gmail, and it comes back through the same Google callback.

import { NextResponse, type NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { resolveClientMember } from '@/lib/client-member'
import { calendarAuthUrl, calendarConfigured } from '@/lib/calendar/google'
import { emailSecretsConfigured, safeReturnPath, signState } from '@/lib/email/secrets'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const returnTo = safeReturnPath(req.nextUrl.searchParams.get('return'))
  const back = (msg: string) => NextResponse.redirect(new URL(`${returnTo}?calendar_error=${encodeURIComponent(msg)}`, req.url))
  if (!calendarConfigured() || !emailSecretsConfigured()) return back('Calendar connect is not set up yet')

  const me = await resolveClientMember(req.nextUrl.searchParams.get('member') || undefined)
  if (!me) return back('Sign in first')

  const nonce = crypto.randomBytes(16).toString('hex')
  const res = NextResponse.redirect(calendarAuthUrl(signState({ memberId: me.memberId, returnTo, nonce, kind: 'calendar' })))
  res.cookies.set('myra_email_nonce', nonce, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 600, path: '/' })
  return res
}
