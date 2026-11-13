// INSPIRATION TO OUTFIT — a member's picture of a look becomes outfits of her own.
//
// Chloe, 2026-11-12: "roll out the inspiration-photo feature in the Looks
// section: a user uploads an inspiration photo and MYRA styles three or four
// outfits around it… it doesn't have to follow her brand preferences, it just
// needs to match the picture in her price range". So:
//
//   1. THE READ   the same eye as Outfit Review's look projects
//                 (lib/review-inspiration): the pieces of the look, their
//                 cloths and colours, the palette. Done while she waits (a few
//                 seconds), so she sees what MYRA made of her picture at once.
//   2. THE POOL   her composable library — pieces in HER SIZE — kept to her
//                 price bands and never a label she has turned away. Her taste
//                 graph does not narrow it: the picture is the brief.
//   3. THE MATCH  every key piece of the picture matched on its own and judged
//                 by eye against it (lib/review-inspiration-match), outfits
//                 composed only from those matches at one price point.
//   4. THE CHECK  MYRA's eye on every outfit, with her sizes, before anything
//                 is kept (lib/look-check) — nothing unchecked reaches her.
//   5. KEPT       as a delivery of hers (pilot_delivery + pilot_look), so her
//                 Looks page shows them on the FROM YOUR INSPIRATION shelf
//                 with everything a look of hers can do; a note tells her.
//
// Steps 2–5 run in the background (a drain, kicked on the drop; the cron
// sweep finishes anything cut off), the way Outfit Review's projects do.

import 'server-only'
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase-server'
import type { ItemWithBrand } from '@/lib/admin-queries'
import { intakeInspiration, pieceLabel, type ProjectInspiration } from '@/lib/review-inspiration'
import { matchInspiration, composeInspirationLooks, colourFamilyOf } from '@/lib/review-inspiration-match'
import { WAY_CLOSE, WAY_STYLE } from '@/lib/review-inspiration'
import { loadComposableLibrary } from '@/app/admin/private-stylist/actions'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import { sellable } from '@/lib/stock-sellable'
import { loadTasteGraph, overHerBudget, blockedForHer } from '@/lib/taste-graph'
import { judgeLooksForMemberEach, hasPieceOutOfSize, CHECK_DOWN_ERROR } from '@/lib/look-check'
import { toLookItem } from '@/lib/pilot-composer'
import { lookVectorFromItems } from '@/lib/taste-vector'
import { INSPIRATION_REQUEST_PREFIX } from '@/lib/emailed-looks'
import { siteUrl } from '@/lib/studio/email'

export type InspirationStatus = 'queued' | 'running' | 'done' | 'failed'

export interface MemberInspiration {
  inspiration_id: string
  member_id: string
  image_url: string
  title: string
  inspiration: ProjectInspiration
  status: InspirationStatus
  attempts: number
  error: string | null
  looks_count: number
  delivery_id: string | null
  created_at: string
  started_at: string | null
  heartbeat_at: string | null
  finished_at: string | null
}

/** What the page polls: where one inspiration stands. */
export interface InspirationStatusView {
  inspiration_id: string
  status: InspirationStatus
  title: string
  summary: string
  image_url: string
  pieces: string[]
  looks_count: number
  delivery_id: string | null
  error: string | null
  created_at: string
}

/** Outfits wanted per picture, and the anchors and candidates it takes to get there past the check. */
const WANT = 4
const ANCHORS = 4
const PER_ANCHOR = 2
const JUDGE_AT_MOST = 6
/** A pool smaller than this cannot answer a picture: her size or budget has left too little. */
const MIN_POOL = 40
const STALE_MS = 4 * 60_000
const MAX_ATTEMPTS = 3
const KICK_THROTTLE_MS = 10_000
let lastKickAt = 0
const nowIso = () => new Date().toISOString()
const migrationError = (msg: string | undefined | null) =>
  msg && /member_inspiration|schema cache|does not exist/i.test(msg) ? 'Run migration 0125 (npm run migrate) first' : msg ?? 'Database error'

function rowToView(r: any): InspirationStatusView {
  const insp = (r.inspiration ?? {}) as Partial<ProjectInspiration>
  return {
    inspiration_id: r.inspiration_id,
    status: r.status,
    title: r.title,
    summary: insp.summary ?? '',
    image_url: r.image_url,
    pieces: (insp.pieces ?? []).map((p) => pieceLabel(p)),
    looks_count: r.looks_count ?? 0,
    delivery_id: r.delivery_id ?? null,
    error: r.error ?? null,
    created_at: r.created_at,
  }
}

