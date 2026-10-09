// The bridge from a Quality Lab review to the house's learning stores.
//
// Until now a YES/NO here wrote only to the Lab's own learning ledger, which
// nothing reads, so the stylist never got better from Chloe's reviews. This
// routes each decision into the SAME stores Outfit Review and the Composer
// teach — the Style Brain (per stylist), item ejections, and material
// pairings — so the next Start of a batch composes with what she just taught.
// Every call is best-effort: learning must never break a review.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import type { ItemWithBrand } from '@/lib/admin-queries'
import { slotForItemType } from '@/lib/composer'
import { toFeature } from '@/lib/pilot-composer'
import { toHouseItem } from '@/lib/house-item'
import { recordStyleDecision } from '@/lib/style-brain-store'
import { recordMaterialPairings } from '@/lib/house-style-store'
import { recordEjection } from '@/lib/pipeline-store'
import { computeSwapDeltas, formalityBand } from '@/lib/pipeline'

type Admin = ReturnType<typeof createAdminClient>

export interface LearningLook {
  /** The stylist whose model learns (the batch's selected stylist). */
  stylistId: string
  /** Every item id in the look, anchor included. */
  itemIds: string[]
  /** The lead garment, when known. */
  anchorItemId: string | null
}

export interface QualityLearningSink {
  /** YES — the whole combination is a positive signal. */
  approve(look: LearningLook): Promise<LearningOutcome>
  /** NO at look level — a soft negative on the combination. */
  rejectLook(look: LearningLook, reasonCode: string | null): Promise<LearningOutcome>
  /** NO with "this item breaks it" — an ejection of that piece against the anchor. */
  rejectItem(look: LearningLook, offendingItemId: string, reasonCode: string | null): Promise<LearningOutcome>
  /** A piece swapped out (toItemId) or removed (null) while editing. */
  swap(look: LearningLook, fromItemId: string, toItemId: string | null): Promise<LearningOutcome>
}

export type LearningOutcome = { ok: true } | { ok: false; warning: string }

const label = (it: ItemWithBrand) => [it.brand?.name, it.product_name].filter(Boolean).join(' — ') || String(it.item_type ?? 'item')

async function loadItems(admin: Admin, ids: string[]): Promise<Map<string, ItemWithBrand>> {
  const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, 16)
  if (unique.length === 0) return new Map()
  const { data, error } = await (admin as any).from('item').select('*, brand(*)').in('item_id', unique)
  if (error) throw new Error(`item read failed: ${error.message}`)
  return new Map(((data ?? []) as ItemWithBrand[]).map((r) => [r.item_id, r]))
}

function orderedLook(byId: Map<string, ItemWithBrand>, look: LearningLook): { anchor: ItemWithBrand | null; all: ItemWithBrand[] } {
  const all = look.itemIds.map((id) => byId.get(id)).filter((x): x is ItemWithBrand => !!x)
  const anchor = (look.anchorItemId ? byId.get(look.anchorItemId) : null) ?? all[0] ?? null
  // Anchor first — the Style Brain reads the first item as the anchor.
  const rest = all.filter((it) => it.item_id !== anchor?.item_id)
  return { anchor, all: anchor ? [anchor, ...rest] : rest }
}

