'use server'

// WAYS TO WEAR IT — the browser-callable surface.
//
// Every surface that shows a piece styled other ways (her piece page, a piece
// she kept while shopping, a hotspot on a look, Browse, FOR YOU) asks here.
// The answer is what MYRA already keeps for that piece (instant); when there
// is nothing yet, a job is queued and started, and the page polls the memory
// while MYRA's eye works. The member is resolved on the server — her session,
// or the member Chloe names from HER VIEW, honoured only for the admin.

import { createAdminClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'
import { getStyledWays, type StyledWayLook, type WayMode } from '@/lib/styled-ways'
import { WAYS } from '@/lib/styled-ways-core'
import {
  requestStyledWays, enqueueWarmups, openJobFor, lastJobFor, kickStyledWaysDrain, RUNNING_STALE_MS, type JobReason,
} from '@/lib/styled-ways-queue'
import { recordTap } from '@/lib/styled-ways-demand'

/** Finish a small write after the response has gone (the ledger must never slow a tap). */
function after(work: Promise<unknown>): void {
  const p = work.catch((e) => console.error('[ways] background', e))
  try { waitUntil(p) } catch { /* local dev: the promise simply runs */ }
}

/** idle: opened passively — what is kept is shown, nothing has been asked for yet. */
export type WaysStatus = 'ready' | 'working' | 'none' | 'failed' | 'idle'

export interface WaysPiece {
  item_id: string
  product_name: string
  brand: string | null
  image_url: string | null
}

export interface WaysView {
  looks: StyledWayLook[]
  status: WaysStatus
  piece: WaysPiece | null
  error?: string
  /** Chloe testing as her. */
  test?: boolean
}

async function pieceFor(admin: any, itemId: string): Promise<WaysPiece | null> {
  const { data } = await admin.from('item').select('item_id, product_name, image_url, status, brand:brand_id(name)')
    .eq('item_id', itemId).neq('status', 'archived').maybeSingle()
  if (!data) return null
  return { item_id: data.item_id, product_name: data.product_name, brand: data.brand?.name ?? null, image_url: data.image_url ?? null }
}

async function statusFor(admin: any, memberId: string, itemId: string, mode: WayMode, looks: StyledWayLook[]):
  Promise<{ status: WaysStatus; error?: string }> {
  const open = await openJobFor(admin, memberId, itemId, mode)
  if (open) {
    // A job sitting queued is one nobody is draining (a crashed kick, a cold
    // cron), and one running longer than any compose takes is one whose
    // function died: the poll that finds either starts a drain, which gives
    // the dead one back to the queue and picks it up.
    const stale = open.status === 'running' && !!open.started_at && Date.now() - Date.parse(open.started_at) > RUNNING_STALE_MS
    if (open.status === 'queued' || stale) kickStyledWaysDrain()
    return { status: 'working' }
  }
  if (looks.length) return { status: 'ready' }
  const last = await lastJobFor(admin, memberId, itemId, mode)
  if (last?.status === 'failed') return { status: 'failed', error: last.error ?? 'MYRA could not style this piece just now' }
  return { status: 'none' }
}

/**
 * Open the ways for a piece. Three fresh ways: ready, nothing queued. Fewer:
 * a tap job is queued (or joined) and started, and the caller polls. `more`
 * asks for another round around the same piece, different from what is kept.
 */
export async function openWaysToWear(
  itemId: string,
  opts: { mode?: WayMode; more?: boolean; passive?: boolean } = {},
  asMemberId?: string,
): Promise<WaysView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { looks: [], status: 'none', piece: null, error: 'Not signed in' }
  const admin = createAdminClient() as any
  const mode: WayMode = opts.mode ?? 'blend'
  try {
    const piece = await pieceFor(admin, itemId)
    if (!piece) return { looks: [], status: 'none', piece: null, error: 'That piece is no longer here', test: me.test }
    const looks = await getStyledWays(admin, me.memberId, itemId, mode)
    // A tap is counted on the ledger with whether the memory answered it whole.
    if (!opts.passive && !opts.more) after(recordTap(admin, me.memberId, itemId, mode, looks.length >= WAYS))
    if (!opts.more && looks.length >= WAYS) return { looks, status: 'ready', piece, test: me.test }
    // Passive (a rest, not a tap): show what is kept, and whether MYRA is
    // already on it, without spending the judge on a piece she only passed.
    if (opts.passive) {
      const s = await statusFor(admin, me.memberId, itemId, mode, looks)
      return { looks, piece, test: me.test, ...(s.status === 'working' ? s : { status: 'idle' as const }) }
    }

    const r = await requestStyledWays(admin, me.memberId, itemId, {
      mode, reason: opts.more ? 'more' : 'tap', shuffle: opts.more ? looks.length + 1 : 0, priority: 1,
    })
    if (r.error) return { looks, status: looks.length ? 'ready' : 'failed', piece, error: r.error, test: me.test }
    kickStyledWaysDrain()
    return { looks, status: 'working', piece, test: me.test }
  } catch (err) {
    return { looks: [], status: 'failed', piece: null, error: err instanceof Error ? err.message : 'Could not open this piece', test: me.test }
  }
}

