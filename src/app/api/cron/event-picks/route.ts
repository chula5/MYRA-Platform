// EVENTS — the weekly options (Vercel cron; see vercel.json).
//
// Chloe asked (2026-10-12): the Events room should refresh itself weekly after
// the Monday Brand Watch upload — two or three options per upcoming event,
// from the brands she likes or near them, in her size and price band, each
// styled for the night and checked — and she should be told, by email and in
// the app, the way the overnight note tells her about her styled pieces.
//
//   Monday 10:00 UTC   mode=compose  this week's picks for every real member, then the note
//   Thursday 09:00 UTC mode=notify   picks she has not been told about yet (a brief set midweek,
//                                    a pick Chloe released) — composes only for events with none
//
//     curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/event-picks?mode=compose"
//
//   ?member=<id>   one member only
//   ?dry=1         compose nothing, send nothing: report what would happen
//   ?hold=1        a TRIAL: compose for real but hold the picks from her (Chloe reviews them in admin)
//   ?to=a@b.c      send the note to this address instead of hers (no app note, nothing marked told)
//   ?preview=1     return the note as HTML, send nothing
//   ?perEvent=3    options per event (default 2)
//   ?force=1       add picks even when this week already has them
//   ?site=http://localhost:3000   links open here (pictures stay on the live site)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendStudioEmail, emailShell, emailButton, siteUrl } from '@/lib/studio/email'
import { thumbUrl } from '@/lib/image-utils'
import { composeEventPicks, eventsWithPicks, markPicksTold, type EventWithPicks, type EventPickView } from '@/lib/events/picks'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function sayDate(iso: string): string {
  const [y, m, d] = (iso ?? '').split('-')
  const name = MONTHS[Number(m) - 1] ?? ''
  return [d ? Number(d) : null, name, y].filter(Boolean).join(' ')
}
const money = (n: number | null) => (n == null ? '' : `£${Math.round(n)}`)
const base = (b?: string) => (b ? b.replace(/\/$/, '') : siteUrl(''))
const pictureFor = (url: string) => { const t = thumbUrl(url, 256); return t.startsWith('/') ? siteUrl(t) : t }
const waysLink = (p: EventPickView, b?: string) => `${base(b)}/me/ways/${encodeURIComponent(p.item_id)}`

