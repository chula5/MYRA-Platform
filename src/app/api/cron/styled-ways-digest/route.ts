// WAYS TO WEAR IT — the morning note (Vercel cron, 08:00 UTC on sweep days;
// see vercel.json — same */3 days as /api/cron/styled-ways-nightly at 02:00).
//
// Chloe asked (2026-10-11) for a notification on the sweep day: "styled looks
// overnight". One email per member, only when the sweep actually styled
// something new for her: the pieces, as pictures, each opening its ways in
// her Dressing Room. Nothing styled → nothing sent. Silence reads as taste.
//
//     curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/styled-ways-digest
//
//   ?dry=1      build everything, send nothing, return what would go
//   ?hours=48   look further back than the default 24h (a missed morning)
//   ?sample=1   an example: Chloe's own member (or ?member=<id>), built from the
//               pieces that already have ways, whatever styled them
//   ?to=a@b.c   send the sample to this address instead of the member's own
//   ?preview=1  return the sample as HTML to look at, send nothing
//   ?heroes=<id,id>  sample only: just these pieces
//   ?site=http://localhost:3000   sample only: links open here instead of the live
//               site (pictures stay on the live site, an inbox cannot reach localhost)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendStudioEmail, emailShell, emailButton, siteUrl } from '@/lib/studio/email'
import { WAYS } from '@/lib/styled-ways-core'
import { thumbUrl } from '@/lib/image-utils'
import { keepEmailedLooks, forgetEmailedLooks, type EmailedWay, type KeptEmail } from '@/lib/emailed-looks'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_PIECES_SHOWN = 6

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

/** `outfits` are exactly the outfits this email shows for the piece — the ones kept as her looks when it goes. */
interface StyledPiece { item_id: string; name: string; brand: string | null; image_url: string | null; ways: number; saved: boolean; outfits: EmailedWay[] }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const root = (base?: string) => (base ? base.replace(/\/$/, '') : siteUrl(''))
/**
 * Where a piece's outfits open for her. Kept as her looks (a real send): the
 * outfits this email showed, in Looks — never a fresh styling. Not kept (a
 * dry run, a sample to someone else): the piece's own ways page, as before.
 */
const linkFor = (p: StyledPiece, base?: string, kept?: KeptEmail | null) => kept
  ? `${root(base)}/me/looks?emailed=${encodeURIComponent(kept.deliveryId)}&piece=${encodeURIComponent(p.item_id)}`
  : `${root(base)}/me/ways/${encodeURIComponent(p.item_id)}`
const lookLink = (lookId: string, base?: string) => `${root(base)}/me/looks?look=${encodeURIComponent(lookId)}`
const saveLink = (lookId: string, base?: string) => `${root(base)}/me/looks/save/${encodeURIComponent(lookId)}`
/** The picture through the site's own image route, sized for email — a retailer's CDN may refuse a hotlink; ours does not. */
const pictureFor = (url: string) => { const t = thumbUrl(url, 256); return t.startsWith('/') ? siteUrl(t) : t }

