// WHAT SHE DID WITH IT — the JOURNEY tab's second half.
//
// client-journey.ts answers "did she come, for how long, which rooms". This
// answers the questions Chloe actually asks of a member's use of MYRA: which
// pieces and brands she opened, saved and clicked through to a retailer, what
// she searched for and asked, which emails brought her back, and whether she
// keeps coming back at all.
//
// Wherever a server-side record exists it is the source, not the tracker:
//   · click-throughs  click (0019) — written by /go/ and the beacon, so it
//                      counts every retailer click, tracker or not, and
//                      reaches back before the JOURNEY existed. (item_click
//                      went silent 2026-08-04 — a write that never sent.)
//                      A shop tap the tracker saw but the log never got (the
//                      app hands /go/ to Safari) still counts, once.
//   · saves           saved_item + member_saved_item — the saves themselves
//   · emails          email_log (sent) + email_click (0105, followed)
//   · opens, searches client_event — only the tracker sees these
//
// SERVER ONLY. The JOURNEY tab imports the shapes with `import type`.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { readSince, weekBuckets } from '@/lib/metrics-core'
import { lookSourceOf, SAVED_REQUEST_TEXT } from '@/lib/emailed-looks'
import { CLICK_SOURCE, type ClickSource } from '@/lib/journey'

export { CLICK_SOURCE, type ClickSource }

export interface UsageRow {
  key: string
  label: string
  brand: string | null
  value: number
  last: string
  /** Who, when the view is everyone. */
  who?: string[]
}

export interface UsageRank {
  label: string
  value: number
}

export interface UsageSearch {
  at: string
  text: string
  kind: 'search' | 'question'
  member: string
}

export interface UsageEmail {
  kind: string
  label: string
  sent: number
  clicks: number
  /** Clicks by mail scanners, kept apart so the rate is hers. */
  scannerClicks: number
  lastClick: string | null
}

export interface UsageClick {
  at: string
  key: string
  label: string
  source: ClickSource
  /** The thing that started it, in words: the email, the event, her search. */
  why: string
  member: string
}

export interface UsageSavedLook {
  lookId: string
  at: string
  label: string
  /** Where the look came from: sent by MYRA, asked for, emailed, saved from ways. */
  source: string
  member: string
}

export interface UsageCalendarEvent {
  at: string
  title: string
  occasion: string | null
  status: string
  /** Event options MYRA picked for it, and how many of those she clicked through. */
  picks: number
  pickClicks: number
  member: string
}

export interface RetentionMember {
  memberId: string
  name: string
  firstVisit: string | null
  lastVisit: string | null
  daysActive: number
  /** Visits in each of the last eight weeks, oldest first. */
  weeks: number[]
}

export interface JourneyUsage {
  days: number
  clickedPieces: UsageRow[]
  clickedBrands: UsageRank[]
  clickTotal: number
  /** Every click-through in the window with what started it, newest first. */
  clicks: UsageClick[]
  clickSources: { source: ClickSource; value: number }[]
  /** Click-throughs MYRA started unasked (email, event pick, a look she sent). */
  promptedTotal: number
  savedLooks: UsageSavedLook[]
  savedLookTotal: number
  savedPieceTotal: number
  searchTotal: number
  questionTotal: number
  calendar: {
    connections: { member: string; status: string; lastSynced: string | null }[]
    events: UsageCalendarEvent[]
    planned: number
  }
  openedPieces: UsageRow[]
  openedBrands: UsageRank[]
  openedLooks: UsageRow[]
  savedPieces: UsageRow[]
  savedBrands: UsageRank[]
  searches: UsageSearch[]
  emails: UsageEmail[]
  emailClicksRecent: { at: string; kind: string; label: string; target: string; member: string }[]
  retention: {
    withLogin: number
    everVisited: number
    active7: number
    active30: number
    cameBack: number
    weekLabels: string[]
    members: RetentionMember[]
  }
}

export const EMAIL_LABEL: Record<string, string> = {
  shopper_event_picks: 'EVENT PICKS · MONDAY',
  shopper_ways_digest: 'WAYS TO WEAR · MORNING NOTE',
  shopper_stock_urgent: 'STOCK ALERT · URGENT',
  shopper_stock_digest: 'STOCK ALERT · DIGEST',
  shopper_invitation: 'HER INVITATION',
  shopper_welcome: 'WELCOME',
}

