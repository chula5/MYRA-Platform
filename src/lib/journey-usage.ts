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

  const [clicks, events, savedA, savedB, sent, emailClicks, sessionsAll] = await Promise.all([
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
  const clicked = new Map<string, UsageRow>()
  for (const c of clicks.rows) bump(clicked, c.item_id, piece(c.item_id), c.clicked_at, nameByAuth.get(c.user_id))
  // A shop tap on a piece the log has no row for — within ten minutes, same
  // member, same piece — left MYRA all the same.
  const memberAuth = new Map(members.map((m) => [m.member_id, m.auth_user_id]))
  const logged = (memberId: string, itemId: string, at: string) => {
    const t = Date.parse(at)
    const auth = memberAuth.get(memberId)
    return clicks.rows.some((c) => c.user_id === auth && c.item_id === itemId && Math.abs(Date.parse(c.clicked_at) - t) < 10 * 60_000)
  }
  for (const e of events.rows) {
    if (e.type !== 'click_out' || !e.target_id || e.target_kind !== 'item') continue
    if (logged(e.member_id, e.target_id, e.at)) continue
    bump(clicked, e.target_id, piece(e.target_id, e.label), e.at, nameById.get(e.member_id))
  }
  // Retailer links outside the log (a raw retailer link in her rooms) still
  // reach the tracker as click_out; counted only when the log has no row.
  for (const e of events.rows) {
    if (e.type !== 'click_out' || e.target_id) continue
    const host = String(e.meta?.host ?? e.label ?? 'A RETAILER')
    bump(clicked, `host:${host}`, { key: `host:${host}`, label: host.toUpperCase(), brand: null }, e.at, nameById.get(e.member_id))
  }

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
