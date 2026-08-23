// ── When a one-of-one sells ──────────────────────────────────────────────────
//
// A unique piece selling is not an out-of-stock event. It is permanent, and it
// has two completely different consequences:
//
//   PUBLIC FEED     every live outfit containing it is RETIRED — not paused,
//                   because pausing implies it might come back. Sibling
//                   variants in the same styling set that don't contain the
//                   sold piece carry on untouched.
//
//   SAVED OUTFITS   are NEVER silently removed from anyone's list. The card
//                   stays, full-colour, hero intact, and enters a rescue state.
//
// The rescue is deliberately cheap. ONE canonical restyle is computed per sold
// item — a like-for-like swap (black boot → black boot), everything else in the
// look identical — and rendered ONCE. Every user who saved that outfit sees the
// same restyled image. One sold item = one render, however many people saved it.
//
// The expensive, personalised layer only runs ON ENGAGEMENT: if she taps the
// restyle or the struck-through item, she gets 2-4 further alternatives as item
// cards with their own product photography, filtered to her size and ordered by
// her brand affinities — no render at all, unless she saves one.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { getOutfit, getReadyAndLiveItems, type ItemWithBrand } from '@/lib/admin-queries'
import { getSwapCandidates } from '@/lib/studio/swap-candidates'
import { loadStyleGuards } from '@/lib/studio/guards'
import { outfitEntries } from '@/lib/studio/outfit-recompute'
import { writeAudit } from '@/lib/studio/audit'
import { evaluateHouseStyle } from '@/lib/house-style'
import { toHouseItem } from '@/lib/house-item'
import { itemCosine } from '@/lib/studio/confidence'
import { slotForItemType } from '@/lib/composer'
import { isUnique } from '@/lib/second-hand'
import { raiseUniqueSoldAlerts, emitAlert } from '@/lib/stock-alerts'
import {
  loadUserSizeProfile, loadSizeRowsFor, type ShopperSizeContext,
} from '@/lib/size-availability'
import { passesSizeGate } from '@/lib/size-match'

export type RescueState = 'pending' | 'rendering' | 'ready' | 'queued_for_review' | 'failed'

export interface RescueRow {
  rescue_id: string
  outfit_id: string
  sold_item_id: string
  slot: string
  replacement_item_id: string | null
  similarity: number | null
  state: RescueState
  restyled_image_url: string | null
  note: string | null
}

/** How many further alternatives the engagement layer offers. */
export const ALTERNATIVE_MIN = 2
export const ALTERNATIVE_MAX = 4

// ── 1. The sale ──────────────────────────────────────────────────────────────

export interface SoldReport {
  itemId: string
  outfitsRetired: number
  rescuesCreated: number
  usersNotified: number
}

/**
 * Mark a one-of-one sold and run every consequence.
 *
 * Idempotent: an item already at status 'sold' returns immediately, so a
 * webhook and the following feed pull can't retire the same outfits twice or
 * queue a second render.
 */
