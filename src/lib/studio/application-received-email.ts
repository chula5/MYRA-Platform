import 'server-only'
import { sendStudioEmail, emailShell, emailButton, siteUrl } from './email'

// SOMEONE APPLIED — a note to Chloe the moment an application lands, with
// everything she wrote and a button to the review queue. Studio kind: goes
// out as MYRA Studio to STUDIO_EMAIL_TO. Best effort; the submit never waits
// on it failing.

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface ApplicationReceived {
  name: string | null
  email: string
  brands: string | null
  priceRange: string | null
  inspiration: string | null
  note: string | null
}

const row = (label: string, value: string | null) =>
  value
    ? `<tr><td style="padding:6px 12px 6px 0;font-size:10px;letter-spacing:0.14em;color:#a8a8a4;vertical-align:top;white-space:nowrap;">${label}</td><td style="padding:6px 0;font-size:14px;line-height:1.5;color:#2b2b2b;">${esc(value)}</td></tr>`
    : ''

export function applicationReceivedHtml(a: ApplicationReceived): string {
  const who = esc((a.name ?? '').trim() || a.email)
  const body = `
  <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#2b2b2b;">${who} has applied for her private stylist.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 18px 0;">
    ${row('NAME', a.name)}
    ${row('EMAIL', a.email)}
    ${row('BRANDS', a.brands)}
    ${row('SHOPS AROUND', a.priceRange)}
    ${row('INSPIRED BY', a.inspiration)}
    ${row('IN HER WORDS', a.note)}
  </table>
  <p style="margin:0 0 10px 0;">${emailButton(siteUrl('/admin/applications'), 'Read the application')}</p>
  <p style="margin:0;font-size:12px;color:#7c838b;">ACCEPT there makes her a member with her brands in and emails her invitation. DECLINE only records it.</p>`
  return emailShell('SOMEONE APPLIED', body)
}

export async function sendApplicationReceivedEmail(a: ApplicationReceived) {
  const who = (a.name ?? '').trim() || a.email
  return sendStudioEmail({ kind: 'application_received', subject: `New application: ${who}`, html: applicationReceivedHtml(a), meta: { email: a.email, name: a.name } })
}