// ── The drop ───────────────────────────────────────────────────────────────

/** Read her picture now, queue the styling, and say what MYRA saw. */
export async function startMemberInspiration(memberId: string, bytes: Buffer, contentType: string): Promise<InspirationStatusView | { error: string; read?: string | null }> {
  const read = await intakeInspiration(bytes, contentType)
  if (read.error || !read.inspiration) return { error: read.error ?? 'MYRA could not read that picture', read: read.read ?? null }
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('member_inspiration').insert({
    member_id: memberId,
    image_url: read.inspiration.image_url,
    title: read.inspiration.title.slice(0, 120),
    inspiration: read.inspiration,
    status: 'queued',
  }).select('*').single()
  if (error || !data) return { error: migrationError(error?.message) }
  kickMemberInspirationDrain()
  return rowToView(data)
}

export async function memberInspirationStatus(memberId: string, inspirationId: string): Promise<InspirationStatusView | { error: string }> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('member_inspiration').select('*').eq('inspiration_id', inspirationId).eq('member_id', memberId).maybeSingle()
  if (error) return { error: migrationError(error.message) }
  if (!data) return { error: 'Not found' }
  // A run cut off mid-way: the next drain picks it up; say so rather than wait for the sweep.
  if (data.status === 'running' && data.heartbeat_at && Date.now() - new Date(data.heartbeat_at).getTime() > STALE_MS) kickMemberInspirationDrain()
  return rowToView(data)
}

export async function listMemberInspirations(memberId: string, limit = 8): Promise<InspirationStatusView[]> {
  const admin = createAdminClient() as any
  const { data } = await admin.from('member_inspiration').select('*').eq('member_id', memberId).order('created_at', { ascending: false }).limit(limit)
  return ((data ?? []) as any[]).map(rowToView)
}

// ── The styling ────────────────────────────────────────────────────────────

/** Her pieces that a picture may be answered with: in her size, under her ceilings, never a label she turned away. */
async function poolForMember(admin: any, member: any): Promise<ItemWithBrand[]> {
  const [library, graph] = await Promise.all([loadComposableLibrary(member), loadTasteGraph(admin, member.member_id)])
  return library.filter((i) =>
    !isOwnedItem(i as any) && !!i.image_url && sellable(i as any) &&
    !blockedForHer(graph, i as any) && !overHerBudget(graph, i as any))
}

/**
 * The anchors a picture is answered around: its two key garments, each from
 * its own matches, the one in the picture's colour first (CLOSEST), then the
 * rest in turn so the skirt leads as often as the jacket.
 */
function anchorsFor(insp: ProjectInspiration, colourOf: (id: string) => string): { anchorId: string; way: string }[] {
  const keys = (insp.matches ?? [])
    .filter((m) => m.slot === 'dress' || m.slot === 'top' || m.slot === 'bottom' || m.slot === 'outerwear')
    .sort((a, b) => Number(b.hero) - Number(a.hero))
    .slice(0, 2)
  const per = Math.ceil(ANCHORS / Math.max(1, keys.length))
  const queues = keys.map((k) => {
    const want = colourFamilyOf(insp.pieces.find((p) => p.slot === k.slot)?.colour)
    const closest = want ? k.picks.find((p) => colourOf(p.id) === want) : undefined
    const order = closest ? [closest, ...k.picks.filter((p) => p !== closest)] : k.picks
    return order.slice(0, per).map((p) => ({ anchorId: p.id, way: p === closest ? WAY_CLOSE : WAY_STYLE }))
  })
  const plan: { anchorId: string; way: string }[] = []
  const taken = new Set<string>()
  for (let i = 0; i < per; i++) for (const q of queues) {
    const step = q[i]
    if (!step || taken.has(step.anchorId) || plan.length >= ANCHORS) continue
    taken.add(step.anchorId)
    plan.push(step)
  }
  return plan
}

