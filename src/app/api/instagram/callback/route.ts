// Instagram returns here after "Connect Instagram". Trusted only when the
// signed state verifies, its nonce matches this browser's cookie, and whoever
// is signed in may act for that member. The long-lived token is stored
// encrypted; her first photos come in when the Dressing Room next loads.

import { NextResponse, type NextRequest } from 'next/server'
import { resolveClientMember } from '@/lib/client-member'
import { exchangeInstagramCode } from '@/lib/archival/instagram'
import { saveInstagramConnection } from '@/lib/archival/store'
import { readState, safeReturnPath } from '@/lib/email/secrets'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const state = readState(req.nextUrl.searchParams.get('state'))
  const returnTo = safeReturnPath(state?.returnTo)
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`${returnTo}?${q}`, req.url))
    res.cookies.delete('myra_ig_nonce')
    return res
  }

  const igError = req.nextUrl.searchParams.get('error')
  if (igError) return back(`instagram_error=${encodeURIComponent(igError === 'access_denied' ? 'Instagram was not connected' : req.nextUrl.searchParams.get('error_description') ?? igError)}`)
  const code = req.nextUrl.searchParams.get('code')
  const nonce = req.cookies.get('myra_ig_nonce')?.value
  if (!state || !code || !nonce || nonce !== state.nonce) return back('instagram_error=That+sign-in+link+expired+%E2%80%94+try+again')

  const self = await resolveClientMember()
  const allowed = self?.memberId === state.memberId || !!(await resolveClientMember(state.memberId))
  if (!allowed) return back('instagram_error=Not+allowed')

  try {
    const grant = await exchangeInstagramCode(code)
    const r = await saveInstagramConnection(state.memberId, grant)
    if (r.error) return back(`instagram_error=${encodeURIComponent(r.error)}`)
    return back('instagram_connected=1')
  } catch (err) {
    return back(`instagram_error=${encodeURIComponent(err instanceof Error ? err.message : 'Could not connect Instagram')}`)
  }
}
