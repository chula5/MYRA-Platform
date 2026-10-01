// Server-only generation and checking adapters for the Outfit Quality Lab.
//
// These wrap the existing inventory, composer, size, stock, and look-check
// primitives behind the narrow interfaces the pure orchestration layer expects.
// They introduce NO Chloe fallback and change no production composer default:
// generation uses only the frozen snapshot's item-mask eligibility and the
// frozen context.

import 'server-only'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase-server'
import { getReadyAndLiveItems, type ItemWithBrand } from '@/lib/admin-queries'
import { generateCandidates } from '@/lib/composer'
import { slotForItemType, slotPlanForAnchor, type Slot } from '@/lib/composer'
import { sellable } from '@/lib/stock-sellable'
import { checkSizesForMember } from '@/lib/look-size-check'
import { checkLook, type CheckPiece } from '@/lib/look-check'
import {
  type CompositionGenerator,
  type ObjectiveEvidenceProvider,
  type SubjectiveChecker,
  type GeneratedCandidate,
  type GeneratedItem,
  type GenerationContext,
  type SubjectiveOutcome,
} from '@/lib/outfit-quality/candidate-generation'
import type { SnapshotPayload } from '@/lib/outfit-quality/stylist-snapshot'

type Admin = ReturnType<typeof createAdminClient>

function shortHash(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16)
}

function itemSnapshot(item: ItemWithBrand): Record<string, unknown> {
  return {
    item_id: item.item_id,
    item_type: item.item_type,
    brand: item.brand?.name ?? null,
    colour_family: item.colour_family ?? null,
    price_gbp: (item as any).price_gbp ?? null,
    image_url: item.image_url,
    retailer_url: item.retailer_url,
    status: item.status,
    stock_status: item.stock_status ?? null,
  }
}

function toGeneratedItems(anchor: ItemWithBrand, additions: { item: ItemWithBrand; slot: Slot }[]): GeneratedItem[] {
  const all: { item: ItemWithBrand; slot: Slot }[] = [{ item: anchor, slot: slotForItemType(anchor.item_type) }, ...additions]
  // Stable sort order follows the slot taxonomy order then item id.
  const slotOrder: Slot[] = ['outerwear', 'dress', 'top', 'bottom', 'shoe', 'bag', 'jewellery', 'accessory']
  all.sort((a, b) => {
    const d = slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot)
    return d !== 0 ? d : a.item.item_id.localeCompare(b.item.item_id)
  })
  return all.map(({ item, slot }, idx) => ({
    item_id: item.item_id,
    slot,
    sort_order: idx,
    item_snapshot: itemSnapshot(item),
    source_image_url: item.image_url,
    source_image_asset_version: null,
    source_image_hash: item.image_url ? shortHash(item.image_url) : null,
  }))
}

/**
 * The composition generator. Loads the shared retail pool, applies the frozen
 * snapshot's item-mask exclusions, and composes outfits with the existing
 * composer. Each distinct anchor yields one candidate until `count` is reached.
 */
export function createComposerGenerator(admin: Admin = createAdminClient()): CompositionGenerator {
  return {
    async generate({ count, snapshot }): Promise<GeneratedCandidate[]> {
      const payload = snapshot.payload as SnapshotPayload
      const excluded = new Set(
        (payload?.item_mask?.decisions ?? [])
          .filter((d) => d.eligibility === 'excluded')
          .map((d) => d.item_id),
      )
      const pool = (await getReadyAndLiveItems())
        .filter((it) => !!it.image_url && sellable(it) && !excluded.has(it.item_id))

      // Anchors are the "lead" garment of a look: a dress, top, or bottom.
      const anchors = pool.filter((it) => {
        const s = slotForItemType(it.item_type)
        return s === 'dress' || s === 'top' || s === 'bottom'
      })

      const out: GeneratedCandidate[] = []
      const usedSignatures = new Set<string>()
      for (const anchor of anchors) {
        if (out.length >= count) break
        const cands = generateCandidates({ anchor, library: pool, maxCandidates: 1, minScore: 0.5 })
        const best = cands[0]
        if (!best) continue
        const items = toGeneratedItems(anchor, best.items)
        const signature = items.map((i) => i.item_id).sort().join('|')
        if (usedSignatures.has(signature)) continue
        usedSignatures.add(signature)
        const anchorSlot = slotForItemType(anchor.item_type)
        const plan = slotPlanForAnchor(anchorSlot)
        out.push({ requiredSlots: Array.from(new Set([anchorSlot, ...plan.required])), items })
      }
      return out
    },
  }
}