/** What is kept now and whether MYRA is still working on it. */
export async function pollWaysToWear(itemId: string, mode: WayMode = 'blend', asMemberId?: string): Promise<WaysView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { looks: [], status: 'none', piece: null, error: 'Not signed in' }
  const admin = createAdminClient() as any
  try {
    const looks = await getStyledWays(admin, me.memberId, itemId, mode)
    const s = await statusFor(admin, me.memberId, itemId, mode, looks)
    return { looks, piece: null, test: me.test, ...s }
  } catch (err) {
    return { looks: [], status: 'failed', piece: null, error: err instanceof Error ? err.message : 'Could not read this piece', test: me.test }
  }
}

/**
 * Pieces she is about to be able to tap — a card she lingered on in Browse,
 * the one she picked, the pieces of a look she opened. Recorded on the
 * ledger, queued as warm-ups where they have no ways yet, and the drain is
 * kicked. Returns what already has its ways so the surface can mark it.
 */
export async function noticePieces(
  itemIds: string[],
  mode: WayMode = 'blend',
  source: Extract<JobReason, 'browse' | 'pick' | 'look' | 'feed' | 'view'> = 'browse',
  asMemberId?: string,
): Promise<{ ready: string[]; queued: string[]; capped: boolean }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { ready: [], queued: [], capped: false }
  const ids = Array.from(new Set(itemIds.filter(Boolean))).slice(0, 24)
  if (!ids.length) return { ready: [], queued: [], capped: false }
  const admin = createAdminClient() as any
  try {
    const r = await enqueueWarmups(admin, me.memberId, ids, source, { mode })
    if (r.queued.length) kickStyledWaysDrain()
    return r
  } catch (err) {
    console.error('[noticePieces]', err)
    return { ready: [], queued: [], capped: false }
  }
}

/** Several pieces at once — FOR YOU's styled door polls its whole shelf in one call. */
export async function pollWaysMany(itemIds: string[], asMemberId?: string, mode: WayMode = 'blend'): Promise<Record<string, { looks: StyledWayLook[]; status: WaysStatus; error?: string }>> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return {}
  const admin = createAdminClient() as any
  const out: Record<string, { looks: StyledWayLook[]; status: WaysStatus; error?: string }> = {}
  await Promise.all(Array.from(new Set(itemIds)).slice(0, 24).map(async (id) => {
    try {
      const looks = await getStyledWays(admin, me.memberId, id, mode)
      const s = await statusFor(admin, me.memberId, id, mode, looks)
      out[id] = { looks, ...s }
    } catch (err) {
      out[id] = { looks: [], status: 'failed', error: err instanceof Error ? err.message : 'Could not read this piece' }
    }
  }))
  return out
}

/**
 * MYRA works while she shops: the pieces she kept or lingered on are queued
 * as warm-ups (what already has its ways is returned at once), so FOR YOU's
 * styled door is full by the time she looks — and the work survives her
 * closing the tab, which the old browser-driven loop did not.
 */
