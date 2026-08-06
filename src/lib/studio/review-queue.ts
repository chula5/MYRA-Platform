// The review queue — what /studio/review and the digest email both read.
//
// Two card kinds:
//   · REVIEW — pending outfits (draft / in_review) awaiting approve/reject.
//     Ordered fast-lane first (highest confidence first), then standard lane.
//   · RESTOCK — paused outfits whose dead item needs a manual pick (no auto
//     swap qualified and no render pending). Shown at the FRONT of the queue:
//     these were live and are losing feed time.
//
// Confidence is the composer's own coherence score (see studio/confidence);
// it's cached on outfit.review_confidence and refreshed here when missing.
// Composed group images build once and cache on outfit.composed_group_url.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import type { OutfitWithItems } from '@/types/database'
import { computeOutfitConfidence, laneFor, type ReviewLane } from './confidence'
import { refreshComposedGroup } from './composed-group'
import { outfitEntries } from './outfit-recompute'

export interface ReviewCard {
  kind: 'review' | 'restock'
  outfitId: string
  label: string
  occasionTags: string[]
  confidence: number
  lane: ReviewLane
  composedGroupUrl: string | null
  deadItemId: string | null // restock cards: the greyed-out item
  items: {
    outfitItemId: string
    itemId: string
    slot: string
    brand: string | null
    name: string
    price: string | null
    image: string | null
    dead: boolean
  }[]
}

const GROUP_BUILDS_PER_LOAD = 6 // composed groups are cached; cap fresh builds per request

function fmtPrice(price: unknown): string | null {
  if (price == null) return null
  const n = parseFloat(String(price).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? null : `£${Math.round(n)}`
}

async function toCard(
  outfit: OutfitWithItems,
  kind: 'review' | 'restock',
  buildBudget: { left: number },
): Promise<ReviewCard | null> {
  const entries = outfitEntries(outfit)
  if (entries.length < 2) return null
  const o = outfit as any

  const deadItemId: string | null =
    kind === 'restock' && typeof o.paused_reason === 'string' && o.paused_reason.startsWith('item_out_of_stock:')
      ? o.paused_reason.split(':')[1] ?? null
      : null

  let confidence: number = typeof o.review_confidence === 'number' ? o.review_confidence : NaN
  if (Number.isNaN(confidence)) {
    confidence = Number(computeOutfitConfidence(entries.map((e) => e.item)).toFixed(3))
    try {
      const admin = createAdminClient()
      await (admin.from('outfit') as any).update({ review_confidence: confidence }).eq('outfit_id', o.outfit_id)
    } catch { /* cache miss is fine */ }
  }

  let composedGroupUrl: string | null = o.composed_group_url ?? null
  if (!composedGroupUrl && buildBudget.left > 0) {
    buildBudget.left--
    composedGroupUrl = await refreshComposedGroup(
      o.outfit_id,
      entries.map((e) => ({ item: e.item, slot: e.slot, dimmed: e.item.item_id === deadItemId })),
    )
  }

  return {
    kind,
    outfitId: o.outfit_id,
    label: String(o.aesthetic_label ?? '').replace(/^COMPOSED\s*·\s*/i, '').trim() || 'UNTITLED',
    occasionTags: o.occasion_tags ?? [],
    confidence,
    lane: laneFor(confidence),
    composedGroupUrl,
    deadItemId,
    items: entries.map((e) => ({
      outfitItemId: e.outfit_item_id,
      itemId: e.item.item_id,
      slot: e.slot,
      brand: e.item.brand?.name ?? null,
      name: e.item.product_name,
      price: fmtPrice((e.item as any).price),
      image: e.item.image_url ?? null,
      dead: e.item.item_id === deadItemId,
    })),
  }
}

export async function loadReviewQueue(): Promise<ReviewCard[]> {
  const admin = createAdminClient()
  const buildBudget = { left: GROUP_BUILDS_PER_LOAD }

  // Pending outfits awaiting review.
  const { data: pendingRaw } = await admin
    .from('outfit' as any)
    .select('*, outfit_item(*, item(*, brand(*)))')
    .in('status', ['draft', 'in_review'])
    .order('created_at', { ascending: true })
    .limit(60)

  // Paused outfits needing a manual restock pick — skip ones with a render in
  // flight (those are auto-swapped and recovering on their own).
  const { data: pausedRaw } = await admin
    .from('outfit' as any)
    .select('*, outfit_item(*, item(*, brand(*)))')
    .eq('status', 'paused')
    .order('created_at', { ascending: true })
    .limit(30)
  const { data: pendingJobs } = await admin
    .from('render_job' as any)
    .select('outfit_id')
    .in('status', ['queued', 'running'])
  const rendering = new Set(((pendingJobs ?? []) as any[]).map((j) => j.outfit_id))

  const reviewCards: ReviewCard[] = []
  for (const raw of (pendingRaw ?? []) as unknown as OutfitWithItems[]) {
    const card = await toCard(raw, 'review', buildBudget)
    if (card) reviewCards.push(card)
  }

  const restockCards: ReviewCard[] = []
  for (const raw of (pausedRaw ?? []) as unknown as OutfitWithItems[]) {
    if (rendering.has((raw as any).outfit_id)) continue
    const card = await toCard(raw, 'restock', buildBudget)
    if (card) restockCards.push(card)
  }

  // Restock first (paused = lost feed time), then fast lane by confidence,
  // then standard lane by confidence.
  const fast = reviewCards.filter((c) => c.lane === 'fast').sort((a, b) => b.confidence - a.confidence)
  const standard = reviewCards.filter((c) => c.lane === 'standard').sort((a, b) => b.confidence - a.confidence)
  return [...restockCards, ...fast, ...standard]
}
