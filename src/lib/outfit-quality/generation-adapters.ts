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
import { loadSizeRowsFor } from '@/lib/size-availability'
import { resolveAvailability } from '@/lib/size-match'
import { sizeCategoryFor, type SizeProfile } from '@/lib/size-canonical'
import {
  profileFactsFromContext,
  buildSizeProfile,
  hasAnySize,
  keepForProfileSize,
  profileItemAffinity,
  parsePriceGbp,
  type AffinityItemFacts,
} from '@/lib/outfit-quality/profile-context'
import {
  type CompositionGenerator,
  type ObjectiveEvidenceProvider,
  type SubjectiveChecker,
  type GeneratedCandidate,
  type GeneratedItem,
  type GenerationContext,
  type SubjectiveOutcome,
} from '@/lib/outfit-quality/candidate-generation'
import { SNAPSHOT_SYSTEM_VERSIONS, type SnapshotPayload, type SystemVersions } from '@/lib/outfit-quality/stylist-snapshot'
import { buildSubjectiveCheckPrompt } from '@/lib/outfit-quality/subjective-prompt'

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

/**
 * Freeze one live item row into a generated candidate item at a given slot and
 * sort position. Used by the composer adapter and by the edit path, so both
 * write identically-shaped frozen item facts.
 */
export function generatedItemFromRow(item: ItemWithBrand, slot: string, sortOrder: number): GeneratedItem {
  return {
    item_id: item.item_id,
    slot,
    sort_order: sortOrder,
    item_snapshot: itemSnapshot(item),
    source_image_url: item.image_url,
    source_image_asset_version: null,
    source_image_hash: item.image_url ? shortHash(item.image_url) : null,
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

function affinityFacts(it: ItemWithBrand): AffinityItemFacts {
  return {
    item_type: it.item_type,
    price_gbp: parsePriceGbp((it as any).price ?? (it as any).price_gbp ?? null),
    brand_price_tier: it.brand?.price_tier ?? null,
    colour_family: it.colour_family ?? null,
    material_formality: it.material_formality ?? null,
    pattern: it.pattern ?? null,
  }
}

/**
 * Gate the pool to the evaluation profile's declared clothing/shoe sizes.
 * Genuinely unsized pieces always survive; a sized piece survives only when it
 * is confirmed available in the profile's size (exact or a listed adjacent).
 * This is what makes a profile batch's sized garments/shoes objective-pass,
 * while anything with unknown or out-of-range sizing is left out of generation
 * (and would fail closed if checked anyway).
 */
async function gateToProfileSizes(
  admin: Admin,
  pool: ItemWithBrand[],
  sizeProfile: SizeProfile,
): Promise<ItemWithBrand[]> {
  const sizedIds = pool.filter((it) => sizeCategoryFor(it.item_type) != null).map((it) => it.item_id)
  const rows = await loadSizeRowsFor(sizedIds)
  return pool.filter((it) => {
    const applicable = sizeCategoryFor(it.item_type) != null
    if (!applicable) return true
    const a = resolveAvailability(it as any, rows.get(it.item_id) ?? [], sizeProfile)
    return keepForProfileSize(true, a.quality)
  })
}

/**
 * The composition generator. Loads the shared retail pool, applies the frozen
 * snapshot's item-mask exclusions, and composes outfits with the existing
 * composer. For an evaluation-profile context it additionally applies the
 * FROZEN profile context: a hard size gate to the profile's declared sizes, and
 * a budget/brand/occasion/style ranking nudge on the composer shortlist. Each
 * distinct anchor yields one candidate until `count` is reached.
 */
export function createComposerGenerator(admin: Admin = createAdminClient()): CompositionGenerator {
  return {
    async generate({ count, snapshot, context }): Promise<GeneratedCandidate[]> {
      const payload = snapshot.payload as SnapshotPayload
      const excluded = new Set(
        (payload?.item_mask?.decisions ?? [])
          .filter((d) => d.eligibility === 'excluded')
          .map((d) => d.item_id),
      )
      let pool = (await getReadyAndLiveItems())
        .filter((it) => !!it.image_url && sellable(it) && !excluded.has(it.item_id))

      // Apply the frozen evaluation-profile context to selection and ranking.
      const facts = profileFactsFromContext(context.contextSnapshot)
      let shortlistAdjust: ((item: ItemWithBrand) => number) | undefined
      if (facts) {
        const sizeProfile = buildSizeProfile(facts.size_profile)
        if (hasAnySize(sizeProfile)) {
          pool = await gateToProfileSizes(admin, pool, sizeProfile)
        }
        shortlistAdjust = (item) => profileItemAffinity(facts, affinityFacts(item))
      }

      // Anchors are the "lead" garment of a look: a dress, top, or bottom.
      const anchors = pool.filter((it) => {
        const s = slotForItemType(it.item_type)
        return s === 'dress' || s === 'top' || s === 'bottom'
      })

      const out: GeneratedCandidate[] = []
      const usedSignatures = new Set<string>()
      for (const anchor of anchors) {
        if (out.length >= count) break
        const cands = generateCandidates({ anchor, library: pool, maxCandidates: 1, minScore: 0.5, shortlistAdjust })
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

type SizeMap = Record<string, 'in_size' | 'not_in_size' | 'unconfirmed' | 'not_applicable'>

/**
 * Objective evidence provider. Stock comes from the frozen item facts. Size
 * possibility is resolved against:
 *
 *   * a real member's size profile (the retailer-checked verdict), or
 *   * the evaluation profile's declared clothing/shoe sizes.
 *
 * Genuinely unsized categories (bags, jewellery, accessories) are reported
 * `not_applicable` so they never gate. A sized garment or shoe with no usable
 * size evidence stays `unconfirmed` — the objective check fails that closed, it
 * is never manufactured as a pass.
 */
export function createObjectiveEvidenceProvider(admin: Admin = createAdminClient()): ObjectiveEvidenceProvider {
  return {
    async gather({ items, context }) {
      const stock: Record<string, boolean | 'unknown'> = {}
      for (const it of items) {
        const s = (it.item_snapshot?.stock_status as string | null | undefined) ?? null
        stock[it.item_id] = s == null ? 'unknown' : sellable({ stock_status: s })
      }

      let size: SizeMap | { error: true } | null = null
      if (context.realMemberId) {
        try {
          const pieces = items.map((it) => ({ item_id: it.item_id, item_type: it.item_snapshot?.item_type as string, owned: false }))
          const verdicts = await checkSizesForMember(admin as any, context.realMemberId, pieces as any, 'unknown')
          size = {}
          for (const it of items) {
            const applicable = sizeCategoryFor(it.item_snapshot?.item_type as string) != null
            if (!applicable) { size[it.item_id] = 'not_applicable'; continue }
            size[it.item_id] = verdicts.get(it.item_id)?.verdict ?? 'unconfirmed'
          }
        } catch {
          size = { error: true }
        }
      } else {
        // Evaluation profile: resolve each sized piece against the profile's own
        // declared sizes; unsized pieces are not-applicable.
        const facts = profileFactsFromContext(context.contextSnapshot)
        const sizeProfile = facts ? buildSizeProfile(facts.size_profile) : {}
        const sizedIds = items.filter((it) => sizeCategoryFor(it.item_snapshot?.item_type as string) != null).map((it) => it.item_id)
        let rows = new Map<string, any[]>()
        try {
          if (hasAnySize(sizeProfile) && sizedIds.length) rows = await loadSizeRowsFor(sizedIds)
        } catch {
          return { size: { error: true }, stock }
        }
        size = {}
        for (const it of items) {
          const cat = sizeCategoryFor(it.item_snapshot?.item_type as string)
          if (cat == null) { size[it.item_id] = 'not_applicable'; continue }
          if (!hasAnySize(sizeProfile)) { size[it.item_id] = 'unconfirmed'; continue }
          const a = resolveAvailability({ item_type: it.item_snapshot?.item_type as string } as any, rows.get(it.item_id) ?? [], sizeProfile)
          size[it.item_id] = a.quality === 'full' || a.quality === 'acceptable' ? 'in_size' : a.quality === 'none' ? 'not_in_size' : 'unconfirmed'
        }
      }

      return { size, stock }
    },
  }
}

/**
 * Subjective checker. Wraps the existing look check, with the stylist lens
 * built from the FROZEN snapshot payload (constitution, brief, rules, learned
 * model summary, inspiration summary) — never a fresh stylist read, so machine
 * review sees exactly the lens generation used. The recorded model and prompt
 * version are the ones frozen into that snapshot. An unavailable or errored
 * checker is reported as such — it is never a pass — and every outcome still
 * routes to awaiting_human upstream.
 */
export function createSubjectiveChecker(): SubjectiveChecker {
  return {
    async check({ snapshotId, payloadHash, snapshotPayload, manifest }): Promise<SubjectiveOutcome> {
      const payload = snapshotPayload as SnapshotPayload | null
      const frozen: SystemVersions = payload?.system_versions ?? SNAPSHOT_SYSTEM_VERSIONS
      const model = frozen.subjective_check_model
      const promptVersion = frozen.subjective_prompt_version
      // Fail closed: an unusable frozen payload is an error, never a pass.
      if (!payload || !payload.stylist || !payload.brief) {
        return { status: 'error', model, prompt_version: promptVersion, reasons: { error: 'frozen snapshot payload missing or malformed' } }
      }
      const stylistLens = buildSubjectiveCheckPrompt(payload)
      const pieces: CheckPiece[] = manifest.items.map((it) => ({
        image_url: it.source_image_url,
        item_type: (it.item_snapshot?.item_type as string) ?? null,
        product_name: (it.item_snapshot?.brand as string) ?? null,
      }))
      try {
        const result = await checkLook(pieces, stylistLens)
        if (!result) {
          return { status: 'unavailable', model, prompt_version: promptVersion }
        }
        const status: SubjectiveOutcome['status'] = result.verdict === 'clashes' ? 'failed' : 'passed'
        const raw = shortHash(`${snapshotId}:${payloadHash}:${JSON.stringify(result)}`)
        return {
          status,
          verdict: result.verdict,
          score: typeof result.colourHarmony === 'number' ? result.colourHarmony : null,
          reasons: result,
          model,
          prompt_version: promptVersion,
          raw_response_hash: raw,
        }
      } catch (err) {
        return { status: 'error', model, prompt_version: promptVersion, reasons: { error: String(err).slice(0, 200) } }
      }
    },
  }
}