/** The pieces the sweep styled for one member since `since`, with how many ways each now has. */
async function styledOvernight(admin: any, memberId: string, since: string, sample = false, only?: string[]): Promise<StyledPiece[]> {
  let heroes: string[]
  if (sample && only?.length) {
    heroes = only
  } else if (sample) {
    // An example: whatever already has ways for her, newest first.
    const { data: ways } = await admin.from('styled_way').select('hero_item_id, judged_at')
      .eq('member_id', memberId).eq('stale', false).order('judged_at', { ascending: false }).limit(60)
    heroes = Array.from(new Set(((ways ?? []) as any[]).map((w) => w.hero_item_id as string))).slice(0, MAX_PIECES_SHOWN + 2)
  } else {
    const { data: jobs } = await admin.from('styled_way_job').select('hero_item_id, mode')
      .eq('member_id', memberId).eq('reason', 'nightly').eq('status', 'done').gt('passed', 0).gte('finished_at', since)
    heroes = Array.from(new Set(((jobs ?? []) as any[]).map((j) => j.hero_item_id as string)))
  }
  if (!heroes.length) return []
  const [{ data: items }, { data: ways }, { data: saved }] = await Promise.all([
    admin.from('item').select('item_id, product_name, image_url, status, brand:brand_id(name)').in('item_id', heroes).neq('status', 'archived'),
    admin.from('styled_way').select('styled_way_id, hero_item_id, items, why, image_url, judged_at').eq('member_id', memberId).eq('stale', false).in('hero_item_id', heroes).order('judged_at', { ascending: false }),
    admin.from('member_saved_item').select('item_id').eq('member_id', memberId).in('item_id', heroes),
  ])
  // Per piece, the outfits the email will show: pictured ones first (the
  // email draws them), then the newest.
  const byHero = new Map<string, EmailedWay[]>()
  for (const w of (ways ?? []) as any[]) {
    byHero.set(w.hero_item_id, [...(byHero.get(w.hero_item_id) ?? []), {
      styled_way_id: w.styled_way_id, hero_item_id: w.hero_item_id, items: w.items ?? [], why: w.why ?? null, image_url: w.image_url ?? null,
    }])
  }
  const pick = (list: EmailedWay[]) => [...list].sort((a, b) => Number(!!b.image_url) - Number(!!a.image_url)).slice(0, WAYS)
  const savedIds = new Set(((saved ?? []) as any[]).map((s) => s.item_id))
  return ((items ?? []) as any[])
    .map((i) => ({
      item_id: i.item_id, name: i.product_name, brand: i.brand?.name ?? null, image_url: i.image_url ?? null,
      ways: Math.min(WAYS, byHero.get(i.item_id)?.length ?? 0), saved: savedIds.has(i.item_id), outfits: pick(byHero.get(i.item_id) ?? []),
    }))
    // Only pieces with all three ways kept: a link in the note opens on outfits, never on a wait (Chloe, 2026-10-11).
    .filter((p) => p.ways >= WAYS)
    .sort((a, b) => Number(b.saved) - Number(a.saved))
}