export async function warmUpShopBrain(asMemberId?: string): Promise<{ looks: Record<string, StyledWayLook[]>; working: string[]; capped: boolean }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { looks: {}, working: [], capped: false }
  const admin = createAdminClient() as any
  try {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const [{ data: saved }, { data: viewed }] = await Promise.all([
      admin.from('member_saved_item').select('item_id').eq('member_id', me.memberId).order('saved_at', { ascending: false }).limit(12),
      admin.from('recently_viewed').select('item_id').eq('member_id', me.memberId).gte('viewed_at', since).order('viewed_at', { ascending: false }).limit(6),
    ])
    const ids = Array.from(new Set([
      ...((saved ?? []) as any[]).map((r) => r.item_id),
      ...((viewed ?? []) as any[]).map((r) => r.item_id),
    ].filter(Boolean))).slice(0, 12)
    if (!ids.length) return { looks: {}, working: [], capped: false }

    const savedIds = new Set(((saved ?? []) as any[]).map((r) => r.item_id))
    const r1 = await enqueueWarmups(admin, me.memberId, ids.filter((id) => savedIds.has(id)), 'save')
    const r2 = await enqueueWarmups(admin, me.memberId, ids.filter((id) => !savedIds.has(id)), 'view')
    if (r1.queued.length || r2.queued.length) kickStyledWaysDrain()

    const looks: Record<string, StyledWayLook[]> = {}
    const working: string[] = []
    await Promise.all(ids.map(async (id) => {
      const l = await getStyledWays(admin, me.memberId, id, 'blend')
      if (l.length) looks[id] = l
      if (l.length < WAYS && (await openJobFor(admin, me.memberId, id, 'blend'))) working.push(id)
    }))
    return { looks, working, capped: r1.capped || r2.capped }
  } catch (err) {
    console.error('[warmUpShopBrain]', err)
    return { looks: {}, working: [], capped: false }
  }
}

// ── SAVE — one of these outfits becomes one of her looks ─────────────────────
//
// Saving puts the outfit among her looks at once (approved, visible, published)
// and starts MYRA's picture of it in the background: a light Higgsfield shoot,
// minutes long, that lands on the look when it finishes. Until then the look
// draws as its pieces. The shoot runs through the local CLI, so on Vercel the
// picture simply does not come and the pieces stay.

import { revalidatePath } from 'next/cache'
import { waitUntil } from '@vercel/functions'
import type { LookItem } from '@/lib/pilot-stylist'
import { lookVectorFromItems } from '@/lib/taste-vector'
import { CLIENT_OCCASIONS } from '@/lib/client-occasions'
import { higgsfieldShootForLook } from '@/app/admin/private-stylist/actions'

