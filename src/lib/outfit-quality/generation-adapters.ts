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
import { slotForItemType, type Slot } from '@/lib/composer'
import { sellable } from '@/lib/stock-sellable'
import { checkSizesForMember } from '@/lib/look-size-check'
import { checkLook, type CheckPiece } from '@/lib/look-check'
import { loadSizeRowsFor } from '@/lib/size-availability'
import { resolveAvailability } from '@/lib/size-match'
import { sizeCategoryFor, type SizeProfile } from '@/lib/size-canonical'
import { priceOfItem } from '@/lib/brand-affinity'
import {
  profileFactsFromContext,
  buildSizeProfile,
  hasAnySize,
  keepForProfileSize,
  profileItemAffinity,
  type AffinityItemFacts,
} from '@/lib/outfit-quality/profile-context'
import {
  type CompositionGenerator,
  type ObjectiveEvidenceProvider,
  type SubjectiveChecker,
  type GeneratedCandidate,
  type GeneratedItem,
  type GenerationContext,
  type GenerationExclusions,
  type SubjectiveOutcome,
} from '@/lib/outfit-quality/candidate-generation'
import { personaFitScore, briefPiece, PERSONA_SHORTLIST_SCALE, BRIEF_SHORTLIST_SCALE } from '@/lib/pilot-composer'
import { briefBlocks, briefPull } from '@/lib/stylist-brief'
import { personaLensFromSnapshot, styleModelFromSnapshot } from '@/lib/outfit-quality/snapshot-lens'
import { itemsSignature } from '@/lib/outfit-quality/scope-signature'
import { itemUsesFromSignatures } from '@/lib/outfit-quality/scope-exclusions'
import { SNAPSHOT_SYSTEM_VERSIONS, type SnapshotPayload, type SystemVersions } from '@/lib/outfit-quality/stylist-snapshot'
import { buildSubjectiveCheckPrompt } from '@/lib/outfit-quality/subjective-prompt'
import { composeReviewLooks, reviewLibrary, reviewAnchorCategory, reviewSlotsFor, type ReviewPick } from '@/lib/review-compose'
import { loadLearnedMaterialPairs } from '@/lib/house-style-store'
import { loadEjectionConstraints } from '@/lib/pipeline-store'
import type { EjectionConstraints } from '@/lib/pipeline'
import { loadRealMemberContext, type RealMemberContext } from '@/lib/outfit-quality/member-context'
import { gateToMemberTaste, memberShortlistPull, memberLookGate } from '@/lib/outfit-quality/member-gates'

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
    // The canonical price contract: price_gbp first, native price converted
    // through the currency table only as a fallback. Native price is NEVER
    // read as GBP.
    price_gbp: priceOfItem({ price: (it as any).price, price_gbp: (it as any).price_gbp, currency: (it as any).currency }).gbp,
    brand_price_tier: it.brand?.price_tier ?? null,
    brand_name: it.brand?.name ?? null,
    colour_family: it.colour_family ?? null,
    material_formality: it.material_formality ?? null,
    pattern: it.pattern ?? null,
  }
}

/**
 * Gate the pool to the evaluation profile's declared clothing/shoe sizes.
 * Genuinely unsized pieces always survive; a sized piece survives only when a
 * WEARABLE matching size exists (exact or a listed adjacent, actually buyable).
 * A sold-out matching size row fails closed here, as does unknown sizing —
 * either would fail the objective size check downstream.
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
    return keepForProfileSize(true, a.quality, a.wearable)
  })
}

/**
 * Variety across looks. The review recipe picks the most compatible piece per
 * slot, and a neutral heel or clutch is compatible with nearly every dress —
 * so without a cap the same shoe carried every look in a batch (one boot was
 * in 32 of 70 looks). Each prior appearance in this scope costs a piece a
 * little at the shortlist; once it has supported SUPPORT_USAGE_CAP looks it is
 * left out for the remaining anchors, unless nothing else composes.
 */
export const SUPPORT_USAGE_CAP = 2
export const USAGE_PENALTY_PER_LOOK = 0.08

export interface HouseKnowledge {
  learnedPairs: { approved: Set<string>; rejected: Set<string> }
  constraints: EjectionConstraints
}

/** Injection points for tests; production reads the real loaders. */
export interface GeneratorDeps {
  loadMemberContext?: (memberId: string) => Promise<RealMemberContext>
  loadHouseKnowledge?: () => Promise<HouseKnowledge>
}

async function loadHouseKnowledgeLive(): Promise<HouseKnowledge> {
  const [learnedPairs, constraints] = await Promise.all([loadLearnedMaterialPairs(), loadEjectionConstraints()])
  return { learnedPairs, constraints }
}

