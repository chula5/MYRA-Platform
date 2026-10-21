// Studio email — one sender, consistent subject prefixes ("MYRA review —",
// "MYRA stock —") so they're filterable. Sent via the Resend HTTP API (no SDK
// dep); silently no-ops with a console error when RESEND_API_KEY is unset so
// nothing else breaks in an environment without email.
//
// Every send is written to email_log — the ledger that also enforces the
// "never more than 2 review digests a day" cap.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { memberForEmail, trackEmailLinks } from '@/lib/email-click'

const TO = process.env.STUDIO_EMAIL_TO ?? 'chloe@myraassistant.co.uk'
const FROM = process.env.STUDIO_EMAIL_FROM ?? 'MYRA Studio <studio@myraassistant.co.uk>'
// What a member sees: MYRA herself, and a reply lands with Chloe (Chloe's ask, 2026-10-11).
const MEMBER_FROM = process.env.MEMBER_EMAIL_FROM ?? 'MYRA <myra@myraassistant.co.uk>'
const MEMBER_REPLY_TO = process.env.MEMBER_EMAIL_REPLY_TO ?? 'chloe@myraassistant.co.uk'
// The bare domain fails the TLS handshake (checked 2026-10-11); www is the one that answers.
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.myraassistant.co.uk'

export function siteUrl(path: string): string {
  return `${SITE.replace(/\/$/, '')}${path}`
}

export type EmailKind =
  | 'review_digest' | 'stock_report' | 'calibration_report'
  // Someone pressed APPLY NOW on the landing page: a note to Chloe with what she wrote.
  | 'application_received'
  // Shopper-facing sends (stock alerts on saved pieces). Same transport, and
  // logged in the same ledger, but never subject to the studio digest caps.
  | 'shopper_stock_digest' | 'shopper_stock_urgent'
  // The morning after the overnight sweep: the pieces MYRA styled for her while she slept.
  | 'shopper_ways_digest'
  // New options for the events she has coming up (weekly, after the Monday upload).
  | 'shopper_event_picks'
  // Her welcome: the three steps, sent as MYRA when she is let in.
  | 'shopper_welcome'
  // Her invitation: ACCEPT on /admin/applications made her a member; this carries her /join link.
  | 'shopper_invitation'

/** Shopper-facing kinds go out as MYRA, with replies to Chloe; the studio kinds stay MYRA Studio. */
const isMemberKind = (kind: EmailKind) => kind.startsWith('shopper_')

export async function countEmailsToday(kind: EmailKind): Promise<number> {
  try {
    const admin = createAdminClient()
    const midnight = new Date()
    midnight.setUTCHours(0, 0, 0, 0)
    const { count } = await admin
      .from('email_log' as any)
      .select('*', { count: 'exact', head: true })
      .eq('kind', kind)
      .gte('sent_at', midnight.toISOString())
    return count ?? 0
  } catch {
    return 0
  }
}

export async function sendStudioEmail(opts: {
  kind: EmailKind
  subject: string
  html: string
  meta?: Record<string, unknown>
  /** Override the recipient (test sends only — the digests always use TO). */
  to?: string
}): Promise<{ sent: boolean; error?: string; id?: string; from?: string; to?: string }> {
  const key = process.env.RESEND_API_KEY
  const to = opts.to ?? TO
  const from = isMemberKind(opts.kind) ? MEMBER_FROM : FROM
  const replyTo = isMemberKind(opts.kind) ? MEMBER_REPLY_TO : undefined
  if (!key) {
    console.error('[sendStudioEmail] RESEND_API_KEY not set — skipping:', opts.subject)
    return { sent: false, error: 'RESEND_API_KEY not set' }
  }
  // A member email's links go through /e, so the JOURNEY tab can tell which
  // email brought her back. Trial and sample sends go to Chloe and would
  // count as the member's clicks, so they are left as they are.
  let html = opts.html
  if (isMemberKind(opts.kind) && !opts.meta?.trial && !opts.meta?.sample) {
    const memberId = await memberForEmail(opts.meta)
    if (memberId) html = trackEmailLinks(html, { memberId, kind: opts.kind, site: siteUrl('') })
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: opts.subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    })
    const raw = await res.text()
    if (!res.ok) {
      // Surface Resend's own words — "domain not verified", "invalid from"
      // etc. are the usual causes and are far more useful than a bare code.
      console.error('[sendStudioEmail]', res.status, raw.slice(0, 300))
      return { sent: false, error: `Resend ${res.status}: ${raw.slice(0, 300)}`, from, to }
    }
    let id: string | undefined
    try { id = JSON.parse(raw)?.id } catch { /* id is a convenience only */ }
    try {
      const admin = createAdminClient()
      await (admin.from('email_log') as any).insert({
        kind: opts.kind, subject: opts.subject, meta: opts.meta ?? null,
      })
    } catch { /* ledger failure never blocks the send result */ }
    return { sent: true, id, from, to }
  } catch (err) {
    console.error('[sendStudioEmail]', err)
    return { sent: false, error: err instanceof Error ? err.message : 'send failed' }
  }
}

// ── Shared HTML bits (email-client-safe: tables + inline styles) ─────────────

export function emailShell(title: string, bodyHtml: string, footer = 'MYRA STUDIO · AUTOMATED'): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f2f2f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e0db;border-radius:12px;overflow:hidden;">
<tr><td style="padding:28px 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;">
  <p style="margin:0 0 4px 0;font-size:13px;letter-spacing:0.14em;color:#4a4e57;">MYRA</p>
  <p style="margin:0;font-size:11px;letter-spacing:0.08em;color:#a8a8a4;text-transform:uppercase;">${title}</p>
</td></tr>
<tr><td style="padding:16px 32px 32px 32px;font-family:Helvetica,Arial,sans-serif;color:#4a4e57;font-size:13px;line-height:1.6;">
${bodyHtml}
</td></tr>
</table>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:10px;color:#a8a8a4;margin-top:14px;letter-spacing:0.05em;">${footer}</p>
</td></tr></table></body></html>`
}

export function emailButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">${label}</a>`
}

export function thumbCell(src: string | null, size = 96): string {
  const img = src
    ? `<img src="${src}" width="${size}" style="display:block;width:${size}px;height:auto;border-radius:6px;border:1px solid #e2e0db;" />`
    : `<div style="width:${size}px;height:${Math.round(size * 1.33)}px;background:#ededed;border-radius:6px;"></div>`
  return `<td style="padding:4px;">${img}</td>`
}
