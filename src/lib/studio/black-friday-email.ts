import 'server-only'
import { sendStudioEmail, siteUrl } from './email'

// BLACK FRIDAY, SORTED — the announcement Chloe approved from the preview sent
// on 9 Nov: the sale edit at her brands, wait-for-sale, saved searches,
// save-a-screenshot, and the avatar (launched 10 Nov). Sent as MYRA, replies to
// Chloe, addressed to each member by her first name.

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const BLACK_FRIDAY_SUBJECT = 'Black Friday, sorted — and your own avatar is here'

const FONT = 'font-family:Helvetica,Arial,sans-serif;'
const p = (t: string) => `<p style="margin:0 0 16px 0;${FONT}font-size:16px;line-height:1.6;color:#2b2b2b;">${t}</p>`
const h = (t: string) => `<p style="margin:30px 0 10px 0;${FONT}font-size:15px;letter-spacing:0.12em;line-height:1.4;color:#2b2b2b;text-transform:uppercase;">${t}</p>`
const b = (t: string) => `<strong style="color:#0a0a0a;">${t}</strong>`

export function blackFridayEmailHtml(name: string): string {
  const first = greetingName(name)
  const greeting = first ? `Hello ${esc(first)},` : 'Hello,'
  const avatar = siteUrl('/email/avatar.jpg')

  const body = `
${p(greeting)}
${p('Black Friday sales are already starting. Rather than you checking twenty shops, MYRA is now doing it for you. Here&rsquo;s what&rsquo;s new.')}

${h('1. Black Friday, at your brands only')}
${p(`There&rsquo;s a new ${b('price tag')} at the top of MYRA, next to your wardrobe heart. Tap it to see what&rsquo;s on sale ${b('at the brands you love, in your size and within your budget')}. Nothing else.`)}
${p(`We put the pieces your wardrobe is missing first. If you&rsquo;re short of a coat, the sale coats lead. You&rsquo;ll also find the same edit on your ${b('For You')} page.`)}
${p('When one of your brands goes on sale, MYRA tells you once, with how many pieces are in your size and how much is off.')}

${h('2. Save it and wait for the sale')}
${p(`Love something but not the price? Save it, then tap ${b('WAIT FOR SALE')} under it in your Dressing Room. MYRA watches the price around the clock and tells you the moment it drops.`)}
${p(`MYRA will also tell you if something you&rsquo;ve saved is ${b('running low in your size')}, so you never miss it.`)}

${h('3. Save a search and let MYRA keep looking')}
${p(`Looking for something specific, a blouse for NYE? Search for it in ${b('Browse')} and tap ${b('SAVE')}, right beside the microphone.`)}
${p(`MYRA keeps looking for you. Come back later and your finds are waiting, marked ${b('NEW')}, each with a note on why it matched. Tap ${b('YES')} to keep a piece or ${b('NOT THIS')} and MYRA learns what you don&rsquo;t want. If it finds something really good, it tells you straight away.`)}
${p(`You&rsquo;ll find all your searches in your ${b('Dressing Room')}, under ${b('YOUR SEARCHES')}.`)}

${h('4. See it, screenshot it, save it')}
${p(`Spotted something you love while you&rsquo;re shopping in Safari? Take a screenshot and tap ${b('SAVE A SCREENSHOT')} on your ${b('For You')} page or your ${b('Saved')} shelf in the Dressing Room.`)}
${p('MYRA reads the picture, works out the brand and the piece, and finds the real link for you, at any brand. It&rsquo;s then saved like anything else in MYRA: styled for you, and watched for stock and price. No extension to install. If MYRA can&rsquo;t find the exact piece, your screenshot is still kept.')}

${h('5. New: your own avatar')}
${p(`MYRA can now build an avatar of you, with your face and in your real shape. Tap ${b('MY AVATAR')} in your Dressing Room and add three or four photos of yourself. Within a few minutes MYRA draws two portraits; pick the one that looks most like you.`)}
${p(`Then dress it in the pieces from your wardrobe: tuck a top, cinch a jacket, swap the shoes, and see the whole outfit before you get dressed. Any piece marked ${b('SEE ON MY AVATAR')} goes straight on.`)}
${p('Your photos are used only to make your avatar and are deleted once you approve it.')}
<img src="${avatar}" width="496" alt="A MYRA avatar dressed in a check wool blazer, wide trousers and heels" style="display:block;width:100%;max-width:496px;height:auto;border-radius:12px;margin:8px 0 0 0;border:0;" />`

  return `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="padding:0 0 28px 0;${FONT}font-size:26px;letter-spacing:0.14em;color:#2b2b2b;">MYRA</td></tr>
<tr><td>
${body}
</td></tr>
<tr><td style="padding:28px 0 0 0;${FONT}font-size:11px;letter-spacing:0.08em;color:#a8a8a4;">MYRA &middot; YOUR PRIVATE STYLIST</td></tr>
</table>
</td></tr></table></body></html>`
}

export async function sendBlackFridayEmail(to: string, name: string, meta: Record<string, unknown> = {}) {
  return sendStudioEmail({
    kind: 'shopper_black_friday', to, subject: BLACK_FRIDAY_SUBJECT,
    html: blackFridayEmailHtml(name), meta: { to, name, ...meta },
  })
}

