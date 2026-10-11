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
//   ?site=http://localhost:3000   sample only: links open here instead of the live
//               site (pictures stay on the live site, an inbox cannot reach localhost)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendStudioEmail, emailShell, emailButton, siteUrl } from '@/lib/studio/email'
import { WAYS } from '@/lib/styled-ways-core'
import { thumbUrl } from '@/lib/image-utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_PIECES_SHOWN = 6

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

interface StyledPiece { item_id: string; name: string; brand: string | null; image_url: string | null; ways: number; saved: boolean }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Where a piece's ways open for her: the piece's own ways page, the same sheet every surface uses. */
const linkFor = (p: StyledPiece, base?: string) => (base ? `${base.replace(/\/$/, '')}` : siteUrl('')) + `/me/ways/${encodeURIComponent(p.item_id)}`
/** The picture through the site's own image route, sized for email — a retailer's CDN may refuse a hotlink; ours does not. */
const pictureFor = (url: string) => { const t = thumbUrl(url, 256); return t.startsWith('/') ? siteUrl(t) : t }

/** The pieces the sweep styled for one member since `since`, with how many ways each now has. */
async function styledOvernight(admin: any, memberId: string, since: string, sample = false): Promise<StyledPiece[]> {
  let heroes: string[]
  if (sample) {
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
    admin.from('styled_way').select('hero_item_id').eq('member_id', memberId).eq('stale', false).in('hero_item_id', heroes),
    admin.from('member_saved_item').select('item_id').eq('member_id', memberId).in('item_id', heroes),
  ])
  const count = new Map<string, number>()
  for (const w of (ways ?? []) as any[]) count.set(w.hero_item_id, (count.get(w.hero_item_id) ?? 0) + 1)
  const savedIds = new Set(((saved ?? []) as any[]).map((s) => s.item_id))
  return ((items ?? []) as any[])
    .map((i) => ({ item_id: i.item_id, name: i.product_name, brand: i.brand?.name ?? null, image_url: i.image_url ?? null, ways: Math.min(WAYS, count.get(i.item_id) ?? 0), saved: savedIds.has(i.item_id) }))
    // Only pieces with all three ways kept: a link in the note opens on outfits, never on a wait (Chloe, 2026-10-11).
    .filter((p) => p.ways >= WAYS)
    .sort((a, b) => Number(b.saved) - Number(a.saved))
}

function digestHtml(firstName: string, pieces: StyledPiece[], base?: string): string {
  const shown = pieces.slice(0, MAX_PIECES_SHOWN)
  const home = base ? `${base.replace(/\/$/, '')}/me` : siteUrl('/me')
  const rows = shown.map((p) => `
    <tr>
      <td style="padding:8px 12px 8px 0;vertical-align:top;width:84px;">
        <a href="${linkFor(p, base)}">${p.image_url
          ? `<img src="${pictureFor(p.image_url)}" width="84" style="display:block;width:84px;height:auto;border-radius:6px;border:1px solid #e2e0db;" alt="${esc(p.name)}" />`
          : '<div style="width:84px;height:112px;background:#ededed;border-radius:6px;"></div>'}</a>
      </td>
      <td style="padding:8px 0;vertical-align:middle;">
        ${p.brand ? `<p style="margin:0 0 2px 0;font-size:11px;letter-spacing:0.12em;color:#7c838b;">${esc(p.brand.toUpperCase())}</p>` : ''}
        <p style="margin:0 0 6px 0;font-size:15px;color:#2b2b2b;">${esc(p.name)}</p>
        <a href="${linkFor(p, base)}" style="font-size:12px;letter-spacing:0.08em;color:#2b2b2b;text-decoration:underline;">${p.ways} WAYS TO WEAR IT</a>
      </td>
    </tr>`).join('')
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
    const pieces = await styledOvernight(admin, m.member_id, since, sample)
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
    const res = await sendStudioEmail({
      kind: 'shopper_ways_digest',
      subject,
      html: digestHtml(firstName, pieces, base),
      to: email,
      meta: { memberId: m.member_id, pieces: pieces.length, hours, sample, site: base ?? null },
    })
    if (res.sent) sent++
    report.push({ member: m.name ?? m.member_id, pieces: pieces.length, sent: res.sent, error: res.error })
  }
  if (preview) return new NextResponse('<p style="font-family:Helvetica,Arial,sans-serif">Nothing styled yet for this member — no example to show.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  return NextResponse.json({ members: (rows ?? []).length, since, dry, sample, sent, report })
}