function digestHtml(firstName: string, pieces: StyledPiece[], base?: string, kept?: KeptEmail | null): string {
  const shown = pieces.slice(0, MAX_PIECES_SHOWN)
  const home = kept ? `${root(base)}/me/looks?emailed=${encodeURIComponent(kept.deliveryId)}` : `${root(base)}/me`
  // One block per piece: the piece, then MYRA's pictures of its outfits where
  // they have been made (three across), else the piece alone.
  const rows = shown.map((p) => {
    const link = linkFor(p, base, kept)
    // Each picture opens that outfit in her Looks, and SAVE under it keeps it
    // (Chloe, 2026-10-20: "allow me to save an image from the email").
    const pictured = p.outfits.filter((o) => o.image_url)
    const outfits = pictured.length
      ? `<tr><td colspan="2" style="padding:0 0 10px 0;"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${pictured.map((o) => {
          const lookId = kept?.lookByWay.get(o.styled_way_id)
          const open = lookId ? lookLink(lookId, base) : link
          const save = lookId
            ? `<a href="${saveLink(lookId, base)}" style="display:block;margin:7px 0 0 0;font-size:12px;letter-spacing:0.12em;color:#2b2b2b;text-decoration:underline;text-align:center;">SAVE</a>`
            : ''
          return `<td style="padding:0 6px 0 0;vertical-align:top;"><a href="${open}"><img src="${pictureFor(o.image_url as string)}" width="160" style="display:block;width:160px;height:auto;border-radius:8px;border:1px solid #e2e0db;" alt="" /></a>${save}</td>`
        }).join('')}</tr></table></td></tr>`
      : ''
    return `
    <tr>
      <td style="padding:14px 12px 8px 0;vertical-align:top;width:64px;">
        <a href="${link}">${p.image_url
          ? `<img src="${pictureFor(p.image_url)}" width="64" style="display:block;width:64px;height:auto;border-radius:6px;border:1px solid #e2e0db;" alt="${esc(p.name)}" />`
          : '<div style="width:64px;height:85px;background:#ededed;border-radius:6px;"></div>'}</a>
      </td>
      <td style="padding:14px 0 8px 0;vertical-align:middle;">
        ${p.brand ? `<p style="margin:0 0 2px 0;font-size:11px;letter-spacing:0.12em;color:#7c838b;">${esc(p.brand.toUpperCase())}</p>` : ''}
        <p style="margin:0 0 6px 0;font-size:15px;color:#2b2b2b;">${esc(p.name)}</p>
        <a href="${link}" style="font-size:12px;letter-spacing:0.08em;color:#2b2b2b;text-decoration:underline;">${p.ways} WAYS TO WEAR IT</a>
      </td>
    </tr>${outfits}`
  }).join('')
  const more = pieces.length > shown.length ? `<p style="margin:8px 0 0 0;font-size:12px;color:#7c838b;">and ${pieces.length - shown.length} more in your Dressing Room.</p>` : ''
  const body = `
    <p style="margin:0 0 14px 0;font-size:15px;color:#2b2b2b;">${esc(firstName ? `${firstName}, ` : '')}while you slept MYRA styled ${pieces.length === 1 ? 'one of your pieces' : `${pieces.length} of your pieces`} — three outfits each, every one checked in your size before you see it.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">${rows}</table>
    ${more}
    <p style="margin:22px 0 0 0;">${emailButton(home, 'SEE THEM')}</p>`
  return emailShell('STYLED OVERNIGHT', body, 'MYRA · YOUR STYLIST')
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  const q = req.nextUrl.searchParams
  const dry = q.get('dry') === '1'
  const sample = q.get('sample') === '1' || q.get('preview') === '1'
  const preview = q.get('preview') === '1'
  const toOverride = q.get('to')
  const base = sample && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(q.get('site') ?? '') ? q.get('site')! : undefined
  const only = sample ? (q.get('heroes') ?? '').split(',').map((s) => s.trim()).filter(Boolean) : []
  const hours = Math.max(1, Math.min(96, Number(q.get('hours') ?? 24) || 24))
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()
  const admin = createAdminClient() as any

  let members = admin.from('pilot_member').select('member_id, name, auth_user_id').eq('is_synthetic', false).not('auth_user_id', 'is', null)
  if (sample) {
    // The example goes to one person: the member named, else Chloe's own.
    const memberId = q.get('member')
    members = memberId ? members.eq('member_id', memberId) : members.eq('auth_user_id', process.env.ADMIN_USER_ID ?? '')
  }
  const { data: rows, error } = await members
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const report: Record<string, unknown>[] = []
  let sent = 0
  for (const m of (rows ?? []) as { member_id: string; name: string | null; auth_user_id: string }[]) {
    const pieces = await styledOvernight(admin, m.member_id, since, sample, only)
    if (!pieces.length) { report.push({ member: m.name ?? m.member_id, pieces: 0, sent: false }); continue }
    const firstName = (m.name ?? '').trim().split(/\s+/)[0] ?? ''
    if (preview) return new NextResponse(digestHtml(firstName, pieces, base), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    let email: string | null = toOverride
    if (!email) { try { email = (await admin.auth.admin.getUserById(m.auth_user_id)).data?.user?.email ?? null } catch { /* no address, no note */ } }
    const subject = pieces.length === 1
      ? `MYRA styled your ${pieces[0].name} overnight`
      : `MYRA styled ${pieces.length} of your pieces overnight`
    if (dry || !email) {
      report.push({ member: m.name ?? m.member_id, pieces: pieces.length, sent: false, email: email ? 'found' : 'none', subject, items: pieces.map((p) => `${p.brand ?? ''} ${p.name} ×${p.ways}${p.saved ? ' (saved)' : ''}`.trim()) })
      continue
    }
    // What this email shows becomes her looks first, so every link in it opens
    // those outfits — never a fresh styling. Only for her own inbox: a sample
    // sent to another address keeps nothing.
    const kept = toOverride ? null : await keepEmailedLooks(admin, m.member_id,
      `Styled overnight · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })}`,
      pieces.slice(0, MAX_PIECES_SHOWN).flatMap((p) => p.outfits))
    const res = await sendStudioEmail({
      kind: 'shopper_ways_digest',
      subject,
      html: digestHtml(firstName, pieces, base, kept),
      to: email,
      meta: { memberId: m.member_id, pieces: pieces.length, hours, sample, site: base ?? null, deliveryId: kept?.deliveryId ?? null },
    })
    if (res.sent) sent++
    else if (kept) await forgetEmailedLooks(admin, kept.deliveryId)
    report.push({ member: m.name ?? m.member_id, pieces: pieces.length, sent: res.sent, error: res.error })
  }
  if (preview) return new NextResponse('<p style="font-family:Helvetica,Arial,sans-serif">Nothing styled yet for this member — no example to show.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  return NextResponse.json({ members: (rows ?? []).length, since, dry, sample, sent, report })
}