async function runOne(admin: any, row: MemberInspiration): Promise<void> {
  const beat = (patch: Record<string, unknown> = {}) =>
    admin.from('member_inspiration').update({ heartbeat_at: nowIso(), ...patch }).eq('inspiration_id', row.inspiration_id)
  const fail = async (error: string) => { await beat({ status: 'failed', error, finished_at: nowIso() }) }
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', row.member_id).maybeSingle()
  if (!member) return fail('Member not found')
  const insp: ProjectInspiration = row.inspiration

  const pool = await poolForMember(admin, member)
  if (pool.length < MIN_POOL) return fail('MYRA has too few pieces in your size and price range to style this yet')
  await beat()

  const matched = await matchInspiration(insp, { pool })
  insp.matches = matched.matches
  await beat({ inspiration: insp })
  const byId = new Map(pool.map((i) => [i.item_id, i]))
  const plan = anchorsFor(insp, (id) => String((byId.get(id) as any)?.colour_family ?? '').toLowerCase())
  if (plan.length === 0) return fail('MYRA could not find pieces like the ones in your picture in your size and price range')

  // Compose around each anchor; every candidate is a look of hers in the making.
  type Candidate = { items: ReturnType<typeof toLookItem>[]; anchorId: string; way: string; score: number }
  const candidates: Candidate[] = []
  const avoid: string[] = []
  for (const step of plan) {
    const res = await composeInspirationLooks(insp, step.anchorId, step.way, avoid, PER_ANCHOR, { pool }).catch((err) => { console.error('[member-inspiration] compose', err); return null })
    if (!res) continue
    for (const c of res.candidates) {
      const ids = [res.anchor.item_id, ...c.items.map((i) => i.item_id)]
      const pieces = ids.map((id) => byId.get(id)).filter((i): i is ItemWithBrand => !!i)
      if (pieces.length !== ids.length) continue
      candidates.push({ items: pieces.map(toLookItem), anchorId: res.anchor.item_id, way: step.way, score: c.score })
      avoid.push(...ids)
    }
    await beat()
  }
  if (candidates.length === 0) return fail('MYRA could not put an outfit together from your picture in your size and price range')

  // The library is a snapshot up to an hour old: the few pieces picked are checked against the shop as it is now.
  const pickedIds = Array.from(new Set(candidates.flatMap((c) => c.items.map((i) => i.item_id)).filter((id): id is string => !!id)))
  const { data: facts } = await admin.from('item').select('item_id, stock_status, status').in('item_id', pickedIds)
  const live = new Set(((facts ?? []) as any[]).filter((f) => f.status !== 'archived' && sellable(f)).map((f) => f.item_id))
  const judgeable = candidates
    .filter((c) => c.items.every((i) => i.item_id && live.has(i.item_id)))
    .sort((a, b) => (a.way === WAY_CLOSE ? -1 : 0) - (b.way === WAY_CLOSE ? -1 : 0) || b.score - a.score)
    .slice(0, JUDGE_AT_MOST)
  if (judgeable.length === 0) return fail('The pieces that matched your picture have just sold out — try again in a day or two')

  // MYRA's eye on every candidate, with her sizes; the first WANT that pass are kept.
  const kept: Candidate[] = []
  let checked = 0
  await judgeLooksForMemberEach(admin, row.member_id, judgeable.map((c) => ({ items: c.items })), 'unknown', (i, judged) => {
    if (judged.check) checked++
    const ok = !!judged.check && judged.check.verdict !== 'clashes' && !hasPieceOutOfSize(judged)
    if (ok && kept.length < WANT) kept.push(judgeable[i])
  })
  await beat()
  if (kept.length === 0) return fail(checked ? 'None of the outfits MYRA tried passed its check in your size — try another picture' : CHECK_DOWN_ERROR)

  // Kept as a delivery of hers: her Looks page shows them like any other.
  const now = nowIso()
  const { data: delivery, error: derr } = await admin.from('pilot_delivery').insert({
    member_id: row.member_id,
    trigger: 'request',
    request_text: `${INSPIRATION_REQUEST_PREFIX}${row.title}`,
    occasion: null,
    status: 'sent',
    sent_at: now,
  }).select('delivery_id').single()
  if (derr || !delivery) return fail(derr?.message ?? 'Could not keep the outfits')
  const rows = kept.map((c, i) => ({
    delivery_id: delivery.delivery_id,
    position: i + 1,
    hero_item_id: c.anchorId,
    items: c.items,
    taste_vector: lookVectorFromItems(c.items.map((it) => byId.get(it.item_id ?? '')).filter(Boolean) as any[]),
    notes: c.way === WAY_CLOSE ? 'Closest to your picture' : 'In the style of your picture',
    approved_at: now,
    visible_to_client: true,
    published_at: now,
  }))
  const { data: looks, error: lerr } = await admin.from('pilot_look').insert(rows).select('look_id')
  if (lerr) return fail(lerr.message)
  const lookIds = ((looks ?? []) as any[]).map((l) => l.look_id)
  await admin.from('pilot_notification').insert({
    member_id: row.member_id, kind: 'looks_ready',
    body: `${lookIds.length} outfit${lookIds.length === 1 ? '' : 's'} styled from your inspiration.`,
    look_ids: lookIds,
  }).then(({ error }: any) => { if (error) console.error('[member-inspiration] note', error) })
  await beat({ status: 'done', looks_count: lookIds.length, delivery_id: delivery.delivery_id, finished_at: nowIso(), error: null })
}