/**
 * The composition generator — THE OUTFIT REVIEW RECIPE (lib/review-compose),
 * composed for whoever the batch is for.
 *
 * Loads the shared retail pool, applies the frozen snapshot's item-mask
 * exclusions and the stylist brief's bans, then narrows the pool to the
 * context before a single look is built:
 *
 *   * evaluation profile — the FROZEN profile facts: a hard size gate to the
 *     profile's declared sizes and a budget/brand/occasion/style pull;
 *   * real member — her declared sizes (stored size rows, fail closed), her
 *     avoided colours / shapes / types, hidden and input-only brands, price
 *     ceiling and brief bans, her loved shoe types owning the shoe slot, her
 *     rule layer as a whole-look gate, and her taste as a shortlist pull.
 *
 * Per anchor the review recipe then does what it does on /admin/outfit-review:
 * brand-tier-coherent slot pools (other garment + shoes + bag), the House
 * Style Constitution gate, the stylist's FROZEN Style Brain blend, and a
 * diversity cap. Outerwear and jewellery are never composed — they are styled
 * on by hand, as in Review. Each distinct anchor yields one candidate until
 * `count` is reached.
 *
 * The stylist's eye (envelope, looks, learned model, brief) is read from the
 * frozen snapshot only. The house's shared knowledge — learned material
 * pairings and ejection constraints, what Chloe's rejections have taught every
 * surface — is read live, as Review reads it.
 */
