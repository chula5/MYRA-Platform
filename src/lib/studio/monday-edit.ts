// YOUR MONDAY EDIT — the weekly email (Monday 08:00 UTC; see vercel.json and
// api/cron/monday-edit).
//
// Chloe asked (2026-11-15): members should receive, on a Monday, the pieces
// and outfits styled on their preferences, and early Black Friday finds at the
// brands they like, with the original price and the sale price.
//
// One email per member, three parts, each left out when she has nothing in it:
//
//   1. STYLED FOR YOU THIS WEEK  — the looks that landed in her Looks in the
//      last seven days (From the studio, her asks, inspiration), drawn as the
//      pieces, or as MYRA's picture where one was made. Opens the look.
//   2. NEW AT YOUR BRANDS        — the week's new pieces from her named
//      brands, in her size (lib/new-in, the same set as the Monday push).
//   3. EARLY BLACK FRIDAY        — what is marked down at the brands in her
//      taste graph, in her size and under her ceiling (lib/sales/picks), each
//      with WAS and NOW. Outside the Black Friday weeks the heading is plainer.
//
// Drawn in the member layout Chloe approved for the Black Friday note
// (memberCardShell): the grey page, the white card, the logo top left, and
// the pieces in thumbnail rows like the styled-overnight note.
// Nothing in any part → nothing sent. Silence reads as taste.

import 'server-only'
import { memberCardShell, siteUrl } from './email'
import { greetingName } from './black-friday-email'
import { thumbUrl } from '@/lib/image-utils'
import { newInForMember, newInPath, type NewInMember } from '@/lib/new-in'
import { salePicksFor, type SalePiece, type SaleBrand } from '@/lib/sales/picks'
import { loadMemberReach, whyNotHers, type MemberReach } from '@/lib/member-style-gate'
import { inBlackFriday } from '@/lib/sales/detect'
import { EMAILED_PREFIX } from '@/lib/emailed-looks'

export const LOOKS_SHOWN = 4
export const NEW_IN_SHOWN = 6
export const SALE_SHOWN = 6
const PIECES_PER_LOOK = 4
const WEEK_MS = 7 * 24 * 3600_000

export interface MondayMember extends NewInMember { name: string | null; auth_user_id: string | null }

export interface EditPiece { item_id: string | null; brand: string | null; name: string; image_url: string | null; price_gbp: number | null }
export interface EditLook { look_id: string; label: string; image_url: string | null; pieces: EditPiece[] }
export interface EditNewIn { item_id: string; brand: string | null; name: string; image_url: string | null; price_gbp: number | null }

export interface MondayEdit {
  looks: EditLook[]
  newIn: { since: string; total: number; brands: string[]; pieces: EditNewIn[] }
  sale: { brands: SaleBrand[]; total: number; pieces: SalePiece[] }
}

export const isEmpty = (e: MondayEdit) => !e.looks.length && !e.newIn.pieces.length && !e.sale.pieces.length

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const gbp = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n))) ? '' : `£${Math.round(Number(n)).toLocaleString('en-GB')}`

/** The picture through the site's own image route, sized for email — a retailer's CDN may refuse a hotlink; ours does not. */
const pictureFor = (url: string, width = 384) => { const t = thumbUrl(url, width); return t.startsWith('/') ? siteUrl(t) : t }

/** A brand's homeware slips into a fashion feed now and then; the email is for what she wears. */
const HOMEWARE = /\b(quilt|cushion|throw|blanket|duvet|bedding|pillow|candle|diffuser|vase|bowl|plate|mug|cup|teapot|jug|tray|towel|tablecloth|napkin|placemat|ornament|bauble|decoration|wreath|notebook|calendar|wrapping|gift card|voucher)\b/i
const isHomeware = (name: string | null | undefined) => HOMEWARE.test(String(name ?? ''))

/** Round-robin by key, keeping each key's own order: three brands take turns rather than one brand filling the grid. */
function takeTurns<T>(list: T[], key: (x: T) => string): T[] {
  const queues = new Map<string, T[]>()
  for (const x of list) { const k = key(x); queues.set(k, [...(queues.get(k) ?? []), x]) }
  const qs = Array.from(queues.values())
  const out: T[] = []
  for (let round = 0; out.length < list.length; round++) for (const q of qs) if (q[round]) out.push(q[round])
  return out
}

