// /e — a link from one of MYRA's emails, on its way to where it always went.
//
// Logs the click against her and the email it came from (lib/email-click),
// then redirects. A link whose signature does not match is still followed if
// it points at one of our own pages — a broken signature must never strand
// her on an error — but it is not counted, and it never leaves the site.

import { NextResponse } from 'next/server'
import { deviceFromUa, isBotRequest } from '@/lib/outbound'
import { recordEmailClick, verifyEmailClick } from '@/lib/email-click'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const isOwnPath = (to: string) => to.startsWith('/') && !to.startsWith('//') && !to.includes('\\')

export async function GET(request: Request) {
  const url = new URL(request.url)
  const memberId = url.searchParams.get('m') ?? ''
  const kind = url.searchParams.get('k') ?? ''
  const to = url.searchParams.get('to') ?? ''
  const sig = url.searchParams.get('s') ?? ''

  const genuine = Boolean(memberId && kind && to && sig) && verifyEmailClick(memberId, kind, to, sig)
  const ownPath = isOwnPath(to)
  const external = /^https?:\/\//i.test(to)

  if (genuine) {
    const ua = request.headers.get('user-agent')
    await recordEmailClick({
      memberId,
      kind,
      target: to,
      device: deviceFromUa(ua),
      userAgent: ua,
      isBot: isBotRequest(ua, request.headers),
    })
  }

  const dest = ownPath ? new URL(to, url.origin) : genuine && external ? new URL(to) : new URL('/me', url.origin)
  return NextResponse.redirect(dest, 302)
}