interface Member { member_id: string; name: string; auth_user_id: string | null; email: string | null; invite_email: string | null }

interface Delivery {
  delivery_id: string
  member_id: string
  trigger: string | null
  request_text: string | null
  occasion: string | null
  created_at: string
  pilot_look: { look_id: string; response: string | null; responded_at: string | null; visible_to_client: boolean; published_at: string | null; items: any[] | null }[] | null
}

const DAY = 86_400_000

function bump(map: Map<string, UsageRow>, key: string, base: Omit<UsageRow, 'value' | 'last'>, at: string, who?: string) {
  const row = map.get(key)
  if (row) {
    row.value++
    if (at > row.last) row.last = at
    if (who && row.who && !row.who.includes(who)) row.who.push(who)
  } else {
    map.set(key, { ...base, value: 1, last: at, who: who ? [who] : [] })
  }
}

const top = (map: Map<string, UsageRow>, n = 20) =>
  Array.from(map.values()).sort((a, b) => b.value - a.value || b.last.localeCompare(a.last)).slice(0, n)

function brandsOf(rows: UsageRow[]): UsageRank[] {
  const m = new Map<string, number>()
  for (const r of rows) if (r.brand) m.set(r.brand.toUpperCase(), (m.get(r.brand.toUpperCase()) ?? 0) + r.value)
  return Array.from(m.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 12)
}

/** Piece names and brands for a set of item ids, in one paged read. */
async function itemNames(ids: string[]): Promise<Map<string, { name: string; brand: string | null }>> {
  const out = new Map<string, { name: string; brand: string | null }>()
  const unique = Array.from(new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id))))
  const admin = createAdminClient() as any
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await admin.from('item').select('item_id, product_name, brand(name)').in('item_id', unique.slice(i, i + 200))
    for (const r of (data ?? []) as any[]) {
      out.set(r.item_id, { name: r.product_name ?? 'A PIECE', brand: r.brand?.name ?? null })
    }
  }
  return out
}

const pieceLabel = (n: { name: string; brand: string | null } | undefined, fallback: string | null) =>
  n ? [n.brand, n.name].filter(Boolean).join(' — ') : (fallback || 'A PIECE NO LONGER IN THE LIBRARY')

/** A piece id from the path of the room she opened it in. */
function itemFromPath(path: string | null): string | null {
  const m = /^\/me\/(?:ways|dressing-room)\/([0-9a-f-]{36})/i.exec(path ?? '')
  return m ? m[1] : null
}