export async function markUniqueSold(
  itemId: string,
  signal: 'feed' | 'webhook' | 'poll' | 'manual',
): Promise<SoldReport> {
  const admin = createAdminClient()
  const report: SoldReport = { itemId, outfitsRetired: 0, rescuesCreated: 0, usersNotified: 0 }

  const { data: item } = await admin
    .from('item' as any)
    .select('item_id, product_name, status, stock_class, live_since, brand_id, merchant_id, item_type')
    .eq('item_id', itemId)
    .maybeSingle()
  if (!item) return report
  if ((item as any).status === 'sold') return report

  const now = new Date().toISOString()
  await (admin.from('item') as any)
    .update({
      status: 'sold',
      sold_at: now,
      sold_signal: signal,
      stock_status: 'out_of_stock',
      stock_checked_at: now,
      // Never checked again: no restock watch, no strikes, no next_check_at.
      next_check_at: null,
      poll_tier: null,
    })
    .eq('item_id', itemId)

  await recordSale(item as any, now)
  await writeAudit({
    action: 'unique_sold', entity: 'item', entityId: itemId,
    trigger: signal === 'webhook' ? 'webhook' : 'stock_sentinel',
    before: { status: (item as any).status }, after: { status: 'sold', signal },
  })

  // ── PUBLIC FEED: retire, don't pause ──
  const { data: liveLinks } = await admin
    .from('outfit_item' as any)
    .select('outfit_id, outfit!inner(status)')
    .eq('item_id', itemId)
    .eq('outfit.status', 'live')
  const liveOutfitIds = Array.from(new Set(((liveLinks ?? []) as any[]).map((r) => r.outfit_id)))
  if (liveOutfitIds.length) {
    await (admin.from('outfit') as any)
      .update({ status: 'retired', retired_reason: `unique_item_sold:${itemId}`, retired_at: now })
      .in('outfit_id', liveOutfitIds)
      .eq('status', 'live')
    report.outfitsRetired = liveOutfitIds.length
    for (const id of liveOutfitIds) {
      await writeAudit({
        action: 'retire', entity: 'outfit', entityId: id,
        trigger: 'stock_sentinel', before: { status: 'live' }, after: { status: 'retired', soldItem: itemId },
      })
    }
  }

  // ── SAVED OUTFITS: one canonical restyle each, whatever their status ──
  const { data: allLinks } = await admin
    .from('outfit_item' as any)
    .select('outfit_id')
    .eq('item_id', itemId)
  const allOutfitIds = Array.from(new Set(((allLinks ?? []) as any[]).map((r) => r.outfit_id)))
  const savedOutfitIds = await outfitsSavedByAnyone(allOutfitIds)

  const guards = await loadStyleGuards()
  const library = await getReadyAndLiveItems()
  for (const outfitId of savedOutfitIds) {
    const rescue = await computeRescue(outfitId, itemId, { guards, library })
    if (rescue) report.rescuesCreated++
  }

  report.usersNotified = await raiseUniqueSoldAlerts(itemId)
  return report
}

async function outfitsSavedByAnyone(outfitIds: string[]): Promise<string[]> {
  if (!outfitIds.length) return []
  const admin = createAdminClient()
  const { data } = await admin
    .from('saved_outfit' as any)
    .select('outfit_id')
    .in('outfit_id', outfitIds)
  return Array.from(new Set(((data ?? []) as any[]).map((r) => r.outfit_id)))
}

async function recordSale(item: any, soldAt: string): Promise<void> {
  const admin = createAdminClient()
  try {
    const [{ count: clickouts }, { count: saves }] = await Promise.all([
      admin.from('item_click' as any).select('*', { count: 'exact', head: true }).eq('item_id', item.item_id),
      admin.from('saved_item' as any).select('*', { count: 'exact', head: true }).eq('item_id', item.item_id),
    ])
    const listedAt = item.live_since ?? null
    const daysLive = listedAt
      ? (new Date(soldAt).getTime() - new Date(listedAt).getTime()) / 86_400_000
      : null
    await (admin.from('second_hand_sale') as any).upsert(
      {
        item_id: item.item_id,
        merchant_id: item.merchant_id ?? null,
        brand_id: item.brand_id ?? null,
        listed_at: listedAt,
        sold_at: soldAt,
        days_live: daysLive != null ? Number(daysLive.toFixed(2)) : null,
        clickouts: clickouts ?? 0,
        saves: saves ?? 0,
      },
      { onConflict: 'item_id' },
    )
  } catch (err) {
    // Reporting is not worth failing a sale over.
    console.error('[recordSale]', err)
  }
}

// ── 2. The canonical restyle ─────────────────────────────────────────────────

/**
 * ONE best replacement for the sold slot, shared by every user who saved this
 * outfit. Everything else in the look stays identical — this is a like-for-like
 * swap, not a recomposition.
 *
 * The replacement must be REPLENISHABLE. A unique replacement would be hidden
 * from most savers by the size gate and could sell again next week, and the
 * whole point of the canonical restyle is that one render serves everyone.
 *
 * If nothing passes the constitution we do NOT render: the card shows the
 * intact look with "we'll restyle this when we find the right replacement" and
 * the rescue is queued for Chloe.
 */
