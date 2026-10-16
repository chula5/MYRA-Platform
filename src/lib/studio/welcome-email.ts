import 'server-only'
import { sendStudioEmail, emailShell, emailButton, siteUrl } from './email'

// HER WELCOME — the three steps, as MYRA, through Resend.
//
// Short on purpose: an intro she will read, three steps she can act on, and
// the Claude connector as one optional line. Goes out as MYRA with replies
// landing with Chloe, like every other member email.

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const step = (n: number, title: string, body: string) => `
  <p style="margin:24px 0 2px 0;font-size:11px;letter-spacing:0.14em;color:#a8a8a4;">STEP ${n}</p>
  <p style="margin:0 0 6px 0;font-size:17px;color:#0a0a0a;">${title}</p>
  ${body}`

export function welcomeEmailHtml(name: string): string {
  const who = esc((name ?? '').trim().split(/\s+/)[0] || 'there')
  const body = `
  <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">Dear ${who},</p>
  <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">Thank you so much for wanting to try MYRA. I built it to do what a good friend with great taste would do: look at everything in the shops, and show you only the pieces you would actually wear, in your size, from the brands you love. Then style them into whole outfits with what you already own, so every new piece earns its keep. MYRA even works out the cost per wear.</p>
  <p style="margin:0;font-size:15px;line-height:1.6;">Three short steps. Nothing to pay, and nothing to download at first.</p>

  ${step(1, 'Apply', `<p style="margin:0;font-size:14px;line-height:1.6;">Go to <a href="${siteUrl('/')}" style="color:#0a0a0a;">www.myraassistant.co.uk</a> and press <strong>APPLY NOW</strong>. Five minutes: your brands, your sizes, what you like to spend. I read every application myself and email you a personal link.</p>
  <p style="margin:14px 0 0 0;">${emailButton(siteUrl('/'), 'Apply now')}</p>`)}

  ${step(2, 'Come in', `<p style="margin:0;font-size:14px;line-height:1.6;">Open your link and choose a password. <strong>FOR YOU</strong> is where your outfits live: tap any look to see every piece in your size, with a link to buy. Say yes to the ones you love and skip the rest. MYRA learns from every answer.</p>`)}

  ${step(3, 'Add the MYRA Mirror', `<p style="margin:0 0 10px 0;font-size:14px;line-height:1.6;">A small browser add-on, and the part people love most. Every brand website you visit is quietly re-arranged so the pieces you would actually wear come first. Press <strong>Save</strong> on any item and MYRA watches the stock in your size. Press <strong>Wear it with</strong> and MYRA builds three outfits around it.</p>
  <p style="margin:0;font-size:14px;line-height:1.6;">On your computer: in MYRA, open <strong>YOU</strong> and press <strong>Add in Chrome</strong>. On your iPhone: install the MYRA app, then turn on <strong>MYRA Mirror</strong> under Settings › Apps › Safari › Extensions.</p>`)}

  <p style="margin:24px 0 0 0;font-size:14px;line-height:1.6;">Optional, for later: add MYRA to Claude from <strong>YOU</strong>, and ask it “what should I wear to Sunday lunch?” in plain words.</p>
  <p style="margin:24px 0 0 0;font-size:14px;line-height:1.6;">If anything is unclear, just reply to this email or ring me. I would much rather talk you through it than have you stuck.</p>
  <p style="margin:24px 0 0 0;font-size:14px;line-height:1.6;">With love,<br>Chloe</p>`
  return emailShell('YOUR PRIVATE STYLIST', body, 'MYRA · YOUR STYLIST')
}

export const WELCOME_SUBJECT = 'Welcome to MYRA: three easy steps to get started'

export async function sendWelcomeEmail(to: string, name: string) {
  return sendStudioEmail({ kind: 'shopper_welcome', to, subject: WELCOME_SUBJECT, html: welcomeEmailHtml(name), meta: { to, name } })
}