export async function loadJourneyUsage(opts: { memberId?: string | null; days?: number }): Promise<JourneyUsage> {
  const days = Math.min(120, Math.max(7, opts.days ?? 30))
  const memberId = opts.memberId || null
  const since = new Date(Date.now() - days * DAY)
  const admin = createAdminClient() as any
  const adminId = process.env.ADMIN_USER_ID ?? ''

  // Members, without the synthetic ones and without Chloe's own row: her own
  // clicks and saves are testing, not the pilot.
  const { data: memberRows } = await admin.from('pilot_member')
    .select('member_id, name, auth_user_id, email, invite_email, is_synthetic').order('name')
  const all = ((memberRows ?? []) as (Member & { is_synthetic: boolean })[])
    .filter((m) => !m.is_synthetic && m.auth_user_id !== adminId || (memberId && m.member_id === memberId))
  const members = memberId ? all.filter((m) => m.member_id === memberId) : all
  const ids = members.map((m) => m.member_id)
  const authIds = members.map((m) => m.auth_user_id).filter(Boolean) as string[]
  const nameById = new Map(members.map((m) => [m.member_id, m.name]))
  const nameByAuth = new Map(members.filter((m) => m.auth_user_id).map((m) => [m.auth_user_id as string, m.name]))

  const inMembers = (q: any) => q.in('member_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const inAuth = (q: any) => q.in('user_id', authIds.length ? authIds : ['00000000-0000-0000-0000-000000000000'])

  // What MYRA put in front of her reaches back further than the window: a look
  // sent three weeks ago can start a click-through today.
  const sentSince = new Date(since.getTime() - 90 * DAY)

  const [clicks, events, savedA, savedB, sent, emailClicks, sessionsAll, deliveries, picks, calendarEvents, calendarConns, knownEvents] = await Promise.all([
    readSince<{ item_id: string; user_id: string; clicked_at: string }>('click', 'created_at', since, 'item_id, user_id, clicked_at:created_at', { refine: (q) => inAuth(q).eq('is_bot', false) }),
    readSince<{ member_id: string; at: string; type: string; label: string | null; target_id: string | null; target_kind: string | null; path: string | null; meta: any }>(
      'client_event', 'at', since, 'member_id, at, type, label, target_id, target_kind, path, meta',
      { refine: (q) => inMembers(q).in('type', ['item_open', 'look_open', 'click_out', 'search', 'chat_send', 'page_view', 'room_open']) },
    ),
    readSince<{ user_id: string; item_id: string; created_at: string }>('saved_item', 'created_at', since, 'user_id, item_id, created_at', { refine: inAuth }),
    readSince<{ member_id: string; item_id: string; saved_at: string }>('member_saved_item', 'saved_at', since, 'member_id, item_id, saved_at', { refine: inMembers }),
    readSince<{ kind: string; meta: any; sent_at: string }>('email_log', 'sent_at', since, 'kind, meta, sent_at', { refine: (q) => q.like('kind', 'shopper_%') }),
    readSince<{ member_id: string; kind: string; target: string; at: string; is_bot: boolean }>('email_click', 'at', since, 'member_id, kind, target, at, is_bot', { refine: inMembers }),
    // Retention reads all time: "did she come back" has no window.
    readSince<{ member_id: string; started_at: string; last_seen_at: string }>('client_session', 'started_at', new Date(0), 'member_id, started_at, last_seen_at', { refine: inMembers }),
    readSince<Delivery>('pilot_delivery', 'created_at', sentSince,
      'delivery_id, member_id, trigger, request_text, occasion, created_at, pilot_look(look_id, response, responded_at, visible_to_client, published_at, items)',
      { refine: (q) => inMembers(q).eq('is_synthetic', false) }),
    readSince<{ member_id: string; known_event_id: string; item_id: string; shown: boolean; picked_at: string }>('event_pick', 'picked_at', sentSince,
      'member_id, known_event_id, item_id, shown, picked_at', { refine: inMembers }),
    // Calendar events from the start of the window onward — including the
    // ones still to come, which is most of what a calendar is.
    readSince<{ member_id: string; title: string; starts_at: string; occasion: string | null; status: string; known_event_id: string | null }>('member_calendar_event', 'starts_at', since,
      'member_id, title, starts_at, occasion, status, known_event_id', { refine: inMembers }),
    readSince<{ member_id: string; status: string; last_synced_at: string | null; created_at: string }>('member_calendar_connection', 'created_at', new Date(0),
      'member_id, status, last_synced_at, created_at', { refine: inMembers }),
    readSince<{ event_id: string; member_id: string; label: string }>('pilot_known_event', 'created_at', new Date(0),
      'event_id, member_id, label', { refine: inMembers }),
  ])

  // Every piece id any of these mention, named in one read.
  const pieceIds = [
    ...clicks.rows.map((r) => r.item_id),
    ...events.rows.filter((e) => e.target_kind === 'item' && e.target_id).map((e) => e.target_id as string),
    ...events.rows.map((e) => itemFromPath(e.path)).filter(Boolean) as string[],
    ...savedA.rows.map((r) => r.item_id),
    ...savedB.rows.map((r) => r.item_id),
  ]
  const names = await itemNames(pieceIds)
  const piece = (id: string, fallback: string | null = null) => {
    const n = names.get(id)
    return { key: id, label: pieceLabel(n, fallback), brand: n?.brand ?? null }
  }

  // ── Click-throughs: the outbound log ──────────────────────────────────────
  // Every click-through as one list first — the log's rows, the taps the log
  // never got, and retailer links followed straight from an email — so each
  // can be counted once and asked what started it.
  const TEN_MIN = 10 * 60_000
  const memberAuth = new Map(members.map((m) => [m.member_id, m.auth_user_id]))
  const memberOfAuth = new Map(members.filter((m) => m.auth_user_id).map((m) => [m.auth_user_id as string, m.member_id]))
  const taps = events.rows.filter((e) => e.type === 'click_out')
  /** The tracker's tap behind a logged click — it knows the room she was in. */
  const tapFor = (memberId: string, itemId: string, at: string) =>
    taps.find((e) => e.member_id === memberId && e.target_id === itemId && Math.abs(Date.parse(e.at) - Date.parse(at)) < TEN_MIN)

  interface Through { memberId: string; at: string; itemId: string | null; key: string; base: Omit<UsageRow, 'value' | 'last'>; path: string | null; fromEmail?: string }
  const throughs: Through[] = []
  for (const c of clicks.rows) {
    const memberId = memberOfAuth.get(c.user_id)
    if (!memberId) continue
    throughs.push({ memberId, at: c.clicked_at, itemId: c.item_id, key: c.item_id, base: piece(c.item_id), path: tapFor(memberId, c.item_id, c.clicked_at)?.path ?? null })
  }
  // A shop tap on a piece the log has no row for — within ten minutes, same
  // member, same piece — left MYRA all the same.
  const logged = (memberId: string, itemId: string, at: string) => {
    const t = Date.parse(at)
    const auth = memberAuth.get(memberId)
    return clicks.rows.some((c) => c.user_id === auth && c.item_id === itemId && Math.abs(Date.parse(c.clicked_at) - t) < TEN_MIN)
  }
  for (const e of taps) {
    if (!e.target_id || e.target_kind !== 'item') continue
    if (logged(e.member_id, e.target_id, e.at)) continue
    throughs.push({ memberId: e.member_id, at: e.at, itemId: e.target_id, key: e.target_id, base: piece(e.target_id, e.label), path: e.path })
  }
  // Retailer links outside the log (a raw retailer link in her rooms) still
  // reach the tracker as click_out; counted only when the log has no row.
  for (const e of taps) {
    if (e.target_id) continue
    const host = String(e.meta?.host ?? e.label ?? 'A RETAILER')
    throughs.push({ memberId: e.member_id, at: e.at, itemId: null, key: `host:${host}`, base: { key: `host:${host}`, label: host.toUpperCase(), brand: null }, path: e.path })
  }
  // An email link that went straight to a retailer never touches /go/.
  const ourHost = /(^|\.)myraassistant\.co\.uk$/i
  for (const c of emailClicks.rows) {
    if (c.is_bot) continue
    let host = ''
    try { host = new URL(c.target).host.replace(/^www\./, '') } catch { continue }
    if (!host || ourHost.test(host)) continue
    throughs.push({ memberId: c.member_id, at: c.at, itemId: null, key: `host:${host}`, base: { key: `host:${host}`, label: host.toUpperCase(), brand: null }, path: null, fromEmail: c.kind })
  }

  // ── What started each one ─────────────────────────────────────────────────
  // Everything MYRA sent her, by piece: which looks held it and what kind of
  // look each was, and which event options named it.
  const eventLabel = new Map(knownEvents.rows.map((k) => [k.event_id, k.label]))
  const calendarEvent = new Set(calendarEvents.rows.map((c) => c.known_event_id).filter(Boolean) as string[])
  const holdingLooks = new Map<string, { at: number; source: ReturnType<typeof lookSourceOf>; why: string }[]>()
  for (const d of deliveries.rows) {
    const source = lookSourceOf(d)
    const why = (d.request_text || (d.occasion ? d.occasion.replace(/_/g, ' ') : '') || 'A LOOK').toUpperCase()
    for (const l of d.pilot_look ?? []) {
      if (!l.visible_to_client) continue
      const at = Date.parse(l.published_at ?? d.created_at)
      for (const it of l.items ?? []) {
        if (!it?.item_id || it.owned) continue
        const k = `${d.member_id}:${it.item_id}`
        const list = holdingLooks.get(k) ?? []
        list.push({ at, source, why })
        holdingLooks.set(k, list)
      }
    }
  }
  const searchesBy = events.rows.filter((e) => e.type === 'search' && e.label)

  const sourceOf = (t: Through): { source: ClickSource; why: string } => {
    const time = Date.parse(t.at)
    if (t.fromEmail) return { source: 'email', why: EMAIL_LABEL[t.fromEmail] ?? t.fromEmail.toUpperCase() }
    // An email she followed in the two hours before.
    const mail = emailClicks.rows
      .filter((c) => !c.is_bot && c.member_id === t.memberId && time - Date.parse(c.at) >= 0 && time - Date.parse(c.at) < 2 * 3_600_000)
      .sort((a, b) => b.at.localeCompare(a.at))[0]
    if (mail) return { source: 'email', why: `CAME IN FROM ${EMAIL_LABEL[mail.kind] ?? mail.kind.toUpperCase()}` }
    // An option MYRA picked for one of her events.
    const pick = t.itemId ? picks.rows.find((p) => p.member_id === t.memberId && p.item_id === t.itemId && p.shown && Date.parse(p.picked_at) <= time) : null
    if (pick) {
      const label = (eventLabel.get(pick.known_event_id) ?? 'HER EVENT').toUpperCase()
      return { source: 'event', why: `FOR ${label}${calendarEvent.has(pick.known_event_id) ? ' · FROM HER CALENDAR' : ''}` }
    }
    if (t.path?.startsWith('/me/events')) return { source: 'event', why: 'FROM HER EVENTS ROOM' }
    // Browse is hers even when the piece is in a look somewhere too.
    if (t.path?.startsWith('/me/browse')) {
      const q = searchesBy
        .filter((e) => e.member_id === t.memberId && time - Date.parse(e.at) >= 0 && time - Date.parse(e.at) < 20 * 60_000)
        .sort((a, b) => b.at.localeCompare(a.at))[0]
      return q ? { source: 'searched', why: `SEARCHED “${String(q.label).toUpperCase()}”` } : { source: 'browsed', why: 'BROWSE' }
    }
    // A look MYRA had put in front of her before the click.
    const held = (t.itemId ? holdingLooks.get(`${t.memberId}:${t.itemId}`) ?? [] : []).filter((l) => l.at <= time)
    const sentLook = held.find((l) => l.source === 'for_you')
    if (sentLook) return { source: 'sent', why: sentLook.why }
    const emailed = held.find((l) => l.source === 'emailed')
    if (emailed) return { source: 'email', why: emailed.why }
    const asked = held.find((l) => l.source === 'asked' || l.source === 'saved')
    if (asked) return { source: 'asked', why: asked.why }
    if (t.path?.startsWith('/me/ways')) return { source: 'asked', why: 'WAYS TO WEAR A PIECE SHE OPENED' }
    return { source: 'own', why: t.path ? `FROM ${t.path.toUpperCase()}` : 'NO ROOM RECORDED' }
  }

  const clicked = new Map<string, UsageRow>()
  const clickList: UsageClick[] = []
  const bySource = new Map<ClickSource, number>()
  for (const t of throughs) {
    const who = nameById.get(t.memberId)
    bump(clicked, t.key, t.base, t.at, who)
    const { source, why } = sourceOf(t)
    bySource.set(source, (bySource.get(source) ?? 0) + 1)
    clickList.push({ at: t.at, key: t.key, label: t.base.label, source, why, member: who ?? '' })
  }
  clickList.sort((a, b) => b.at.localeCompare(a.at))

  // ── Opened: pieces, looks ─────────────────────────────────────────────────
  const opened = new Map<string, UsageRow>()
  const looks = new Map<string, UsageRow>()
  const seenOpen = new Set<string>()
  for (const e of events.rows) {
    const who = nameById.get(e.member_id)
    if (e.type === 'look_open' && e.target_id) {
      bump(looks, e.target_id, { key: e.target_id, label: (e.label || 'A LOOK').toUpperCase(), brand: null }, e.at, who)
      continue
    }
    const id = e.type === 'item_open' ? e.target_id : (e.type === 'page_view' || e.type === 'room_open') ? itemFromPath(e.path) : null
    if (!id) continue
    // A piece page fires both a page view and the ways sheet's item_open; one
    // open per piece per minute is the honest count.
    const dedupe = `${e.member_id}:${id}:${e.at.slice(0, 16)}`
    if (seenOpen.has(dedupe)) continue
    seenOpen.add(dedupe)
    bump(opened, id, piece(id, e.label), e.at, who)
  }

  // ── Saved ─────────────────────────────────────────────────────────────────
  const saved = new Map<string, UsageRow>()
  for (const s of savedA.rows) bump(saved, s.item_id, piece(s.item_id), s.created_at, nameByAuth.get(s.user_id))
  for (const s of savedB.rows) bump(saved, s.item_id, piece(s.item_id), s.saved_at, nameById.get(s.member_id))

  // ── Saved outfits ─────────────────────────────────────────────────────────
  // Her SAVED OUTFITS shelf: a look she said yes to, or a way to wear she kept.
  const LOOK_FROM: Record<ReturnType<typeof lookSourceOf>, string> = {
    for_you: 'SENT BY MYRA', emailed: 'EMAILED BY MYRA', asked: 'SHE ASKED', saved: 'SAVED FROM WAYS TO WEAR',
  }
  const savedLooks: UsageSavedLook[] = []
  const sinceMs = since.getTime()
  for (const d of deliveries.rows) {
    const kept = d.request_text === SAVED_REQUEST_TEXT
    for (const l of d.pilot_look ?? []) {
      const at = l.response === 'yes' ? l.responded_at : kept ? (l.published_at ?? d.created_at) : null
      if (!at || Date.parse(at) < sinceMs) continue
      const pieces = (l.items ?? []).filter((it) => it && !it.owned).slice(0, 3)
        .map((it) => [it.brand, it.product_name].filter(Boolean).join(' '))
      const why = d.request_text && !kept ? ` · ${d.request_text.toUpperCase()}` : ''
      savedLooks.push({
        lookId: l.look_id, at, label: pieces.join(' + ') || 'A LOOK',
        source: `${LOOK_FROM[lookSourceOf(d)]}${why}`, member: nameById.get(d.member_id) ?? '',
      })
    }
  }
  savedLooks.sort((a, b) => b.at.localeCompare(a.at))

  // ── Calendar ──────────────────────────────────────────────────────────────
  const calendarRows: UsageCalendarEvent[] = calendarEvents.rows
    .map((c) => {
      const forIt = c.known_event_id ? picks.rows.filter((p) => p.known_event_id === c.known_event_id && p.shown) : []
      const pickIds = new Set(forIt.map((p) => p.item_id))
      return {
        at: c.starts_at, title: c.title, occasion: c.occasion, status: c.status,
        picks: forIt.length,
        pickClicks: throughs.filter((t) => t.memberId === c.member_id && t.itemId && pickIds.has(t.itemId)).length,
        member: nameById.get(c.member_id) ?? '',
      }
    })
    .sort((a, b) => a.at.localeCompare(b.at))

  // ── Searches and questions ────────────────────────────────────────────────
  const searches: UsageSearch[] = events.rows
    .filter((e) => (e.type === 'search' || e.type === 'chat_send') && e.label)
    .map((e) => ({ at: e.at, text: e.label as string, kind: e.type === 'search' ? 'search' as const : 'question' as const, member: nameById.get(e.member_id) ?? '' }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 100)

  // ── Emails: sent vs followed ──────────────────────────────────────────────
  const emailFor = new Map<string, string>()
  for (const m of members) for (const e of [m.email, m.invite_email]) if (e) emailFor.set(e.toLowerCase(), m.member_id)
  const authToMember = new Map(members.filter((m) => m.auth_user_id).map((m) => [m.auth_user_id as string, m.member_id]))
  const emailRows = new Map<string, UsageEmail>()
  const emailRow = (kind: string) => {
    let r = emailRows.get(kind)
    if (!r) { r = { kind, label: EMAIL_LABEL[kind] ?? kind.replace(/^shopper_/, '').toUpperCase(), sent: 0, clicks: 0, scannerClicks: 0, lastClick: null }; emailRows.set(kind, r) }
    return r
  }
  for (const s of sent.rows) {
    const meta = s.meta ?? {}
    if (meta.trial || meta.sample) continue
    const who = meta.memberId ?? authToMember.get(meta.userId) ?? emailFor.get(String(meta.to ?? '').toLowerCase())
    if (!who || !ids.includes(who)) continue
    emailRow(s.kind).sent++
  }
  for (const c of emailClicks.rows) {
    const r = emailRow(c.kind)
    if (c.is_bot) { r.scannerClicks++; continue }
    r.clicks++
    if (!r.lastClick || c.at > r.lastClick) r.lastClick = c.at
  }
  const emailClicksRecent = emailClicks.rows
    .filter((c) => !c.is_bot)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 30)
    .map((c) => ({ at: c.at, kind: c.kind, label: EMAIL_LABEL[c.kind] ?? c.kind, target: c.target, member: nameById.get(c.member_id) ?? '' }))

  // ── Retention ─────────────────────────────────────────────────────────────
  const buckets = weekBuckets(8)
  const now = Date.now()
  const retentionMembers: RetentionMember[] = members.map((m) => {
    const own = sessionsAll.rows.filter((s) => s.member_id === m.member_id)
    const weeks = buckets.map((b) => own.filter((s) => {
      const t = new Date(s.started_at).getTime()
      return t >= b.start.getTime() && t < b.end.getTime()
    }).length)
    const daysSet = new Set(own.map((s) => s.started_at.slice(0, 10)))
    const first = own.reduce<string | null>((a, s) => (!a || s.started_at < a ? s.started_at : a), null)
    const last = own.reduce<string | null>((a, s) => (!a || s.last_seen_at > a ? s.last_seen_at : a), null)
    return { memberId: m.member_id, name: m.name, firstVisit: first, lastVisit: last, daysActive: daysSet.size, weeks }
  })
  const visited = retentionMembers.filter((r) => r.firstVisit)
  const activeWithin = (ms: number) => visited.filter((r) => r.lastVisit && now - new Date(r.lastVisit).getTime() <= ms).length

  const clickedRows = top(clicked)
  const openedRows = top(opened)
  const savedRows = top(saved)

  return {
    days,
    clickedPieces: clickedRows,
    clickedBrands: brandsOf(Array.from(clicked.values())),
    clickTotal: Array.from(clicked.values()).reduce((a, r) => a + r.value, 0),
    clicks: clickList.slice(0, 100),
    clickSources: (Object.keys(CLICK_SOURCE) as ClickSource[]).map((source) => ({ source, value: bySource.get(source) ?? 0 })),
    promptedTotal: clickList.filter((c) => CLICK_SOURCE[c.source].group === 'myra').length,
    savedLooks: savedLooks.slice(0, 100),
    savedLookTotal: savedLooks.length,
    savedPieceTotal: savedA.rows.length + savedB.rows.length,
    searchTotal: events.rows.filter((e) => e.type === 'search').length,
    questionTotal: events.rows.filter((e) => e.type === 'chat_send').length,
    calendar: {
      connections: calendarConns.rows.map((c) => ({ member: nameById.get(c.member_id) ?? '', status: c.status, lastSynced: c.last_synced_at })),
      events: calendarRows,
      planned: calendarRows.filter((c) => c.status === 'planning').length,
    },
    openedPieces: openedRows,
    openedBrands: brandsOf(Array.from(opened.values())),
    openedLooks: top(looks),
    savedPieces: savedRows,
    savedBrands: brandsOf(Array.from(saved.values())),
    searches,
    emails: Array.from(emailRows.values()).sort((a, b) => b.sent - a.sent || b.clicks - a.clicks),
    emailClicksRecent,
    retention: {
      withLogin: members.filter((m) => m.auth_user_id).length,
      everVisited: visited.length,
      active7: activeWithin(7 * DAY),
      active30: activeWithin(30 * DAY),
      // Came back on a second, different day — the first real sign of a habit.
      cameBack: visited.filter((r) => r.daysActive >= 2).length,
      weekLabels: buckets.map((b) => b.label),
      members: retentionMembers,
    },
  }
}