export async function computeRescue(
  outfitId: string,
  soldItemId: string,
  preloaded?: { guards?: Awaited<ReturnType<typeof loadStyleGuards>>; library?: ItemWithBrand[] },
): Promise<RescueRow | null> {
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('outfit_rescue' as any)
    .select('*')
    .eq('outfit_id', outfitId)
    .eq('sold_item_id', soldItemId)
    .maybeSingle()
  if (existing) return existing as unknown as RescueRow

  const outfit = await getOutfit(outfitId)
  if (!outfit) return null
  const entries = outfitEntries(outfit)
  const soldEntry = entries.find((e) => e.item.item_id === soldItemId)
  if (!soldEntry) return null
  const remaining = entries.filter((e) => e.item.item_id !== soldItemId)

  const guards = preloaded?.guards ?? (await loadStyleGuards())
  const library = preloaded?.library ?? (await getReadyAndLiveItems())

  const candidates = await getSwapCandidates({
    outgoing: soldEntry.item,
    remaining: remaining.map((e) => e.item),
    anchorItemId: entries[0]?.item.item_id ?? null,
    limit: 24,
    guards,
    library,
  })

  const occasion = ((outfit as any).occasion_tags ?? [])[0] ?? null
  const passesConstitution = (candidate: ItemWithBrand): boolean => {
    const items = [
      ...remaining.map((e) => toHouseItem(e.item, e.slot)),
      toHouseItem(candidate, soldEntry.slot),
    ]
    return evaluateHouseStyle(items, { occasion }).pass
  }

  // Same category and colour family where possible: sort by (same type, same
  // colour family, similarity) so a like-for-like always wins a merely-similar
  // piece, then take the first that clears the constitution.
  const ranked = candidates
    .filter((c) => !isUnique(c.item as any))
    .sort((a, b) =>
      Number(b.sameType) - Number(a.sameType) ||
      Number(b.sameColourFamily) - Number(a.sameColourFamily) ||
      b.similarity - a.similarity,
    )
  const chosen = ranked.find((c) => passesConstitution(c.item)) ?? null

  const { data: created } = await (admin.from('outfit_rescue') as any)
    .insert({
      outfit_id: outfitId,
      sold_item_id: soldItemId,
      slot: soldEntry.slot,
      replacement_item_id: chosen?.item.item_id ?? null,
      similarity: chosen?.similarity ?? null,
      state: chosen ? 'pending' : 'queued_for_review',
      note: chosen ? null : 'No replacement passed the constitution — needs a human eye.',
    })
    .select('*')
    .single()

  const rescue = created as unknown as RescueRow | null
  if (!rescue) return null

  if (chosen) {
    await enqueueRescueRender(rescue.rescue_id, outfitId)
  } else {
    await writeAudit({
      action: 'rescue_needs_review', entity: 'outfit', entityId: outfitId,
      trigger: 'stock_sentinel', after: { soldItem: soldItemId },
    })
  }

  // Tell everyone who saved this look, once.
  const savers = await saversOf(outfitId)
  for (const userId of savers) {
    await emitAlert({
      userId, itemId: soldItemId, outfitId,
      kind: 'restyled', priority: 'batch',
    })
  }

  return rescue
}

async function saversOf(outfitId: string): Promise<string[]> {
  const admin = createAdminClient()
  const { data } = await admin.from('saved_outfit' as any).select('user_id').eq('outfit_id', outfitId)
  return ((data ?? []) as any[]).map((r) => r.user_id)
}

async function enqueueRescueRender(rescueId: string, outfitId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job } = await (admin.from('render_job') as any)
    .insert({ outfit_id: outfitId, trigger: 'rescue', priority: 2, rescue_id: rescueId })
    .select('job_id')
    .single()
  await (admin.from('outfit_rescue') as any)
    .update({ state: 'rendering', render_job_id: (job as any)?.job_id ?? null, updated_at: new Date().toISOString() })
    .eq('rescue_id', rescueId)
}

// ── 3. The engagement layer ──────────────────────────────────────────────────

export interface AlternativeCard {
  alternative_id: string
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string | null
  price: string | null
  currency: string | null
  retailer_url: string | null
  similarity: number | null
  rendered_image_url: string | null
}

/**
 * 2-4 further alternatives for the sold slot, computed on FIRST engagement and
 * cached against the rescue. The per-user work is only the filtering: the
 * candidate set is shared, then narrowed to her size and reordered by her brand
 * affinities, so two users engaging see the same pool ranked for each of them.
 */
