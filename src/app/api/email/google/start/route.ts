// Start "Connect Gmail" for a member: her own session, or the member Chloe names
// from HER VIEW (admin only). The member and a nonce are signed into the OAuth
// state; the nonce is also held in a cookie, so the callback only trusts a
// round trip that started in this browser.

import { NextResponse, type NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { resolveClientMember } from '@/lib/client-member'
import { googleAuthUrl, gmailConfigured } from '@/lib/email/gmail'
import { emailSecretsConfigured, safeReturnPath, signState } from '@/lib/email/secrets'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const returnTo = safeReturnPath(req.nextUrl.searchParams.get('return'))
  const back = (msg: string) => NextResponse.redirect(new URL(`${returnTo}?email_error=${encodeURIComponent(msg)}`, req.url))
  if (!gmailConfigured() || !emailSecretsConfigured()) return back('Gmail connect is not set up yet')

  const asMemberId = req.nextUrl.searchParams.get('member') || undefined
  const me = await resolveClientMember(asMemberId)
  if (!me) return back('Sign in first')

  const nonce = crypto.randomBytes(16).toString('hex')
  const res = NextResponse.redirect(googleAuthUrl(signState({ memberId: me.memberId, returnTo, nonce })))
  res.cookies.set('myra_email_nonce', nonce, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 600, path: '/' })
  return res
}
