import 'server-only'
import { sendStudioEmail, emailShell, emailButton, siteUrl } from './email'
import { testflightUrl } from './invitation-email'

// HER APP — "your account is set up", and the two installs that get MYRA on
// her iPhone: TestFlight from the App Store, then MYRA through the TestFlight
// link. Sent as MYRA, replies to Chloe. Refuses to send without the link set
// (NEXT_PUBLIC_MIRROR_IOS_URL), since the email is pointless without it.

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Apple's own App Store listing for TestFlight.
const TESTFLIGHT_STORE = 'https://apps.apple.com/app/testflight/id899247664'

const step = (n: number, title: string, body: string) => `
  <p style="margin:24px 0 2px 0;font-size:11px;letter-spacing:0.14em;color:#a8a8a4;">STEP ${n}</p>
  <p style="margin:0 0 6px 0;font-size:17px;color:#0a0a0a;">${title}</p>
  ${body}`

const p = (t: string, margin = '0') => `<p style="margin:${margin};font-size:14px;line-height:1.6;">${t}</p>`

export function appReadyEmailHtml(name: string, tf: string): string {
  const who = esc((name ?? '').trim().split(/\s+/)[0] || 'there')
  const link = esc(tf)
  const body = `
  <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">Dear ${who},</p>
  <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">Your MYRA account is set up and ready for you. All that is left is to get MYRA onto your iPhone.</p>
  <p style="margin:0;font-size:15px;line-height:1.6;">MYRA is still in its private, early version, so it comes through <strong>TestFlight</strong>, Apple’s own app for trying new apps before they reach the App Store. It takes about two minutes. Please do these on your iPhone.</p>

  ${step(1, 'Download TestFlight', p('Open the App Store and search for <strong>TestFlight</strong> (the blue icon, made by Apple, free), then press <strong>Get</strong>. Or press the button below.') +
    `<p style="margin:14px 0 0 0;">${emailButton(TESTFLIGHT_STORE, 'Get TestFlight')}</p>`)}

  ${step(2, 'Install MYRA', p('Come back to this email on your iPhone and press the button below. It opens in TestFlight: press <strong>Accept</strong>, then <strong>Install</strong>.') +
    `<p style="margin:14px 0 8px 0;">${emailButton(link, 'Install MYRA')}</p>` +
    `<p style="margin:0;font-size:12px;color:#7c838b;">If the button does nothing, copy this link into Safari: <a href="${link}" style="color:#2b2b2b;text-decoration:underline;">${link}</a></p>`)}

  ${step(3, 'Open MYRA and sign in', p('MYRA is now on your home screen, like any other app. Open it and sign in with your email and the password you chose. Everything is already there waiting for you.'))}

  ${p(`Optional, for later: MYRA can also tidy every shop you visit in Safari. Go to <strong>Settings › Apps › Safari › Extensions</strong>, turn on <strong>MYRA Mirror</strong> and choose <strong>All Websites</strong>. It works on your computer too, at <a href="${siteUrl('/signin')}" style="color:#0a0a0a;">www.myraassistant.co.uk</a>.`, '24px 0 0 0')}
  ${p('If anything is unclear, just reply to this email or ring me. I would much rather talk you through it than have you stuck.', '24px 0 0 0')}
  ${p('With love,<br>Chloe', '24px 0 0 0')}`
  return emailShell('YOUR ACCOUNT IS READY', body, 'MYRA · YOUR STYLIST')
}

export const APP_READY_SUBJECT = 'Your MYRA account is ready: getting the app on your iPhone'

export async function sendAppReadyEmail(to: string, name: string) {
  const tf = testflightUrl()
  if (!tf) return { sent: false, error: 'NEXT_PUBLIC_MIRROR_IOS_URL (the TestFlight link) is not set' }
  return sendStudioEmail({ kind: 'shopper_app_ready', to, subject: APP_READY_SUBJECT, html: appReadyEmailHtml(name, tf), meta: { to, name } })
}