/**
 * Objective evidence provider. Stock comes from the frozen item facts; size
 * possibility comes from the member's size profile for a real member, and is
 * left unconfirmed (fail-closed to unavailable) for an evaluation profile, which
 * carries no verifiable member size data. Nothing is ever manufactured as a pass.
 */
export function createObjectiveEvidenceProvider(admin: Admin = createAdminClient()): ObjectiveEvidenceProvider {
  return {
    async gather({ items, context }) {
      const stock: Record<string, boolean | 'unknown'> = {}
      for (const it of items) {
        const s = (it.item_snapshot?.stock_status as string | null | undefined) ?? null
        stock[it.item_id] = s == null ? 'unknown' : sellable({ stock_status: s })
      }

      let size: Record<string, 'in_size' | 'not_in_size' | 'unconfirmed'> | { error: true } | null = null
      if (context.realMemberId) {
        try {
          const pieces = items.map((it) => ({ item_id: it.item_id, item_type: it.item_snapshot?.item_type as string, owned: false }))
          const verdicts = await checkSizesForMember(admin as any, context.realMemberId, pieces as any, 'unknown')
          size = {}
          for (const it of items) {
            const v = verdicts.get(it.item_id)
            size[it.item_id] = v?.verdict ?? 'unconfirmed'
          }
        } catch {
          size = { error: true }
        }
      } else {
        // Evaluation profiles carry no verifiable per-item size availability.
        size = Object.fromEntries(items.map((it) => [it.item_id, 'unconfirmed' as const]))
      }

      return { size, stock }
    },
  }
}

/**
 * Subjective checker. Wraps the existing look check against a plain-text
 * description built from the FROZEN snapshot (never a fresh stylist read). An
 * unavailable or errored checker is reported as such — it is never a pass — and
 * every outcome still routes to awaiting_human upstream.
 */
export function createSubjectiveChecker(): SubjectiveChecker {
  return {
    async check({ snapshotId, payloadHash, manifest }): Promise<SubjectiveOutcome> {
      const pieces: CheckPiece[] = manifest.items.map((it) => ({
        image_url: it.source_image_url,
        item_type: (it.item_snapshot?.item_type as string) ?? null,
        product_name: (it.item_snapshot?.brand as string) ?? null,
      }))
      try {
        const result = await checkLook(pieces, 'Outfit Quality Lab subjective check against the frozen selected-stylist snapshot.')
        if (!result) {
          return { status: 'unavailable', model: 'claude-opus-5', prompt_version: 'quality-lab-subjective-v1' }
        }
        const status: SubjectiveOutcome['status'] = result.verdict === 'clashes' ? 'failed' : 'passed'
        const raw = shortHash(`${snapshotId}:${payloadHash}:${JSON.stringify(result)}`)
        return {
          status,
          verdict: result.verdict,
          score: typeof result.colourHarmony === 'number' ? result.colourHarmony : null,
          reasons: result,
          model: 'claude-opus-5',
          prompt_version: 'quality-lab-subjective-v1',
          raw_response_hash: raw,
        }
      } catch (err) {
        return { status: 'error', model: 'claude-opus-5', prompt_version: 'quality-lab-subjective-v1', reasons: { error: String(err).slice(0, 200) } }
      }
    },
  }
}