// ── Gathering ────────────────────────────────────────────────────────────────

/**
 * Looks that landed in her Looks this week, newest first, pictured ones
 * first. Never the ones an email already showed her, and never a look with a
 * piece outside her reach (lib/member-style-gate) — a look landed before her
 * age or her bands were known is not re-judged in her Looks, so the email
 * judges it here (Anne, 60, 2026-11-15: a Reformation slip dress).
 */
async function looksThisWeek(admin: any, memberId: string, since: string, reach?: MemberReach): Promise<EditLook[]> {
  const { data: deliveries } = await admin.from('pilot_delivery')
    .select('delivery_id, request_text, sent_at').eq('member_id', memberId).gte('sent_at', since)
    .not('request_text', 'ilike', `${EMAILED_PREFIX}%`)
  const ids = ((deliveries ?? []) as any[]).map((d) => d.delivery_id)
  if (!ids.length) return []
  const labelOf = new Map(((deliveries ?? []) as any[]).map((d) => [d.delivery_id, String(d.request_text ?? '')]))
  const { data: looks } = await admin.from('pilot_look')
    .select('look_id, delivery_id, items, image_url, response, created_at')
    .in('delivery_id', ids).eq('visible_to_client', true).order('created_at', { ascending: false }).limit(40)
  // Pictured looks first; then never two looks on the same hero piece, nor
  // two that share most of their pieces (the studio keeps variants of a look;
  // the email shows one of each).
  const everyId = [...new Set(((looks ?? []) as any[]).flatMap((l) => ((l.items ?? []) as any[]).map((i) => i?.item_id).filter(Boolean) as string[]))]
  const rows = new Map<string, any>()
  if (everyId.length) {
    const { data: items } = await admin.from('item').select('item_id, item_type, colour_family, product_name, price_gbp, brand_id, image_url, fit, length, rise, structure, shoulder, neckline, sleeve, waist_definition, leg_opening, pattern').in('item_id', everyId)
    for (const it of (items ?? []) as any[]) rows.set(it.item_id, it)
  }
  const outOfReach = (l: any) => !!reach && ((l.items ?? []) as any[]).some((i) => { const it = i?.item_id ? rows.get(i.item_id) : null; return it && whyNotHers(reach, it, { budget: false }) != null })
  const candidates = ((looks ?? []) as any[]).filter((l) => l.response !== 'no' && Array.isArray(l.items) && l.items.length >= 2 && !outOfReach(l))
    .sort((a, b) => Number(!!b.image_url) - Number(!!a.image_url))
  const keyOf = (i: any) => String(i.item_id ?? `${i.brand}|${i.product_name}`)
  const kept: any[] = []
  const heroes = new Set<string>()
  for (const l of candidates) {
    const ids = (l.items as any[]).map(keyOf)
    const overlap = kept.some((k) => { const ks = new Set((k.items as any[]).map(keyOf)); return ids.filter((id) => ks.has(id)).length >= 2 })
    if (heroes.has(ids[0]) || overlap) continue
    heroes.add(ids[0])
    kept.push(l)
    if (kept.length >= LOOKS_SHOWN) break
  }

  // Older look rows may carry pieces without pictures; the item table has them.
  const pictures = new Map<string, { image_url: string | null; price_gbp: number | null }>()
  for (const [id, it] of rows) pictures.set(id, { image_url: it.image_url ?? null, price_gbp: it.price_gbp ?? null })
  const prettyLabel = (raw: string) => {
    if (/^From the studio/i.test(raw)) return 'From the studio'
    if (/^Inspiration/i.test(raw)) return 'From your inspiration'
    return raw.length > 48 ? `${raw.slice(0, 46).trim()}…` : raw
  }
  return kept.map((l) => ({
    look_id: l.look_id,
    label: prettyLabel(labelOf.get(l.delivery_id) ?? ''),
    image_url: l.image_url ?? null,
    pieces: (l.items as any[]).slice(0, PIECES_PER_LOOK).map((i) => ({
      item_id: i.item_id ?? null, brand: i.brand ?? null, name: i.product_name ?? 'Piece',
      image_url: i.image_url ?? pictures.get(i.item_id)?.image_url ?? null,
      price_gbp: i.price_gbp ?? pictures.get(i.item_id)?.price_gbp ?? null,
    })),
  }))
}