/** One pick: the piece, then each kept outfit as a row of its pieces. */
function pickHtml(p: EventPickView, b?: string): string {
  const link = waysLink(p, b)
  const outfits = p.ways.slice(0, 3).map((w) => {
    const pieces = w.items.filter((it) => it.image_url && it.item_id !== p.item_id).slice(0, 4)
    if (!pieces.length) return ''
    return `<tr><td style="padding:6px 0 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
      <td style="padding:0 6px 0 0;vertical-align:middle;"><a href="${link}" style="font-size:11px;letter-spacing:0.08em;color:#7c838b;text-decoration:none;">WITH</a></td>
      ${pieces.map((it) => `<td style="padding:0 6px 0 0;"><a href="${link}"><img src="${pictureFor(it.image_url!)}" width="56" style="display:block;width:56px;height:auto;border-radius:6px;border:1px solid #e2e0db;" alt="${esc(it.product_name)}" /></a></td>`).join('')}
    </tr></table></td></tr>`
  }).join('')
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 18px 0;">
      <tr>
        <td style="padding:0 14px 0 0;vertical-align:top;width:120px;">
          <a href="${link}">${p.image_url
            ? `<img src="${pictureFor(p.image_url)}" width="120" style="display:block;width:120px;height:auto;border-radius:8px;border:1px solid #e2e0db;" alt="${esc(p.product_name)}" />`
            : '<div style="width:120px;height:160px;background:#ededed;border-radius:8px;"></div>'}</a>
        </td>
        <td style="vertical-align:top;">
          ${p.brand ? `<p style="margin:0 0 2px 0;font-size:11px;letter-spacing:0.12em;color:#7c838b;">${esc(p.brand.toUpperCase())}</p>` : ''}
          <p style="margin:0 0 4px 0;font-size:15px;color:#2b2b2b;">${esc(p.product_name)}${p.price_gbp != null ? ` <span style="color:#7c838b;">· ${money(p.price_gbp)}</span>` : ''}</p>
          <p style="margin:0 0 8px 0;font-size:13px;color:#4a4e57;">${esc(p.why)}</p>
          <a href="${link}" style="font-size:12px;letter-spacing:0.08em;color:#2b2b2b;text-decoration:underline;">${p.ways.length} ${p.ways.length === 1 ? 'OUTFIT' : 'OUTFITS'} AROUND IT</a>
          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${outfits}</table>
        </td>
      </tr>
    </table>`
}

function noteHtml(firstName: string, events: EventWithPicks[], b?: string): string {
  const total = events.reduce((n, e) => n + e.picks.length, 0)
  const sections = events.map((e) => `
    <p style="margin:22px 0 2px 0;font-size:11px;letter-spacing:0.14em;color:#7c838b;">${esc(sayDate(e.event_date).toUpperCase())}</p>
    <p style="margin:0 0 4px 0;font-size:19px;color:#2b2b2b;">${esc(e.label)}</p>
    ${e.brief ? `<p style="margin:0 0 14px 0;font-size:13px;color:#7c838b;">You asked for: “${esc(e.brief)}”</p>` : '<p style="margin:0 0 14px 0;"></p>'}
    ${e.picks.map((p) => pickHtml(p, b)).join('')}`).join('')
  const body = `
    <p style="margin:0 0 6px 0;font-size:15px;color:#2b2b2b;">${esc(firstName ? `${firstName}, ` : '')}MYRA has ${total === 1 ? 'a new option' : `${total} new options`} for what you have coming up — in your size, within your budget, each styled and checked before you see it.</p>
    ${sections}
    <p style="margin:26px 0 0 0;">${emailButton(`${base(b)}/me/events`, 'SEE YOUR EVENTS')}</p>
    <p style="margin:14px 0 0 0;font-size:12px;color:#7c838b;">Tell MYRA what you are looking for on each event and the next options follow your brief.</p>`
  return emailShell('FOR YOUR EVENTS', body, 'MYRA · YOUR STYLIST')
}

function subjectFor(events: EventWithPicks[]): string {
  const total = events.reduce((n, e) => n + e.picks.length, 0)
  if (events.length === 1) return `${total} ${total === 1 ? 'option' : 'options'} for your ${events[0].label.trim()}`
  return `${total} new options for your events`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  const q = req.nextUrl.searchParams
  const mode = q.get('mode') === 'notify' ? 'notify' : 'compose'
  const dry = q.get('dry') === '1'
  const hold = q.get('hold') === '1'
  const force = q.get('force') === '1'
  const preview = q.get('preview') === '1'
  const toOverride = q.get('to')
  const perEvent = Number(q.get('perEvent') ?? 0) || undefined
  const site = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(q.get('site') ?? '') ? q.get('site')! : undefined
  const admin = createAdminClient() as any

  let members = admin.from('pilot_member').select('member_id, name, auth_user_id').eq('is_synthetic', false).not('auth_user_id', 'is', null)
  if (q.get('member')) members = members.eq('member_id', q.get('member'))
  const { data: rows, error } = await members
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const report: Record<string, unknown>[] = []
  let sent = 0
  for (const m of (rows ?? []) as { member_id: string; name: string | null; auth_user_id: string }[]) {
    const entry: Record<string, unknown> = { member: m.name ?? m.member_id }
    report.push(entry)
    try {
      // 1. The picks. Monday makes the week's; Thursday only fills events that have none.
      if (!dry) {
        let eventIds: string[] | undefined
        if (mode === 'notify') {
          const have = await eventsWithPicks(m.member_id, { includeHeld: true, admin })
          eventIds = have.filter((e) => !e.picks.length).map((e) => e.event_id)
        }
        if (mode === 'compose' || eventIds?.length) {
          const composed = await composeEventPicks(m.member_id, { perEvent, hold, force, admin, eventIds })
          entry.composed = composed.events.map((e) => ({ event: e.label, brief: e.brief, reading: e.reading, candidates: e.candidates, picked: e.picked, tried: e.tried, skipped: e.skipped }))
          if (composed.error) entry.error = composed.error
        }
      } else {
        const have = await eventsWithPicks(m.member_id, { includeHeld: true, admin })
        entry.events = have.map((e) => ({ event: e.label, date: e.event_date, brief: e.brief, reading: e.reading, picks: e.picks.length }))
      }

      // 2. The note: the picks she has not been told about, shown ones only —
      //    unless the note is going to Chloe, who sees held picks too.
      const all = await eventsWithPicks(m.member_id, { includeHeld: !!toOverride || preview, admin })
      const fresh = all.map((e) => ({ ...e, picks: e.picks.filter((p) => !p.told_at) })).filter((e) => e.picks.length)
      entry.untold = fresh.reduce((n, e) => n + e.picks.length, 0)
      if (!fresh.length) { entry.sent = false; continue }
      const firstName = (m.name ?? '').trim().split(/\s+/)[0] ?? ''
      const html = noteHtml(firstName, fresh, site)
      if (preview) return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      if (dry) { entry.sent = false; entry.subject = subjectFor(fresh); continue }

      let email: string | null = toOverride
      if (!email) { try { email = (await admin.auth.admin.getUserById(m.auth_user_id)).data?.user?.email ?? null } catch { /* no address, no note */ } }
      if (!email) { entry.sent = false; entry.email = 'none'; continue }
      const res = await sendStudioEmail({
        kind: 'shopper_event_picks', subject: subjectFor(fresh), html, to: email,
        meta: { memberId: m.member_id, picks: entry.untold, mode, trial: !!toOverride || hold, site: site ?? null },
      })
      entry.sent = res.sent
      if (res.error) entry.error = res.error
      if (res.sent) sent++
      // A note to Chloe is a trial: she has not been told, nothing is marked.
      if (res.sent && !toOverride) {
        await markPicksTold(admin, fresh.flatMap((e) => e.picks.map((p) => p.event_pick_id)))
        const total = entry.untold as number
        const body = fresh.length === 1
          ? `MYRA found ${total === 1 ? 'an option' : `${total} options`} for your ${fresh[0].label.trim()}.`
          : `MYRA found ${total} new options for your events.`
        await admin.from('pilot_notification').insert({ member_id: m.member_id, kind: 'event_picks', body, look_ids: [] })
      }
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err)
    }
  }
  if (preview) return new NextResponse('<p style="font-family:Helvetica,Arial,sans-serif">No new options to show for this member.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  return NextResponse.json({ mode, members: (rows ?? []).length, dry, hold, sent, report })
}