/** Runs cut off with their function (no heartbeat in STALE_MS) go back to the queue, up to MAX_ATTEMPTS. */
async function recoverStale(admin: any): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString()
  const { data } = await admin.from('member_inspiration').select('inspiration_id, attempts').eq('status', 'running').lt('heartbeat_at', cutoff)
  let n = 0
  for (const r of (data ?? []) as any[]) {
    const again = (r.attempts ?? 0) < MAX_ATTEMPTS
    await admin.from('member_inspiration').update(again ? { status: 'queued' } : { status: 'failed', error: 'MYRA ran out of time styling this — try again', finished_at: nowIso() }).eq('inspiration_id', r.inspiration_id)
    n++
  }
  return n
}

/** Work the queue for up to `budgetMs`, one inspiration at a time. */
export async function drainMemberInspirations(budgetMs: number): Promise<{ done: number; requeued: number; moreQueued: boolean }> {
  const admin = createAdminClient() as any
  const deadline = Date.now() + budgetMs
  const requeued = await recoverStale(admin)
  let done = 0
  while (Date.now() < deadline - 60_000) {
    const { data: next } = await admin.from('member_inspiration').select('*').eq('status', 'queued').order('created_at').limit(1)
    const row = next?.[0]
    if (!row) break
    const { data: claimed } = await admin.from('member_inspiration')
      .update({ status: 'running', started_at: row.started_at ?? nowIso(), heartbeat_at: nowIso(), attempts: (row.attempts ?? 0) + 1, error: null })
      .eq('inspiration_id', row.inspiration_id).eq('status', 'queued').select('*').maybeSingle()
    if (!claimed) continue
    try { await runOne(admin, claimed as MemberInspiration) } catch (err) {
      console.error('[member-inspiration]', row.inspiration_id, err)
      await admin.from('member_inspiration').update({ status: 'failed', error: err instanceof Error ? err.message : String(err), finished_at: nowIso() }).eq('inspiration_id', row.inspiration_id)
    }
    done++
  }
  const { count } = await admin.from('member_inspiration').select('inspiration_id', { count: 'exact', head: true }).eq('status', 'queued')
  return { done, requeued, moreQueued: (count ?? 0) > 0 }
}

/** Start a drain without waiting: on Vercel the cron function's 300s, locally the dev server. */
export function kickMemberInspirationDrain(): void {
  if (Date.now() - lastKickAt < KICK_THROTTLE_MS) return
  lastKickAt = Date.now()
  const secret = process.env.CRON_SECRET
  if (secret && process.env.VERCEL) {
    const req = fetch(siteUrl('/api/cron/member-inspiration?kick=1'), { headers: { authorization: `Bearer ${secret}` }, cache: 'no-store' })
      .then((r) => { if (!r.ok) console.error('[member-inspiration] kick', r.status) })
      .catch((e) => console.error('[member-inspiration] kick', e))
    try { waitUntil(Promise.race([req, new Promise((r) => setTimeout(r, 3_000))])) } catch { /* local */ }
    return
  }
  const work = drainMemberInspirations(20 * 60_000)
    .then((r) => { if (r.moreQueued) { lastKickAt = 0; kickMemberInspirationDrain() } })
    .catch((e) => console.error('[member-inspiration] drain', e))
  try { waitUntil(work) } catch { /* local dev: the promise simply runs */ }
}