export async function gatherMondayEdit(admin: any, m: MondayMember): Promise<MondayEdit> {
  const since = new Date(Date.now() - WEEK_MS).toISOString()
  const [looks, fresh, sale] = await Promise.all([
    loadMemberReach(admin, m.member_id).then((reach) => looksThisWeek(admin, m.member_id, since, reach)).catch(() => [] as EditLook[]),
    newInForMember(admin, m, since).catch(() => ({ since, brands: [], items: [] as any[] })),
    salePicksFor(admin, m.member_id, { limit: 500 }).catch(() => ({ brands: [] as SaleBrand[], pieces: [] as SalePiece[], gaps: [] })),
  ])
  const newPieces = takeTurns(fresh.items.filter((it: any) => !isHomeware(it.product_name)), (it: any) => String(it.brand_id)).slice(0, NEW_IN_SHOWN).map((it: any) => ({
    item_id: it.item_id, brand: it.brand?.name ?? null, name: it.product_name ?? 'Piece', image_url: it.image_url ?? null, price_gbp: it.price_gbp ?? null,
  }))
  return {
    looks,
    newIn: { since: fresh.since, total: fresh.items.length, brands: fresh.brands.map((b) => b.name), pieces: newPieces },
    sale: { brands: sale.brands, total: sale.pieces.length, pieces: sale.pieces.filter((p) => !isHomeware(p.product_name)).slice(0, SALE_SHOWN) },
  }
}

// ── Words ────────────────────────────────────────────────────────────────────

const listOf = (parts: string[]) => parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`

export function mondaySubject(e: MondayEdit): string {
  const parts: string[] = []
  if (e.looks.length) parts.push(e.looks.length === 1 ? 'a look styled for you' : `${e.looks.length} looks styled for you`)
  if (e.newIn.pieces.length) parts.push(`${e.newIn.total} new in your size`)
  if (e.sale.pieces.length) parts.push(inBlackFriday() ? 'early Black Friday at your brands' : 'sale at your brands')
  return `Your Monday edit: ${listOf(parts)}`
}

// ── Drawing (email-client-safe: tables + inline styles; the styled-overnight format) ──
//
// Chloe, 15 Nov 2026: "a bit like this format" — the overnight note: a 64px
// thumbnail at left, the brand in small tracked caps, the name, and an
// underlined tracked link under it. Sections open with a small grey caps
// heading over a hairline.

const FONT = 'font-family:Helvetica,Arial,sans-serif;'
const p = (t: string, extra = '') => `<p style="margin:0 0 14px 0;${FONT}font-size:15px;line-height:1.6;color:#2b2b2b;${extra}">${t}</p>`
const h = (t: string) => `<p style="margin:30px 0 6px 0;padding:16px 0 0 0;border-top:1px solid #ededeb;${FONT}font-size:11px;letter-spacing:0.14em;line-height:1.4;color:#7c838b;text-transform:uppercase;">${t}</p>`
const b = (t: string) => `<strong style="color:#0a0a0a;">${t}</strong>`
const caps = (t: string) => `<p style="margin:0 0 2px 0;${FONT}font-size:11px;letter-spacing:0.12em;color:#7c838b;text-transform:uppercase;">${esc(t)}</p>`
const link = (href: string, label: string, extra = '') => `<a href="${href}" style="${FONT}font-size:12px;letter-spacing:0.08em;color:#2b2b2b;text-decoration:underline;${extra}">${label}</a>`
const sectionLink = (href: string, label: string) => `<p style="margin:10px 0 0 0;">${link(href, label)}</p>`
const pieceLink = (itemId: string | null, base: string) => itemId ? `${base}/me/dressing-room/${encodeURIComponent(itemId)}` : `${base}/me`

function thumb(src: string | null, href: string, width: number, alt = '', radius = 6): string {
  const img = src
    ? `<img src="${pictureFor(src, width * 2)}" width="${width}" style="display:block;width:${width}px;height:auto;border-radius:${radius}px;border:1px solid #e2e0db;background:#f6f5f2;" alt="${esc(alt)}" />`
    : `<div style="width:${width}px;height:${Math.round(width * 1.25)}px;background:#f2f2f2;border-radius:${radius}px;"></div>`
  return `<a href="${href}" style="text-decoration:none;">${img}</a>`
}

/** One piece per row: thumbnail at left, brand / name / price / link at right. */
function pieceRow(c: { href: string; image_url: string | null; brand: string | null; name: string; priceHtml: string; note?: string | null; action: string }): string {
  return `
    <tr>
      <td style="padding:12px 12px 6px 0;vertical-align:top;width:64px;">${thumb(c.image_url, c.href, 64, c.name)}</td>
      <td style="padding:12px 0 6px 0;vertical-align:middle;">
        ${c.brand ? caps(c.brand) : ''}
        <a href="${c.href}" style="display:block;margin:0 0 3px 0;${FONT}font-size:15px;line-height:1.4;color:#2b2b2b;text-decoration:none;">${esc(c.name)}</a>
        ${c.priceHtml}
        ${c.note ? `<p style="margin:3px 0 0 0;${FONT}font-size:11px;letter-spacing:0.1em;color:#7c838b;">${esc(c.note)}</p>` : ''}
        <p style="margin:5px 0 0 0;">${link(c.href, c.action)}</p>
      </td>
    </tr>`
}

function rows(cells: Parameters<typeof pieceRow>[0][]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">${cells.map(pieceRow).join('')}</table>`
}