export async function alternativesFor(
  rescueId: string,
  userId: string | null,
): Promise<AlternativeCard[]> {
  const admin = createAdminClient()
  const { data: rescue } = await admin
    .from('outfit_rescue' as any)
    .select('*')
    .eq('rescue_id', rescueId)
    .maybeSingle()
  if (!rescue) return []

  let { data: rows } = await admin
    .from('rescue_alternative' as any)
    .select('*, item(item_id, brand_id, product_name, image_url, price, currency, retailer_url, item_type, stock_class, status, brand(name, source_type))')
    .eq('rescue_id', rescueId)
    .order('rank', { ascending: true })

  if (!rows || rows.length === 0) {
    await buildAlternatives(rescue as any)
    const refreshed = await admin
      .from('rescue_alternative' as any)
      .select('*, item(item_id, brand_id, product_name, image_url, price, currency, retailer_url, item_type, stock_class, status, brand(name, source_type))')
      .eq('rescue_id', rescueId)
      .order('rank', { ascending: true })
    rows = refreshed.data
  }

  const all = ((rows ?? []) as any[]).filter((r) => r.item && r.item.status !== 'sold')
  if (!userId) return all.slice(0, ALTERNATIVE_MAX).map(toCard)

  // Filtered to HER size and ordered by her brand affinities.
  const ctx = await loadUserSizeProfile(userId)
  const sizeRows = await loadSizeRowsFor(all.map((r) => r.item_id))
  const inHerSize = all.filter((r) =>
    passesSizeGate(r.item, sizeRows.get(r.item_id) ?? [], ctx.profile, { strict: true }),
  )
  const consented = inHerSize.filter(
    (r) => ctx.acceptsSecondHand || (r.item.brand?.source_type ?? 'retail') === 'retail',
  )
  const affinities = await brandAffinityMap(userId)
  const ordered = consented.sort(
    (a, b) =>
      (affinities.get(b.item.brand_id) ?? 0) - (affinities.get(a.item.brand_id) ?? 0) ||
      (b.similarity ?? 0) - (a.similarity ?? 0),
  )
  return ordered.slice(0, ALTERNATIVE_MAX).map(toCard)
}

function toCard(r: any): AlternativeCard {
  return {
    alternative_id: r.alternative_id,
    item_id: r.item_id,
    product_name: r.item?.product_name ?? '',
    brand_name: r.item?.brand?.name ?? null,
    image_url: r.item?.image_url ?? null,
    price: r.item?.price ?? null,
    currency: r.item?.currency ?? null,
    retailer_url: r.item?.retailer_url ?? null,
    similarity: r.similarity,
    rendered_image_url: r.rendered_image_url ?? null,
  }
}

/** Compute and cache the shared alternative pool for a rescue. */
async function buildAlternatives(rescue: RescueRow): Promise<void> {
  const admin = createAdminClient()
  const outfit = await getOutfit(rescue.outfit_id)
  if (!outfit) return
  const entries = outfitEntries(outfit)
  const soldEntry = entries.find((e) => e.item.item_id === rescue.sold_item_id)
  if (!soldEntry) return
  const remaining = entries.filter((e) => e.item.item_id !== rescue.sold_item_id)

  const guards = await loadStyleGuards()
  const library = await getReadyAndLiveItems()
  const candidates = await getSwapCandidates({
    outgoing: soldEntry.item,
    remaining: remaining.map((e) => e.item),
    anchorItemId: entries[0]?.item.item_id ?? null,
    limit: 40,
    guards,
    library,
  })

  const occasion = ((outfit as any).occasion_tags ?? [])[0] ?? null
  // A generous pool: the per-user size filter will thin it, so 12 shared
  // candidates is what makes 2-4 personal ones reliably available.
  const pool = candidates
    .filter((c) => c.item.item_id !== rescue.replacement_item_id)
    .filter((c) =>
      evaluateHouseStyle(
        [...remaining.map((e) => toHouseItem(e.item, e.slot)), toHouseItem(c.item, rescue.slot)],
        { occasion },
      ).pass,
    )
    .slice(0, 12)

  if (!pool.length) return
  await (admin.from('rescue_alternative') as any).upsert(
    pool.map((c, i) => ({
      rescue_id: rescue.rescue_id,
      item_id: c.item.item_id,
      similarity: c.similarity,
      rank: i,
    })),
    { onConflict: 'rescue_id,item_id' },
  )
}

/** brand_id → her affinity, from the brand-affinity graph (migration 0032). */
async function brandAffinityMap(userId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('user_brand_affinity' as any)
      .select('brand_id, affinity, hidden')
      .eq('user_id', userId)
    for (const r of (data ?? []) as any[]) {
      if (r.hidden) continue
      out.set(r.brand_id, Number(r.affinity ?? 0))
    }
  } catch {
    // No affinity data yet — similarity ordering alone is a fine fallback.
  }
  return out
}