// ── The send to every member ────────────────────────────────────────────────

/** "anne" → "Anne"; an email or blank in the name field greets her plainly. */
export function greetingName(name: string | null | undefined): string {
  let first = String(name ?? '').trim().split(/\s+/)[0] ?? ''
  if (!first || first.includes('@')) return ''
  // Chloe, 2026-11-12: "fix Anne Spaven, fix her name".
  if (/spaven/i.test(String(name))) first = 'Anne'
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

// People Chloe added by hand (2026-11-12), at the addresses she gave. Any member
// row with the same name is skipped so neither gets it twice.
const ADDED_BY_CHLOE = [
  { name: 'Carys James', to: 'jamescarys@hotmail.co.uk', match: /carys.*james/i },
  { name: 'Sevinch', to: 'sevinch.ochilova8@gmail.com', match: /sevinch/i },
]

const pause = () => new Promise((r) => setTimeout(r, 600))

export type SendRow = { who: string; greeting: string; to?: string; status?: string; skipped?: string; sent?: boolean; error?: string }

export async function sendBlackFridayToEveryone(admin: any, send: boolean) {
  const { data: logged } = await admin.from('email_log').select('meta').eq('kind', 'shopper_black_friday')
  const doneMember = new Set(((logged ?? []) as any[]).map((r) => r.meta?.memberId).filter(Boolean))
  const doneTo = new Set(((logged ?? []) as any[]).map((r) => String(r.meta?.to ?? '').toLowerCase()).filter(Boolean))
  const seen = new Set<string>()
  const rows: SendRow[] = []

  const addressFor = async (m: any): Promise<string | null> => {
    let email: string | null = null
    if (m.auth_user_id) {
      try { email = (await admin.auth.admin.getUserById(m.auth_user_id)).data?.user?.email ?? null } catch { /* none */ }
    }
    return email || m.email || m.invite_email || null
  }

  const queue: { m: any; to: string | null; row: SendRow }[] = []

  const { data: members, error } = await admin.from('pilot_member')
    .select('member_id, name, auth_user_id, email, invite_email').eq('is_synthetic', false)
  if (error) return { error: error.message, rows }
  for (const m of (members ?? []) as any[]) {
    const g = greetingName(m.name)
    const row: SendRow = { who: m.name ?? m.member_id, greeting: g ? `Hello ${g},` : 'Hello,', status: m.auth_user_id ? 'signed up' : 'added, not signed in yet' }
    rows.push(row)
    if (doneMember.has(m.member_id)) { row.skipped = 'already sent'; continue }
    if (ADDED_BY_CHLOE.some((p) => p.match.test(String(m.name ?? '')))) { row.skipped = 'sent to the address Chloe gave instead'; continue }
    queue.push({ m, to: await addressFor(m), row })
  }

  for (const p of ADDED_BY_CHLOE) {
    const g = greetingName(p.name)
    queue.unshift({ m: { name: p.name }, to: p.to, row: (() => { const r: SendRow = { who: `${p.name} (added by Chloe)`, greeting: `Hello ${g},` }; rows.push(r); return r })() })
  }

  let sent = 0
  for (const { m, to, row } of queue) {
    if (!to) { row.skipped = 'no email address on file'; continue }
    row.to = to
    const key = to.toLowerCase()
    if (doneTo.has(key)) { row.skipped = 'already sent to this address'; continue }
    if (seen.has(key)) { row.skipped = 'same address as another row'; continue }
    seen.add(key)
    if (!send) continue
    const res = await sendBlackFridayEmail(to, greetingName(m.name), m.member_id ? { memberId: m.member_id } : {})
    row.sent = res.sent
    if (res.error) row.error = res.error
    if (res.sent) sent++
    await pause()
  }

  return { members: (members ?? []).length, willReceive: rows.filter((r) => r.to && !r.skipped).length, sent, rows }
}

/** To Chloe: exactly who it went to, who was skipped and why. */
export function sendReportHtml(result: { sent?: number; rows: SendRow[]; error?: string }, mode: string): string {
  const cell = (t: string) => `<td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top;">${esc(t)}</td>`
  const trs = result.rows.map((r) => `<tr>${cell(r.who)}${cell(r.greeting)}${cell(r.to ?? '—')}${cell(r.sent ? 'SENT' : r.skipped ?? r.error ?? (mode === 'SENT' ? 'not sent' : 'will send'))}</tr>`).join('')
  return `<div style="${FONT}color:#2b2b2b;">
<p style="font-size:15px;">${esc(mode)}: Black Friday email. ${result.error ? 'Error: ' + esc(result.error) : `${result.sent ?? 0} sent.`}</p>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;${FONT}">
<tr>${['Who', 'Greeting', 'Address', 'Result'].map((h) => `<th align="left" style="padding:6px 8px;font-size:11px;letter-spacing:0.08em;color:#a8a8a4;">${h.toUpperCase()}</th>`).join('')}</tr>
${trs}</table></div>`
}