export function createComposerGenerator(admin: Admin = createAdminClient(), deps: GeneratorDeps = {}): CompositionGenerator {
  const loadMember = deps.loadMemberContext ?? loadRealMemberContext
  const loadHouse = deps.loadHouseKnowledge ?? loadHouseKnowledgeLive
  return {
    async generate({ count, snapshot, context, exclusions }): Promise<GeneratedCandidate[]> {
      const payload = snapshot.payload as SnapshotPayload
      const excluded = new Set(
        (payload?.item_mask?.decisions ?? [])
          .filter((d) => d.eligibility === 'excluded')
          .map((d) => d.item_id),
      )
      // The stylist's EYE, all read from the frozen snapshot: her reference
      // image envelope + looks, her learned Style Brain model, and her brief.
      // Nothing here is a live read, so the whole batch composes through one
      // lens — and the next Start picks up what this round's reviews taught.
      const lens = personaLensFromSnapshot(payload)
      const model = styleModelFromSnapshot(payload)
      const brief = payload?.brief ?? null

      let pool = (await getReadyAndLiveItems())
        .filter((it) => !!it.image_url && sellable(it) && !excluded.has(it.item_id))
        // Required-item-data gate at the pool: a piece without a type or brand
        // can never pass the objective checks, so it is never composed.
        .filter((it) => !!it.item_type && !!it.brand?.name)
      // A piece the stylist's brief BANS is never shortlisted: a ban is a rule,
      // not a preference. (The pilot composer applies the same cut.)
      if (brief?.nevers?.some((n) => n.kind === 'ban')) {
        pool = pool.filter((it) => !briefBlocks(briefPiece(it), brief))
      }

      // Whose looks these are. A profile is frozen into the context snapshot;
      // a real member is read through the private-stylist loaders.
      const facts = profileFactsFromContext(context.contextSnapshot)
      const member = context.realMemberId ? await loadMember(context.realMemberId) : null
      const taste = member?.taste ?? null

      // Size gate — fail closed, exactly what the objective size check will
      // demand: only a piece with a WEARABLE matching size row survives.
      const sizeProfile = facts ? buildSizeProfile(facts.size_profile) : (member?.sizeProfile ?? {})
      if (hasAnySize(sizeProfile)) {
        pool = await gateToProfileSizes(admin, pool, sizeProfile)
      }
      // Her gates, then her shoes: trainers lead when she loves them.
      if (taste) pool = gateToMemberTaste(taste, pool)

      const house = await loadHouse()

      // One ranking pull for both the anchor order and each slot's shortlist:
      // profile affinity (when there is a profile), her taste (when there is a
      // member), the stylist's envelope / nearest-look fit and her brief's
      // pull, at the same scales the pilot composer uses, minus a variety
      // penalty for pieces this scope has already used. With none of these it
      // collapses to compat alone, so plain batches rank exactly as Review.
      const uses = new Map<string, number>(
        exclusions?.itemUses ?? (exclusions?.signatures ? itemUsesFromSignatures(exclusions.signatures) : []),
      )
      const usesOf = (id: string) => uses.get(id) ?? 0
      const memberPull = taste ? memberShortlistPull(taste) : null

      const pull = (item: ItemWithBrand): number =>
        (facts ? profileItemAffinity(facts, affinityFacts(item)) : 0) +
        (memberPull ? memberPull(item) : 0) +
        PERSONA_SHORTLIST_SCALE * personaFitScore(lens, item) +
        BRIEF_SHORTLIST_SCALE * briefPull(briefPiece(item), brief) -
        USAGE_PENALTY_PER_LOOK * usesOf(item.item_id)
      const briefHasPull = !!brief && ((brief.brands?.length ?? 0) > 0 || (brief.signature_pieces?.length ?? 0) > 0 || (brief.fabrics?.length ?? 0) > 0 || (brief.nevers?.length ?? 0) > 0)
      const hasPull = !!facts || !!taste || !!lens || briefHasPull || uses.size > 0
      const shortlistAdjust = hasPull ? pull : undefined
      const lookGate = taste ? memberLookGate(taste) : undefined

      // Anchors are the "lead" garment of a look: a dress, top, or bottom —
      // the same garments Review queues.
      const anchors = pool.filter((it) => reviewAnchorCategory(it.item_type) != null)

      // The pull governs the ANCHOR iteration order too, not only the
      // additions: the lead garment of the first candidates is the best fit,
      // so a bounded batch spends its positions on the most on-taste
      // compositions. Ties fall back to a stable id order so generation stays
      // deterministic for a given pool.
      const orderedAnchors = hasPull
        ? [...anchors].sort((a, b) => {
            const d = pull(b) - pull(a)
            return d !== 0 ? d : a.item_id.localeCompare(b.item_id)
          })
        : anchors

      const out: GeneratedCandidate[] = []
      // Scope-level dedupe: nothing already composed for this stylist +
      // context (any batch, decided or not) is produced again, and no anchor
      // that already led a look leads another in pass 1.
      const usedSignatures = new Set<string>(exclusions?.signatures ?? [])
      const usedAnchors = new Set<string>(exclusions?.anchorItemIds ?? [])

      // The review recipe for one anchor. Supporting pieces at the cap are
      // left out; if that leaves nothing composable the cap is relaxed rather
      // than failing.
      const compose = (anchor: ItemWithBrand, maxCandidates: number): ReviewPick[] => {
        const library = reviewLibrary(pool, anchor, house.constraints)
        const run = (lib: ItemWithBrand[]) =>
          composeReviewLooks({
            anchor,
            library: lib,
            styleModel: model,
            learnedPairs: house.learnedPairs,
            count: maxCandidates,
            shortlistAdjust,
            lookGate,
          }).picks
        const capped = new Set(library.filter((it) => usesOf(it.item_id) >= SUPPORT_USAGE_CAP).map((it) => it.item_id))
        if (capped.size === 0) return run(library)
        const strict = run(library.filter((it) => !capped.has(it.item_id)))
        return strict.length > 0 ? strict : run(library)
      }

      const take = (anchor: ItemWithBrand, best: ReviewPick): boolean => {
        const items = toGeneratedItems(anchor, best.items as { item: ItemWithBrand; slot: Slot }[])
        const signature = itemsSignature(items.map((i) => i.item_id))
        if (usedSignatures.has(signature)) return false
        usedSignatures.add(signature)
        usedAnchors.add(anchor.item_id)
        for (const it of items) uses.set(it.item_id, usesOf(it.item_id) + 1)
        const anchorSlot = slotForItemType(anchor.item_type)
        // A complete review look: the anchor, the other garment for a
        // separates anchor, and shoes. The bag is best-effort, as in Review.
        const { garment } = reviewSlotsFor(reviewAnchorCategory(anchor.item_type)!)
        out.push({
          requiredSlots: Array.from(new Set([anchorSlot, ...(garment ? [garment] : []), 'shoe'])),
          items,
          anchorItemId: anchor.item_id,
          itemsSignature: signature,
        })
        return true
      }

      // Pass 1: fresh anchors only, one look each. Anchors that already led a
      // look (scope exclusion) or whose best look is already cased are kept
      // aside for pass 2.
      const revisit: ItemWithBrand[] = []
      for (const anchor of orderedAnchors) {
        if (out.length >= count) break
        if (usedAnchors.has(anchor.item_id)) {
          revisit.push(anchor)
          continue
        }
        const best = compose(anchor, 1)[0]
        if (!best) continue
        if (!take(anchor, best)) revisit.push(anchor)
      }

      // Pass 2: the fresh anchors are spent, so revisit the ones already led
      // and take their best UNSEEN combination — a new look, not a repeat.
      for (const anchor of revisit) {
        if (out.length >= count) break
        for (const c of compose(anchor, 3)) {
          if (take(anchor, c)) break
        }
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
          // Stored size rows only ('none'): the pool was gated on the same
          // rows before composing, and a retailer re-read per candidate is
          // what made a ten-look batch crawl. Rows are kept fresh by the stock
          // sweep and the stock sentinel, not by the Lab.
          const verdicts = await checkSizesForMember(admin as any, context.realMemberId, pieces as any, 'none')
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
          // Fail closed on sold out: only a WEARABLE matching size (exact or a
          // listed adjacent, actually buyable) counts as in_size. A sold-out
          // matching size row (quality full/acceptable, wearable=false) is a
          // definitive not_in_size, never a pass.
          size[it.item_id] =
            a.quality === 'unknown' ? 'unconfirmed'
            : a.wearable && (a.quality === 'full' || a.quality === 'acceptable') ? 'in_size'
            : 'not_in_size'
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
        // The model is the one FROZEN on the snapshot, so old batches keep
        // reporting (and using) the model they were started with.
        const result = await checkLook(pieces, stylistLens, { model })
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