export function createStyleBrainSink(admin: Admin = createAdminClient()): QualityLearningSink {
  const guard = async (fn: () => Promise<void>): Promise<LearningOutcome> => {
    try {
      await fn()
      return { ok: true }
    } catch (err) {
      return { ok: false, warning: `style learning failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  return {
    approve: (look) =>
      guard(async () => {
        const byId = await loadItems(admin, look.itemIds)
        const { anchor, all } = orderedLook(byId, look)
        if (all.length < 2) return
        await recordStyleDecision({
          items: all.map(toFeature),
          decision: 'approve',
          source: 'quality_lab',
          anchorItemId: anchor?.item_id ?? null,
          itemIds: all.map((it) => it.item_id),
          stylistId: look.stylistId,
        })
        await recordMaterialPairings(all.map((it) => toHouseItem(it)), 'approve')
      }),

    rejectLook: (look, reasonCode) =>
      guard(async () => {
        const byId = await loadItems(admin, look.itemIds)
        const { anchor, all } = orderedLook(byId, look)
        if (all.length < 2) return
        await recordStyleDecision({
          items: all.map(toFeature),
          decision: 'skip',
          source: 'quality_lab',
          anchorItemId: anchor?.item_id ?? null,
          itemIds: all.map((it) => it.item_id),
          extraFeatures: reasonCode ? { quality_reason: reasonCode } : undefined,
          stylistId: look.stylistId,
        })
      }),

    rejectItem: (look, offendingItemId, reasonCode) =>
      guard(async () => {
        const byId = await loadItems(admin, [...look.itemIds, offendingItemId])
        const { anchor, all } = orderedLook(byId, look)
        const offending = byId.get(offendingItemId)
        if (!offending) return
        // When the offending piece IS the anchor, the ejection is read against
        // the next piece so the pair still names two distinct items.
        const against = anchor && anchor.item_id !== offending.item_id ? anchor : all.find((it) => it.item_id !== offending.item_id) ?? null
        if (!against) return
        const band = formalityBand(all as any[])
        const slot = slotForItemType(offending.item_type)
        await Promise.all([
          recordStyleDecision({
            items: [toFeature(against), toFeature(offending)],
            decision: 'skip',
            source: 'quality_lab',
            anchorItemId: against.item_id,
            itemIds: [against.item_id, offending.item_id],
            extraFeatures: {
              swap: { action: 'remove', from: label(offending), to: null, fromType: offending.item_type, toType: null, changed: [], different: true, deltas: {}, slot, band },
              ...(reasonCode ? { quality_reason: reasonCode } : {}),
            },
            stylistId: look.stylistId,
          }),
          recordEjection({ itemId: offending.item_id, slot, band, occasion: null, anchorItemId: against.item_id, replacedBy: null, deltas: {} }),
        ])
        const others = all.filter((it) => it.item_id !== offending.item_id)
        if (others.length) {
          await recordMaterialPairings([toHouseItem(offending), ...others.map((it) => toHouseItem(it))].slice(0, 6), 'reject', offending.item_id)
        }
      }),

    swap: (look, fromItemId, toItemId) =>
      guard(async () => {
        const byId = await loadItems(admin, [...look.itemIds, fromItemId, ...(toItemId ? [toItemId] : [])])
        const { anchor, all } = orderedLook(byId, look)
        const from = byId.get(fromItemId)
        const to = toItemId ? byId.get(toItemId) ?? null : null
        if (!from) return
        const against = anchor && anchor.item_id !== from.item_id ? anchor : all.find((it) => it.item_id !== from.item_id) ?? null
        if (!against) return
        const changed: string[] = []
        if (to) {
          if (String(from.item_type) !== String(to.item_type)) changed.push('type')
          if ((from as any).colour_family !== (to as any).colour_family) changed.push('colour')
          if ((from.brand?.name ?? '') !== (to.brand?.name ?? '')) changed.push('brand')
        }
        const different = to ? changed.includes('type') || changed.length >= 2 : true
        const deltas = to ? computeSwapDeltas(from as any, to as any) : {}
        const band = formalityBand(all as any[])
        const slot = slotForItemType(from.item_type)
        await Promise.all([
          recordStyleDecision({
            items: [toFeature(against), toFeature(from)],
            decision: 'skip',
            source: 'swap',
            anchorItemId: against.item_id,
            itemIds: [against.item_id, from.item_id],
            extraFeatures: { swap: { action: to ? 'swap' : 'remove', from: label(from), to: to ? label(to) : null, fromType: from.item_type, toType: to?.item_type ?? null, changed, different, deltas, slot, band } },
            stylistId: look.stylistId,
          }),
          recordEjection({ itemId: from.item_id, slot, band, occasion: null, anchorItemId: against.item_id, replacedBy: to?.item_id ?? null, deltas }),
        ])
        const others = all.filter((it) => it.item_id !== from.item_id)
        if (others.length) {
          await recordMaterialPairings([toHouseItem(from), ...others.map((it) => toHouseItem(it))].slice(0, 6), 'reject', from.item_id)
        }
      }),
  }
}

/** A sink that learns nothing — for tests and non-training partitions. */
export const silentLearningSink: QualityLearningSink = {
  approve: async () => ({ ok: true }),
  rejectLook: async () => ({ ok: true }),
  rejectItem: async () => ({ ok: true }),
  swap: async () => ({ ok: true }),
}