export async function saveMyOutfit(
  items: LookItem[],
  why: string,
  occasion?: string | null,
  asMemberId?: string,
  /** From a kept way: link the look back to it, and reuse its picture rather than shooting again. */
  opts: { styledWayId?: string; imageUrl?: string | null } = {},
): Promise<{ lookId?: string; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const clean = (items ?? []).filter((it) => it && it.product_name).slice(0, 8)
  if (clean.length < 2) return { error: 'An outfit needs at least two pieces' }
  const occ = occasion && CLIENT_OCCASIONS.some((o) => o.id === occasion) ? occasion : 'casual_day'
  try {
    const admin = createAdminClient() as any
    const now = new Date().toISOString()
    const { data: delivery, error: derr } = await admin.from('pilot_delivery').insert({
      member_id: me.memberId,
      trigger: 'request',
      request_text: 'Saved from WAYS TO WEAR IT',
      occasion: occ,
      status: 'sent',
      sent_at: now,
    }).select('delivery_id').single()
    if (derr || !delivery) return { error: derr?.message ?? 'Could not save this outfit' }
    const ids = clean.map((it) => it.item_id).filter(Boolean)
    const { data: pieces } = ids.length ? await admin.from('item').select('*, brand(*)').in('item_id', ids) : { data: [] }
    const { data: look, error: lerr } = await admin.from('pilot_look').insert({
      delivery_id: delivery.delivery_id,
      position: 1,
      taste_vector: (pieces ?? []).length ? lookVectorFromItems(pieces as any[]) : null,
      items: clean,
      notes: why || null,
      approved_at: now,
      visible_to_client: true,
      published_at: now,
      ...(opts.imageUrl ? { image_url: opts.imageUrl } : {}),
    }).select('look_id').single()
    if (lerr || !look) return { error: lerr?.message ?? 'Could not save this outfit' }

    if (opts.styledWayId) {
      await admin.from('styled_way').update({ saved_look_id: look.look_id }).eq('styled_way_id', opts.styledWayId).eq('member_id', me.memberId)
    }
    // The picture: already made for the way, or shot now (local CLI only).
    if (!opts.imageUrl) {
      const work = higgsfieldShootForLook(look.look_id, 'E5', { light: true })
        .then((r) => { if (r.error) console.error('[saveMyOutfit] shoot', look.look_id, r.error) })
        .catch((err) => console.error('[saveMyOutfit] shoot', look.look_id, err))
      try { waitUntil(work) } catch { /* local dev: the promise simply runs */ }
    }
    try { revalidatePath('/me/looks'); revalidatePath('/me') } catch { /* fine after the response */ }
    return { lookId: look.look_id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save this outfit' }
  }
}

// ── LIKE / DISLIKE — her verdict on a way ────────────────────────────────────
//
// A like saves the outfit to her looks at once (the same save as the button)
// and teaches her layer exactly as a yes on a delivered look does. A dislike
// retires the way so it never shows again and tells her brand affinities.

import { recordMemberLookFeedback } from '@/app/admin/private-stylist/actions'
import { applyBrandSignals } from '@/lib/brand-affinity'
import type { WayReaction } from '@/lib/styled-ways-core'

export async function reactToWay(
  styledWayId: string,
  reaction: WayReaction,
  asMemberId?: string,
): Promise<{ lookId?: string; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const admin = createAdminClient() as any
  const { data: row } = await admin.from('styled_way')
    .select('styled_way_id, items, why, occasion_id, image_url, saved_look_id, reaction, stale')
    .eq('styled_way_id', styledWayId).eq('member_id', me.memberId).maybeSingle()
  if (!row) return { error: 'That outfit is no longer here' }
  const now = new Date().toISOString()

  if (reaction === 'dislike') {
    await admin.from('styled_way').update({ reaction, reacted_at: now, stale: true, stale_reason: 'disliked' }).eq('styled_way_id', styledWayId)
    const brands = Array.from(new Set(((row.items ?? []) as LookItem[]).map((it) => it.brand).filter((b): b is string => !!b)))
    if (brands.length) after(applyBrandSignals(admin, me.memberId, brands, 'no'))
    return {}
  }

  let lookId: string | undefined = row.saved_look_id ?? undefined
  if (!lookId) {
    const saved = await saveMyOutfit(row.items ?? [], row.why ?? '', row.occasion_id ?? null, asMemberId, { styledWayId, imageUrl: row.image_url ?? null })
    if (saved.error || !saved.lookId) return { error: saved.error ?? 'Could not save this outfit' }
    lookId = saved.lookId
  }
  await admin.from('styled_way').update({ reaction, reacted_at: now, saved_look_id: lookId }).eq('styled_way_id', styledWayId)
  // Teach her layer as a yes on a delivered look would: taste vector, brands, persona.
  after(recordMemberLookFeedback(lookId, 'yes', null, ''))
  return { lookId }
}

/** Has MYRA's picture of a saved look landed yet? */
export async function myLookImage(lookId: string, asMemberId?: string): Promise<{ imageUrl: string | null }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { imageUrl: null }
  const admin = createAdminClient() as any
  const { data } = await admin.from('pilot_look')
    .select('image_url, delivery:delivery_id!inner(member_id)')
    .eq('look_id', lookId).eq('delivery.member_id', me.memberId).maybeSingle()
  return { imageUrl: data?.image_url ?? null }
}