function lookBlock(l: EditLook, base: string): string {
  const href = `${base}/me/looks?look=${encodeURIComponent(l.look_id)}`
  const total = l.pieces.reduce((n, p) => n + (Number(p.price_gbp) || 0), 0)
  const names = l.pieces.map((p) => `<p style="margin:0 0 5px 0;${FONT}font-size:14px;line-height:1.4;color:#2b2b2b;">${p.brand ? `<span style="font-size:11px;letter-spacing:0.12em;color:#7c838b;">${esc(p.brand.toUpperCase())}</span> &nbsp;` : ''}${esc(p.name)}</p>`).join('')
  const totalLine = total ? `<p style="margin:6px 0 0 0;${FONT}font-size:13px;color:#7c838b;">The look, ${gbp(total)}</p>` : ''
  const open = `<p style="margin:6px 0 0 0;">${link(href, 'SEE THE LOOK')}</p>`
  if (l.image_url) {
    // MYRA's picture of the outfit at left, like the overnight note's pieces, only larger.
    return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
      <tr>
        <td style="padding:12px 14px 6px 0;vertical-align:top;width:128px;">${thumb(l.image_url, href, 128, 'The look', 8)}</td>
        <td style="padding:12px 0 6px 0;vertical-align:middle;">${caps(l.label)}<div style="height:4px;"></div>${names}${totalLine}${open}</td>
      </tr>
    </table>`
  }
  // No picture yet: the pieces as a strip of thumbnails, the names under.
  const strip = l.pieces.map((p) => `<td style="padding:0 6px 0 0;vertical-align:top;">${thumb(p.image_url, pieceLink(p.item_id, base), 64, p.name)}</td>`).join('')
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
      <tr><td style="padding:12px 0 0 0;">${caps(l.label)}</td></tr>
      <tr><td style="padding:6px 0 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${strip}</tr></table></td></tr>
      <tr><td style="padding:8px 0 6px 0;">${names}${totalLine}${open}</td></tr>
    </table>`
}

const price = (n: number) => `<p style="margin:0;${FONT}font-size:14px;color:#2b2b2b;">${gbp(n)}</p>`

function salePriceHtml(sp: SalePiece): string {
  return `<p style="margin:0;${FONT}font-size:14px;color:#2b2b2b;">
    <span style="color:#a8a8a4;text-decoration:line-through;">${gbp(sp.was_price_gbp)}</span>
    &nbsp;${b(gbp(sp.price_gbp))}
    &nbsp;<span style="font-size:11px;letter-spacing:0.08em;color:#7c838b;">${sp.off}% OFF</span></p>`
}

export function mondayEditHtml(member: MondayMember, e: MondayEdit, site?: string): string {
  const base = (site ?? siteUrl('')).replace(/\/$/, '')
  const first = greetingName(member.name)
  const blackFriday = inBlackFriday()
  const parts: string[] = []

  const intro = listOf([
    e.looks.length ? 'what MYRA styled for you this week' : '',
    e.newIn.pieces.length ? 'what&rsquo;s new at your brands' : '',
    e.sale.pieces.length ? (blackFriday ? 'the early Black Friday prices worth knowing about' : 'what&rsquo;s on sale at your brands') : '',
  ].filter(Boolean))
  parts.push(p(`${first ? `${esc(first)}, here` : 'Here'} is your Monday edit: ${intro}. Everything in it is ${b('in your size')} and ${b('within your budget')}, from the brands you told MYRA you love.`))

  if (e.looks.length) {
    parts.push(h('Styled for you this week'))
    parts.push(...e.looks.map((l) => lookBlock(l, base)))
    parts.push(sectionLink(`${base}/me/looks`, 'SEE ALL YOUR LOOKS'))
  }

  if (e.newIn.pieces.length) {
    const named = e.newIn.brands.slice(0, 3).map(esc).join(', ')
    const more = e.newIn.brands.length > 3 ? ` and ${e.newIn.brands.length - 3} more of your brands` : ''
    parts.push(h('New at your brands'))
    parts.push(p(`${b(`${e.newIn.total} new ${e.newIn.total === 1 ? 'piece' : 'pieces'}`)} in your size this week, from ${named}${more}. A few to start with:`, 'margin:8px 0 0 0;'))
    parts.push(rows(e.newIn.pieces.map((np) => ({
      href: pieceLink(np.item_id, base), image_url: np.image_url, brand: np.brand, name: np.name,
      priceHtml: np.price_gbp != null ? price(np.price_gbp) : '', action: 'SEE IT',
    }))))
    parts.push(sectionLink(`${base}${newInPath(e.newIn.since)}`, `SEE ALL ${e.newIn.total} NEW IN`))
  }

  if (e.sale.pieces.length) {
    const lines = e.sale.brands.slice(0, 4).map((sb) => `${b(esc(sb.name))} ${esc(sb.line.toLowerCase())}`)
    const more = e.sale.brands.length > 4 ? `, and ${e.sale.brands.length - 4} more of your brands` : ''
    parts.push(h(blackFriday ? 'Early Black Friday, at your brands' : 'On sale at your brands'))
    parts.push(p(`${blackFriday ? 'The sales have started early. ' : ''}On sale now: ${lines.join(' &middot; ')}${more}.`, 'margin:8px 0 10px 0;'))
    const count = e.sale.total >= 500 ? 'More than 500 pieces' : `${e.sale.total} ${e.sale.total === 1 ? 'piece' : 'pieces'}`
    parts.push(p(`${b(count)} in your size, under your budget at the sale price. The ones to see first:`, 'margin:0;'))
    parts.push(rows(e.sale.pieces.map((sp) => ({
      href: pieceLink(sp.item_id, base), image_url: sp.image_url, brand: sp.brand, name: sp.product_name,
      priceHtml: salePriceHtml(sp), note: sp.reason, action: 'SEE IT',
    }))))
    parts.push(sectionLink(`${base}/me?door=sale`, blackFriday ? 'SEE YOUR BLACK FRIDAY EDIT' : 'SEE YOUR SALE'))
    if (blackFriday) parts.push(p(`Eyeing something that isn&rsquo;t reduced yet? Save it, then tap ${b('WAIT FOR SALE')} under it in your Dressing Room. MYRA watches the price and tells you the moment it drops.`, 'margin:22px 0 0 0;'))
  }

  parts.push(p('Reply to this email and it comes straight to Chloe.', 'margin:26px 0 0 0;color:#7c838b;font-size:13px;'))
  return memberCardShell('Your Monday edit', parts.join('\n'))
}
