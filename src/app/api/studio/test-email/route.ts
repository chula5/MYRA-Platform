// Resend delivery test. Admin-gated.
//
//   /api/studio/test-email                      → sends to STUDIO_EMAIL_TO
//   /api/studio/test-email?to=you@gmail.com     → sends anywhere
//
// The ?to= override is the point of this route. A digest reporting
// "sent": true only means Resend's API ACCEPTED the message — it says nothing
// about whether a mailbox existed at the other end. Verifying a domain in
// Resend grants the right to SEND from it; it does not create an inbox to
// RECEIVE at. So if studio@myraassistant.co.uk sends fine but nothing arrives
// at chloe@myraassistant.co.uk, the usual cause is that no mail provider is
// hosting that address (no MX on the root domain). Sending the same message
// to a known-good inbox separates "Resend is broken" from "that address
// doesn't receive mail".
//
// Returns Resend's message id so the send can be looked up under Emails in the
// Resend dashboard, where the real delivery outcome (delivered / bounced /
// complained) is recorded.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { sendStudioEmail, emailShell, siteUrl } from '@/lib/studio/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) {
    return new NextResponse('Not found', { status: 404 })
  }

  const to = req.nextUrl.searchParams.get('to')?.trim() || undefined
  if (to && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ error: `Not a valid address: ${to}` }, { status: 400 })
  }

  const stamp = new Date().toISOString()
  const result = await sendStudioEmail({
    kind: 'review_digest',
    to,
    subject: 'MYRA review — test send',
    html: emailShell(
      'TEST SEND',
      `<p style="margin:0 0 10px 0;">If you're reading this, Resend is delivering to this address.</p>
       <p style="margin:0;font-size:11px;color:#a8a8a4;">Sent ${stamp} · <a href="${siteUrl('/studio/review')}" style="color:#4a4e57;">review queue</a></p>`,
    ),
    meta: { test: true, sentAt: stamp },
  })

  return NextResponse.json(
    {
      ...result,
      note: result.sent
        ? 'Resend ACCEPTED the message. If it never arrives, the address has no mailbox or it was filtered — check Emails in the Resend dashboard for the delivery outcome.'
        : 'Resend rejected the message — the error above is its own wording.',
      resendDashboard: 'https://resend.com/emails',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
