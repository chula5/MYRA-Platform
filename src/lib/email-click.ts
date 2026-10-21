// EMAIL CLICK-THROUGHS — which of MYRA's emails actually brought her back.
//
// Every link in a member email is rewritten, at send time, to pass through
// /e: the click is written to email_click (0105) against her and the kind of
// email, and she is redirected to where the link always went. Done once in
// sendStudioEmail, so no email builder has to remember to do it — a new member
// email is tracked the day it is written.
//
// The target is signed together with her member id and the email kind. That
// keeps /e from being an open redirect (an unsigned `to` could send anyone
// anywhere under our domain) and keeps a forged link from inflating her count.

import 'server-only'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase-server'
import { isMissingTable } from '@/lib/metrics-core'

const secret = () => process.env.MEMBER_INVITE_SECRET || process.env.EMAIL_SECRET_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export function signEmailClick(memberId: string, kind: string, to: string): string {
  return crypto.createHmac('sha256', secret()).update(`e1~${memberId}~${kind}~${to}`).digest('hex').slice(0, 20)
}

export function verifyEmailClick(memberId: string, kind: string, to: string, sig: string): boolean {
  try {
    const want = signEmailClick(memberId, kind, to)
    return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))
  } catch {
    return false
  }
}

/**
 * Rewrite every followable link in an email's HTML to go through /e.
 * Only `href`s are touched, so pictures (`src`) still load directly; mailto:
 * and tel: are left alone, as is anything already going through /e.
 */
export function trackEmailLinks(
  html: string,
  opts: { memberId: string; kind: string; site: string },
): string {
  const site = opts.site.replace(/\/$/, '')
  return html.replace(/href="([^"]+)"/g, (whole, raw: string) => {
    const href = raw.replace(/&amp;/g, '&')
    if (!/^https?:\/\//i.test(href)) return whole
    if (href.startsWith(`${site}/e?`)) return whole
    // Our own pages travel as a path, so a link survives a change of host.
    const to = href.startsWith(`${site}/`) ? href.slice(site.length) : href
    const q = new URLSearchParams({ m: opts.memberId, k: opts.kind, to, s: signEmailClick(opts.memberId, opts.kind, to) })
    return `href="${site}/e?${q.toString().replace(/&/g, '&amp;')}"`
  })
}

/** Her member id from what an email's meta carries: a member id, a login, or an address. */
export async function memberForEmail(meta: Record<string, unknown> | undefined): Promise<string | null> {
  if (!meta) return null
  if (typeof meta.memberId === 'string' && meta.memberId) return meta.memberId
  try {
    const admin = createAdminClient() as any
    if (typeof meta.userId === 'string' && meta.userId) {
      const { data } = await admin.from('pilot_member').select('member_id').eq('auth_user_id', meta.userId).maybeSingle()
      if (data?.member_id) return data.member_id
    }
    const email = typeof meta.to === 'string' ? meta.to.trim().toLowerCase() : ''
    if (email) {
      for (const column of ['email', 'invite_email']) {
        const { data } = await admin.from('pilot_member').select('member_id').eq(column, email).limit(1)
        if (data?.[0]?.member_id) return data[0].member_id
      }
    }
  } catch { /* untracked links are still working links */ }
  return null
}

export async function recordEmailClick(row: {
  memberId: string
  kind: string
  target: string
  device: string | null
  userAgent: string | null
  isBot: boolean
}): Promise<void> {
  try {
    const admin = createAdminClient() as any
    const { error } = await admin.from('email_click').insert({
      member_id: row.memberId,
      kind: row.kind.slice(0, 60),
      target: row.target.slice(0, 500),
      device: row.device,
      user_agent: row.userAgent?.slice(0, 400) ?? null,
      is_bot: row.isBot,
    })
    if (error && !isMissingTable(error)) console.error('[email-click]', error.message)
  } catch (err) {
    console.error('[email-click]', err)
  }
}