/** She engaged. Record it so her card is stable, and return her alternatives. */
export async function engageRescue(userId: string, rescueId: string): Promise<AlternativeCard[]> {
  try {
    const admin = createAdminClient()
    await (admin.from('rescue_choice') as any).upsert(
      { user_id: userId, rescue_id: rescueId, engaged_at: new Date().toISOString() },
      { onConflict: 'user_id,rescue_id' },
    )
  } catch (err) {
    console.error('[engageRescue]', err)
  }
  return alternativesFor(rescueId, userId)
}

/**
 * She saved one of the alternatives. THIS is the only thing that buys a second
 * render — and it's cached on the alternative, so the next user who picks the
 * same piece reuses it rather than paying for it again.
 */
export async function chooseAlternative(
  userId: string,
  rescueId: string,
  alternativeId: string,
): Promise<{ queued: boolean; imageUrl: string | null }> {
  const admin = createAdminClient()
  await (admin.from('rescue_choice') as any).upsert(
    { user_id: userId, rescue_id: rescueId, alternative_id: alternativeId, engaged_at: new Date().toISOString() },
    { onConflict: 'user_id,rescue_id' },
  )

  const { data: alt } = await admin
    .from('rescue_alternative' as any)
    .select('alternative_id, rendered_image_url, render_job_id, rescue_id')
    .eq('alternative_id', alternativeId)
    .maybeSingle()
  if (!alt) return { queued: false, imageUrl: null }
  if ((alt as any).rendered_image_url) return { queued: false, imageUrl: (alt as any).rendered_image_url }
  if ((alt as any).render_job_id) return { queued: true, imageUrl: null }

  const { data: rescue } = await admin
    .from('outfit_rescue' as any)
    .select('outfit_id')
    .eq('rescue_id', rescueId)
    .maybeSingle()
  if (!rescue) return { queued: false, imageUrl: null }

  const { data: job } = await (admin.from('render_job') as any)
    .insert({
      outfit_id: (rescue as any).outfit_id,
      trigger: 'rescue_alternative',
      priority: 3,
      rescue_id: rescueId,
      alternative_id: alternativeId,
    })
    .select('job_id')
    .single()
  await (admin.from('rescue_alternative') as any)
    .update({ render_job_id: (job as any)?.job_id ?? null })
    .eq('alternative_id', alternativeId)
  return { queued: true, imageUrl: null }
}

// ── 4. Reading the rescue state ──────────────────────────────────────────────

export interface SavedOutfitRescue {
  outfit_id: string
  rescue_id: string
  sold_item_id: string
  slot: string
  state: RescueState
  /** The shared restyled hero, when one exists. */
  restyled_image_url: string | null
  replacement_item_id: string | null
  note: string | null
  /** Her own pick from the engagement layer, if she made one. */
  chosen_alternative_id: string | null
  chosen_image_url: string | null
}

/**
 * Rescue state for every saved outfit of a user's, keyed by outfit id.
 *
 * Per-user size awareness lives here: if the canonical replacement isn't
 * available in HER size, we don't show her an unbuyable restyle — her card
 * falls back to the intact look and the engagement layer picks it up.
 */
export async function rescuesForUser(
  userId: string,
  outfitIds: string[],
  ctx?: ShopperSizeContext,
): Promise<Map<string, SavedOutfitRescue>> {
  const out = new Map<string, SavedOutfitRescue>()
  if (!outfitIds.length) return out
  const admin = createAdminClient()

  const { data: rescues } = await admin
    .from('outfit_rescue' as any)
    .select('*')
    .in('outfit_id', outfitIds)
  const rows = (rescues ?? []) as any[]
  if (!rows.length) return out

  const { data: choices } = await admin
    .from('rescue_choice' as any)
    .select('rescue_id, alternative_id, rescue_alternative(rendered_image_url)')
    .eq('user_id', userId)
    .in('rescue_id', rows.map((r) => r.rescue_id))
  const choiceBy = new Map(((choices ?? []) as any[]).map((c) => [c.rescue_id, c]))

  // Is the canonical replacement buyable by HER?
  const sizes = ctx ?? (await loadUserSizeProfile(userId))
  const replacementIds = rows.map((r) => r.replacement_item_id).filter(Boolean)
  const sizeRows = await loadSizeRowsFor(replacementIds)
  const replacementItems = replacementIds.length
    ? ((await admin
        .from('item' as any)
        .select('item_id, item_type, stock_class, status')
        .in('item_id', replacementIds)).data ?? [])
    : []
  const itemBy = new Map(((replacementItems ?? []) as any[]).map((i) => [i.item_id, i]))

  for (const r of rows) {
    const choice = choiceBy.get(r.rescue_id)
    let restyled = r.restyled_image_url as string | null
    if (restyled && r.replacement_item_id) {
      const item = itemBy.get(r.replacement_item_id)
      const buyable =
        item &&
        item.status !== 'sold' &&
        passesSizeGate(item, sizeRows.get(r.replacement_item_id) ?? [], sizes.profile, { strict: true })
      // Not in her size → don't show her a restyle she can't buy. The
      // engagement layer offers her something she can.
      if (!buyable) restyled = null
    }
    out.set(r.outfit_id, {
      outfit_id: r.outfit_id,
      rescue_id: r.rescue_id,
      sold_item_id: r.sold_item_id,
      slot: r.slot,
      state: r.state,
      restyled_image_url: restyled,
      replacement_item_id: r.replacement_item_id,
      note: r.note,
      chosen_alternative_id: choice?.alternative_id ?? null,
      chosen_image_url: choice?.rescue_alternative?.rendered_image_url ?? null,
    })
  }
  return out
}

