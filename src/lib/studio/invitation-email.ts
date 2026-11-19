import 'server-only'
import { sendStudioEmail, siteUrl } from './email'
import { BLACK_FRIDAY } from '@/lib/sales/detect'

// HER INVITATION — sent by ACCEPT on /admin/applications, and by the sign-up
// form itself when AUTO-ACCEPT is on, as MYRA through Resend. The words follow
// Chloe's hand-sent invitations (Landing Page folder, bella-gasparro-
// invitation-draft.html, 2026-11-17): Step 1 her /join link and her brands,
// Step 2 the iPhone app, Step 3 the rooms with their icons, Step 4 two things
// worth doing first, Step 5 NEW THIS MONTH (avatar, wait for sale, and Black
// Friday only inside the sales window), Step 6 the Mirror with its picture,
// Step 7 Claude/ChatGPT.

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const YOU_ICON = '<img src="https://res.cloudinary.com/dugby2pow/image/upload/w_72,h_72,c_fit/v1792338836/myra/email/you-icon.png" width="18" height="18" alt="the person icon" style="display:inline-block;vertical-align:-3px;width:18px;height:18px;border:0;" />'
const B = (t: string) => `<strong style="color:#2b2b2b;">${t}</strong>`
const P = (t: string, margin = '0 0 10px 0') => `<p style="margin:${margin};font-size:15px;color:#4a4e57;">${t}</p>`
const BUTTON = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">${label}</a>`
const step = (n: number | string, title: string, body: string, first = false) => `
<p style="margin:${first ? 26 : 30}px 0 2px 0;font-size:11px;letter-spacing:0.14em;color:#7c838b;">${n}</p>
<p style="margin:0 0 10px 0;font-size:19px;color:#2b2b2b;">${title}</p>
${body}`

/** The iPhone TestFlight link, when Chloe has set it (NEXT_PUBLIC_MIRROR_IOS_URL). */
export const testflightUrl = (): string => (process.env.NEXT_PUBLIC_MIRROR_IOS_URL ?? '').trim()

// Pictures Chloe chose for these emails (2026-11-17): the brown-look avatar
// and the Mirror styling a coat. Hosted on Cloudinary like the room icons.
const AVATAR_PICTURE = 'https://res.cloudinary.com/dugby2pow/image/upload/v1794955221/myra/email/avatar-brown-look.jpg'
const MIRROR_PICTURE = 'https://res.cloudinary.com/dugby2pow/image/upload/v1794955223/myra/email/mirror-style-this.jpg'
const ROOM = (key: string, v: string) => `https://res.cloudinary.com/dugby2pow/image/upload/${v}/myra/email/room-${key}.png`
const ROOMS: { icon: string; name: string; line: string }[] = [
  { icon: ROOM('for_you', 'v1792611058'), name: 'FOR YOU', line: 'What MYRA did while you shopped: more of the same, more from your brands, and the pieces you saved, already styled.' },
  { icon: ROOM('browse', 'v1792611059'), name: 'BROWSE', line: 'Ask for anything in your own words: “a wedding in June”, typed or spoken.' },
  { icon: ROOM('all_looks', 'v1792611060'), name: 'LOOKS', line: 'Every outfit MYRA has made for you. Thumbs up or down and MYRA learns; the ones you loved, sorted by occasion, each piece in your size with a link to buy.' },
  { icon: ROOM('dressing_room', 'v1792611060'), name: 'DRESSING ROOM', line: 'Your own wardrobe pieces, the pieces you saved while shopping and your latest ordered items. Tap any piece to see it styled.' },
  { icon: ROOM('events', 'v1792611062'), name: 'EVENTS', line: 'Your calendar. Three outfits for each day worth dressing for, every Monday.' },
  { icon: ROOM('sharing', 'v1792611062'), name: 'SHARING', line: 'Friends on MYRA. Send them a look or a piece and talk it over. The speech bubbles in the top corner.' },
  { icon: ROOM('profile', 'v1792611064'), name: 'YOU', line: 'Your sizes, your brands, your inspiration and what MYRA has learned. The person icon in the top corner.' },
]

const roomsTable = () => `
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;background:#f7f7f6;border-radius:10px;margin:0 0 10px 0;">
<tr><td style="padding:18px 20px 18px 20px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
${ROOMS.map((r, i) => `<tr>
  <td style="padding:${i ? 14 : 0}px 14px 0 0;vertical-align:top;width:36px;"><img src="${r.icon}" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border:0;" /></td>
  <td style="padding:${i ? 14 : 0}px 0 0 0;vertical-align:top;font-size:15px;line-height:1.6;color:#4a4e57;">${B(r.name)}<br>${r.line}</td>
