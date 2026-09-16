// Google returns here after "Connect Gmail". Trusted only when the signed state
// verifies, its nonce matches this browser's cookie, and whoever is signed in
// may act for that member. Then the refresh token is stored encrypted and the
// first scan (the past 12 months) is queued.

import { NextResponse, type NextRequest } from 'next/server'
import { resolveClientMember } from '@/lib/client-member'
import { exchangeGoogleCode } from '@/lib/email/gmail'
import { readState, safeReturnPath } from '@/lib/email/secrets'
import { saveConnection } from '@/lib/email/connections'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const state = readState(req.nextUrl.searchParams.get('state'))
  const returnTo = safeReturnPath(state?.returnTo)
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`${returnTo}?${q}`, req.url))
    res.cookies.delete('myra_email_nonce')
    return res
  }

  const googleError = req.nextUrl.searchParams.get('error')
  if (googleError) return back(`email_error=${encodeURIComponent(googleError === 'access_denied' ? 'Gmail was not connected' : googleError)}`)
  const code = req.nextUrl.searchParams.get('code')
  const nonce = req.cookies.get('myra_email_nonce')?.value
  if (!state || !code || !nonce || nonce !== state.nonce) return back('email_error=That+sign-in+link+expired+%E2%80%94+try+again')

  // Her own session, or the admin acting for this member.
  const self = await resolveClientMember()
  const allowed = self?.memberId === state.memberId || !!(await resolveClientMember(state.memberId))
  if (!allowed) return back('email_error=Not+allowed')

  try {
    const { refreshToken, email } = await exchangeGoogleCode(code)
    const r = await saveConnection(state.memberId, 'gmail', email, refreshToken)
    if (r.error) return back(`email_error=${encodeURIComponent(r.error)}`)
    return back('email_connected=1')
  } catch (err) {
    return back(`email_error=${encodeURIComponent(err instanceof Error ? err.message : 'Could not connect Gmail')}`)
  }
}