/** Rescues waiting on Chloe — nothing passed the constitution. */
export async function rescueReviewQueue(limit = 50): Promise<any[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('outfit_rescue' as any)
    .select('*, outfit(outfit_id, aesthetic_label, image_url), item:sold_item_id(product_name, image_url, brand(name))')
    .eq('state', 'queued_for_review')
    .order('created_at', { ascending: true })
    .limit(limit)
  return (data ?? []) as any[]
}

/** Manual override: Chloe picks the replacement herself and it renders like any other. */
export async function setRescueReplacement(
  rescueId: string,
  itemId: string,
): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient()
    const { data: rescue } = await admin
      .from('outfit_rescue' as any)
      .select('rescue_id, outfit_id, sold_item_id')
      .eq('rescue_id', rescueId)
      .maybeSingle()
    if (!rescue) return { error: 'Rescue not found' }

    const outfit = await getOutfit((rescue as any).outfit_id)
    const entries = outfit ? outfitEntries(outfit) : []
    const sold = entries.find((e) => e.item.item_id === (rescue as any).sold_item_id)
    const replacement = (await getReadyAndLiveItems()).find((i) => i.item_id === itemId)
    const similarity = sold && replacement ? Number(itemCosine(sold.item, replacement).toFixed(4)) : null

    await (admin.from('outfit_rescue') as any)
      .update({
        replacement_item_id: itemId,
        similarity,
        state: 'pending',
        note: 'Replacement chosen by hand.',
        updated_at: new Date().toISOString(),
      })
      .eq('rescue_id', rescueId)
    await enqueueRescueRender(rescueId, (rescue as any).outfit_id)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not set the replacement' }
  }
}

/** The item set a rescue render should depict: the outfit with the swap applied. */
export async function rescueShootItems(
  rescueId: string,
  alternativeId?: string | null,
): Promise<{ outfitId: string; items: { item: ItemWithBrand; slot: string }[] } | null> {
  const admin = createAdminClient()
  const { data: rescue } = await admin
    .from('outfit_rescue' as any)
    .select('rescue_id, outfit_id, sold_item_id, slot, replacement_item_id')
    .eq('rescue_id', rescueId)
    .maybeSingle()
  if (!rescue) return null

  let replacementId = (rescue as any).replacement_item_id as string | null
  if (alternativeId) {
    const { data: alt } = await admin
      .from('rescue_alternative' as any)
      .select('item_id')
      .eq('alternative_id', alternativeId)
      .maybeSingle()
    replacementId = (alt as any)?.item_id ?? replacementId
  }
  if (!replacementId) return null

  const outfit = await getOutfit((rescue as any).outfit_id)
  if (!outfit) return null
  const { data: replacement } = await admin
    .from('item' as any)
    .select('*, brand(*)')
    .eq('item_id', replacementId)
    .maybeSingle()
  if (!replacement) return null

  const items = outfitEntries(outfit).map((e) =>
    e.item.item_id === (rescue as any).sold_item_id
      ? { item: replacement as unknown as ItemWithBrand, slot: (rescue as any).slot as string }
      : { item: e.item, slot: e.slot as string },
  )
  return { outfitId: (rescue as any).outfit_id, items }
}

/** Slot label for the struck-through row, when the outfit link is gone. */
export const slotOf = (item: ItemWithBrand): string => slotForItemType(item.item_type)