</tr>`).join('')}
</table>
</td></tr>
</table>`

/** The Black Friday line only while the sales window is open (lib/sales/detect). */
const inSaleWindow = (d = new Date()) => {
  const day = d.toISOString().slice(0, 10)
  return day >= BLACK_FRIDAY.from && day <= BLACK_FRIDAY.to
}

export function invitationEmailHtml(name: string, inviteUrl: string, now = new Date()): string {
  const who = esc((name ?? '').trim().split(/\s+/)[0] || 'there')
  const link = esc(inviteUrl)
  const tf = testflightUrl()
  const web = `<p style="margin:0;font-size:12px;color:#7c838b;">It works on your computer too, at <a href="${siteUrl('/signin')}" style="color:#2b2b2b;text-decoration:underline;">www.myraassistant.co.uk</a>, and looks exactly the same on both.</p>`

  const appStep = tf
    ? P(`MYRA is on ${B('TestFlight')}, Apple’s app for early versions. Download TestFlight from the App Store (it is free and made by Apple), then open this link on your phone to install MYRA. Sign in with the same email and password you just chose.`, '0 0 16px 0') +
      `<p style="margin:0 0 16px 0;">${BUTTON(esc(tf), 'INSTALL THE APP')}</p>` +
      `<p style="margin:0 0 10px 0;font-size:12px;color:#7c838b;">Keep TestFlight on your phone, because that is how MYRA updates itself.</p>` + web
    : P(`MYRA is on ${B('TestFlight')}, Apple’s app for early versions. First, download TestFlight on your iPhone. It is free and made by Apple.`, '0 0 16px 0') +
      `<p style="margin:0 0 16px 0;">${BUTTON('https://apps.apple.com/gb/app/testflight/id899247664', 'DOWNLOAD TESTFLIGHT')}</p>` +
      P(`Then look out for an email from ${B('TestFlight')} inviting you to test MYRA. Open it on your phone, press ${B('View in TestFlight')}, then ${B('Accept')} and ${B('Install')}. Sign in there with the same email and password you just chose.`) + web

  const newThisMonth =
    P(`${B('Your own avatar.')} In the ${B('DRESSING ROOM')}, press ${B('MY AVATAR')}. MYRA builds an avatar of you from your own photos, in your real shape. Dress it in your pieces: tuck a top, button a jacket, swap the shoes, and see the whole outfit before you get dressed.`) +
    `<p style="margin:0 0 16px 0;"><img src="${AVATAR_PICTURE}" width="320" alt="A MYRA avatar in a brown knit, a camel skirt and green heels" style="display:block;width:100%;max-width:320px;height:auto;margin:0 auto;border-radius:10px;border:1px solid #e2e0db;" /></p>` +
    P(`${B('Wait for the sale.')} Love something but not the price? Save it, then tap ${B('WAIT FOR SALE')} under it in your Dressing Room. MYRA watches the price and tells you the moment it drops, and if it is running low in your size.`, inSaleWindow(now) ? '0 0 10px 0' : '0') +
    (inSaleWindow(now)
      ? P(`${B('Black Friday, at your brands only.')} Tap ${B('BLACK FRIDAY')} on your For You page to see what is on sale at your brands, in your size and under your budget, with the pieces your wardrobe is missing first. When one of your brands goes on sale, MYRA tells you once.`, '0')
      : '')

  const body = `
<p style="margin:0 0 6px 0;font-size:15px;color:#2b2b2b;">Dear ${who},</p>
${P('Thank you so much for applying to MYRA. I would love to have you as one of its very first members, and I would love to get you properly set up. Below is everything you need, step by step. It is just for you, so please do not forward it.', '0 0 12px 0')}

${step('STEP 1', 'Come in',
  P('Press the button and choose a password. MYRA then walks you through a two-minute welcome. The brands you told me about are already in: check them, and feel free to add any more you would like from the brand selection, then have a look around.', '0 0 16px 0') +
  `<p style="margin:0 0 8px 0;">${BUTTON(link, 'OPEN MY INVITATION')}</p>` +
  `<p style="margin:0;font-size:12px;color:#7c838b;">Or type this into your browser: <a href="${link}" style="color:#2b2b2b;text-decoration:underline;">${link}</a></p>`, true)}

${step('STEP 2', 'Get MYRA on your iPhone', appStep)}

${step('STEP 3', 'Your rooms, in one line each', roomsTable())}

${step('STEP 4', 'Two things worth doing first',
  P(`${B('Upload your wardrobe.')} In the ${B('DRESSING ROOM')}, add photos of the pieces you already own, or sync your Gmail and MYRA will find what you have bought from your order emails. From then on every outfit can be built around what is already in your cupboard.`) +
  P(`${B('Connect Instagram.')} In the ${B('DRESSING ROOM')}, beside the Gmail circle, press Instagram. MYRA keeps the outfits you have already worn as inspiration, and learns your taste from them.`, '0'))}

${step('STEP 5', 'New this month', newThisMonth)}

${step('STEP 6', 'Do not forget the MYRA Mirror', `
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 14px 0;">
<tr>
  <td style="padding:0 16px 0 0;vertical-align:top;width:72px;">
    <img src="${siteUrl('/Mirror.png')}" width="72" alt="The MYRA Mirror" style="display:block;width:72px;height:auto;border-radius:8px;border:1px solid #e2e0db;" />
  </td>
  <td style="vertical-align:top;">
    ${P(`The browser add-on that puts every shop in your order, with ${B('Save')} and ${B('Wear it with')} on every item. It only looks at the shop pages you open, and you can switch it off at any time.`, '0')}
  </td>
</tr>
</table>
${P('On any piece, MYRA shows you what to wear with it, from your brands and in your size. Save the look, or try it on your avatar.', '0 0 6px 0')}
<p style="margin:0 0 16px 0;"><img src="${MIRROR_PICTURE}" width="496" alt="The MYRA Mirror beside a coat on a shop page, showing what to wear with it" style="display:block;width:100%;max-width:496px;height:auto;border-radius:10px;border:1px solid #e2e0db;" /></p>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;background:#f7f7f6;border-radius:10px;margin:0 0 10px 0;">
<tr><td style="padding:18px 20px 16px 20px;">
  <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:0.14em;color:#7c838b;">ON YOUR IPHONE (SAFARI)</p>
  <p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;color:#4a4e57;">The Mirror comes inside the app. Go to ${B('Settings › Apps › Safari › Extensions')}, turn on ${B('MYRA Mirror')}, choose ${B('All Websites')}, then in MYRA open ${B('YOU')} ${YOU_ICON} and press ${B('Connect')}.</p>
  <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:0.14em;color:#7c838b;">ON YOUR COMPUTER (CHROME)</p>
  <p style="margin:0;font-size:15px;line-height:1.7;color:#4a4e57;">In MYRA open ${B('YOU')} ${YOU_ICON}, find ${B('MYRA in Safari and Chrome')}, press ${B('Add in Chrome')}, say yes to Chrome, then come back and press ${B('Connect Chrome')}.</p>
</td></tr>
</table>`)}

${step('STEP 7', 'Ask MYRA from Claude or ChatGPT',
  P(`In ${B('YOU')} ${YOU_ICON}, find ${B('MYRA in Claude or ChatGPT')}, copy your private link and add it as a connector in your AI. Then simply type “What should I wear to dinner?” and it answers with real outfits from your MYRA, in your size.`, '0'))}

${P('If anything is unclear at any point, just reply to this email or ring me. I would much rather talk you through it than have you stuck.', '30px 0 10px 0')}
<p style="margin:0;font-size:15px;color:#2b2b2b;">With love,<br>Chloe</p>`

  // Same shell as the hand-made emails: logo, kicker, 15px body, silver footer.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your MYRA invitation</title></head><body style="margin:0;padding:0;background:#f2f2f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e0db;border-radius:12px;overflow:hidden;">
<tr><td style="padding:28px 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;">
  <img src="${siteUrl('/myra-logo-black.png')}" width="118" alt="MYRA" style="display:block;width:118px;height:auto;border:0;margin:0 0 10px 0;" />
  <p style="margin:0;font-size:11px;letter-spacing:0.08em;color:#a8a8a4;text-transform:uppercase;">YOUR INVITATION · HOW TO USE MYRA</p>
</td></tr>
<tr><td style="padding:16px 32px 32px 32px;font-family:Helvetica,Arial,sans-serif;color:#4a4e57;font-size:15px;line-height:1.6;">
${body}
</td></tr>
</table>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:10px;color:#a8a8a4;margin-top:14px;letter-spacing:0.05em;">MYRA · YOUR STYLIST</p>
</td></tr></table></body></html>`
}

export const INVITATION_SUBJECT = 'Your MYRA invitation'

export async function sendInvitationEmail(to: string, name: string, inviteUrl: string) {
  return sendStudioEmail({ kind: 'shopper_invitation', to, subject: INVITATION_SUBJECT, html: invitationEmailHtml(name, inviteUrl), meta: { to, name } })
}
