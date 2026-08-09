'use server'

// MULTI-STYLING COMPOSITION — the composer's unit of work is a STYLING SET:
// every hero item gets 3-4 distinct outfit variants in one run, linked by a
// shared styling_set_id. Variants are steered apart by direction presets
// (daytime / evening / layered / weekend), must each pass the full House Style
// Constitution + confidence gate, and must be pairwise distinct (60% supporting
// difference, never same shoes AND bag, different occasion/formality/direction).

import { createAdminClient } from '@/lib/supabase-server'
import { getItem, getReadyAndLiveItems, type ItemWithBrand } from '@/lib/admin-queries'
import {
  generateCandidates,
  deriveSlotScores,
  deriveOutfitLevelScores,
  slotForItemType,
  type Slot,
} from '@/lib/composer'
import { loadStyleModel, recordStyleOffers } from '@/lib/style-brain-store'
import { learnedBonus, blendStrength, type FeatureItem } from '@/lib/style-brain'
import {
  formalityBand,
  deriveOccasionScores,
  hardSkipPairs,
  isExcluded,
  confidenceGate,
} from '@/lib/pipeline'
import { evaluateHouseStyle } from '@/lib/house-style'
import { toHouseItem, loadLearnedMaterialPairs, recordHouseRejections } from '@/lib/house-style-store'
import {
  loadEjectionConstraints,
  loadApprovedVectors,
  loadPipelineConfig,
  stageComposedOutfit,
  vectorForCandidate,
} from '@/lib/pipeline-store'
import {
  DIRECTION_PRESETS,
  SET_TARGET_SIZE,
  SET_MIN_SIZE,
  isDistinctFromAll,
  type SetVariant,
  type DirectionPreset,
} from '@/lib/styling-sets'
import {
  resolveStylistId,
  getStylist,
  loadItemMask,
  itemEligible,
  withinVectorRange,
} from '@/lib/stylist-store'
import { revalidatePath } from 'next/cache'

function toFeature(it: ItemWithBrand): FeatureItem {
  return {
    item_type: it.item_type,
    colour_family: (it as any).colour_family ?? null,
    pattern: (it as any).pattern ?? null,
    material_formality: (it as any).material_formality ?? null,
    brand_name: it.brand?.name ?? null,
    price_tier: (it.brand as any)?.price_tier ?? null,
  }
}

// Steer the library toward a direction preset: shoe register, layering,
// jewellery temperature.
function steerLibrary(library: ItemWithBrand[], preset: DirectionPreset): ItemWithBrand[] {
  const out = library.filter((it: any) => {
    const slot = slotForItemType(it.item_type)
    if (slot === 'shoe') return preset.shoeTypes.includes(String(it.item_type))
    if (slot === 'outerwear') return preset.wantOuterwear
    if (slot === 'jewellery' && preset.jewellery === 'minimal') return (it.jewellery_scale ?? 0) < 4
    return true
  })
  // Never let steering empty the shoe pool entirely — fall back to all shoes.
  const hasShoe = out.some((it) => slotForItemType(it.item_type) === 'shoe')
  return hasShoe ? out : library.filter((it: any) => slotForItemType(it.item_type) !== 'outerwear' || preset.wantOuterwear)
}

interface BuiltVariant {
  direction: string
  items: { item: ItemWithBrand; slot: Slot }[]
  baseScore: number
  vector: number[]
  occasion: { formality: number; planning: number; wearer_priority: number; time_of_day: number }
  confidence: number
  similarity: number
  lane: 'fast' | 'standard'
  reasons: string[]
  statementItemId: string | null
  setVariant: SetVariant
}

export interface ComposeSetResult {
  stylingSetId?: string
  staged: number
  directions: string[]
  error?: string
}

// Build the distinctness shape for a candidate.
function asSetVariant(
  direction: string,
  items: { item: ItemWithBrand; slot: Slot }[],
  occasion: { formality: number; time_of_day: number },
  statementItemId: string | null,
): SetVariant {
  return {
    supportingIds: items.map((x) => x.item.item_id),
    shoeId: items.find((x) => x.slot === 'shoe')?.item.item_id ?? null,
    bagId: items.find((x) => x.slot === 'bag')?.item.item_id ?? null,
    direction,
    formality: occasion.formality,
    timeOfDay: occasion.time_of_day,
    statementItemId,
  }
}

/**
 * Compose a styling set for one hero item under one stylist's lens. Returns
 * the staged set (variants land in the pipeline review queue unless the
 * caller handles Stage-2 auto-publish).
 */
export async function composeStylingSet(
  heroItemId: string,
  opts?: {
    stylistId?: string | null
    targetSize?: number
    excludeItemCombos?: string[][]     // rejected combos (regeneration)
    acceptedVariants?: SetVariant[]    // already-approved variants (regeneration)
    existingSetId?: string | null
    stage?: boolean                    // default true — stage into the queue
  },
): Promise<ComposeSetResult & { variants?: BuiltVariant[] }> {
  try {
    const hero = await getItem(heroItemId)
    if (!hero) return { staged: 0, directions: [], error: 'Hero item not found' }
    const sid = await resolveStylistId(opts?.stylistId)
    const stylist = sid ? await getStylist(sid) : null

    const [model, constraints, approvedVectors, config, learnedPairs, mask, libraryAll] = await Promise.all([
      loadStyleModel(sid),
      loadEjectionConstraints(),
      loadApprovedVectors(500),
      loadPipelineConfig(),
      loadLearnedMaterialPairs(),
      sid ? loadItemMask(sid) : Promise.resolve(new Map() as Awaited<ReturnType<typeof loadItemMask>>),
      getReadyAndLiveItems(),
    ])

    // The stylist's lens: item mask + ejection constraints.
    const band = formalityBand([hero])
    const library = libraryAll.filter(
      (i) =>
        itemEligible(mask, i.item_id) &&
        !isExcluded(constraints, i.item_id, slotForItemType(i.item_type), band),
    )

    const houseOpts = {
      learnedApprovedPairs: learnedPairs.approved,
      learnedRejectedPairs: learnedPairs.rejected,
      softSkipPairs: hardSkipPairs(model),
    }
    const heroSlot = slotForItemType(hero.item_type)
    const excludedCombos = new Set((opts?.excludeItemCombos ?? []).map((c) => [...c].sort().join('|')))

    const accepted: BuiltVariant[] = []
    const acceptedShapes: SetVariant[] = [...(opts?.acceptedVariants ?? [])]
    // Statement-consistency: fixed once the first variant lands (or inherited
    // from already-approved variants during regeneration).
    let heroIsStatement: boolean | null =
      acceptedShapes.length > 0 ? acceptedShapes.some((v) => v.statementItemId === heroItemId) || null : null

    const target = Math.min(opts?.targetSize ?? SET_TARGET_SIZE, DIRECTION_PRESETS.length)
    const wanted = Math.max(0, target - acceptedShapes.length)
    const rejectionHits: import('@/lib/house-style').RuleHit[] = []

    for (const preset of DIRECTION_PRESETS) {
      if (accepted.length >= wanted) break
      // Skip directions already covered by approved variants.
      if (acceptedShapes.some((v) => v.direction === preset.key)) continue

      const steered = steerLibrary(library, preset)
      const raw = generateCandidates({
        anchor: hero,
        library: steered,
        maxCandidates: 8,
        learnedBlend: blendStrength(model),
        learnedBonus: (items) => learnedBonus(model, [toFeature(hero), ...items.map((x) => toFeature(x.item))]),
        houseGate: (items) => {
          const v = evaluateHouseStyle(
            [toHouseItem(hero, heroSlot), ...items.map((x) => toHouseItem(x.item, x.slot))],
            houseOpts,
          )
          if (!v.pass) rejectionHits.push(...v.violations)
          return v.pass
        },
      })

      for (const c of raw) {
        const comboKey = c.items.map((x) => x.item.item_id).sort().join('|')
        if (excludedCombos.has(comboKey)) continue

        const allEntries = [{ item: hero, slot: heroSlot }, ...c.items]
        const hv = evaluateHouseStyle(
          allEntries.map((e) => toHouseItem(e.item, e.slot)),
          houseOpts,
        )
        if (!hv.pass) continue

        // Statement-consistency across the set.
        const stmtIsHero = hv.statement?.itemId === heroItemId
        if (heroIsStatement === true && !stmtIsHero) continue
        if (heroIsStatement === false && stmtIsHero) continue

        const occasion = deriveOccasionScores(allEntries)
        // Direction fit: the derived occasion must land in the preset's window
        // (loose — one step of slack either side).
        if (occasion.time_of_day < preset.targetTimeOfDay[0] - 1 || occasion.time_of_day > preset.targetTimeOfDay[1] + 1) continue

        const shape = asSetVariant(preset.key, c.items, occasion, hv.statement?.itemId ?? null)
        if (!isDistinctFromAll(shape, acceptedShapes).ok) continue

        const vector = vectorForCandidate(
          allEntries,
          occasion,
          deriveOutfitLevelScores(hero, c.items),
          deriveSlotScores(allEntries),
        )
        // The stylist's operating envelope — never compose outside it.
        if (stylist && !withinVectorRange(vector, stylist.vector_range)) continue

        const gate = confidenceGate({
          vector,
          approvedVectors,
          items: allEntries.map((e) => toFeature(e.item)),
          itemIds: allEntries.map((e) => e.item.item_id),
          itemLabels: allEntries.map((e) => [e.item.brand?.name, e.item.product_name].filter(Boolean).join(' ')),
          slotByItemId: Object.fromEntries(allEntries.map((e) => [e.item.item_id, e.slot])),
          band: formalityBand(allEntries.map((e) => e.item)),
          constraints,
          model,
        })
        const confidence = gate.confidence - hv.penaltyTotal

        accepted.push({
          direction: preset.key,
          items: c.items,
          baseScore: c.score,
          vector,
          occasion,
          confidence,
          similarity: gate.similarity,
          lane: confidence >= config.fast_lane_threshold ? 'fast' : 'standard',
          reasons: [...gate.reasons, ...hv.penalties.map((p) => p.message)],
          statementItemId: hv.statement?.itemId ?? null,
          setVariant: shape,
        })
        acceptedShapes.push(shape)
        if (heroIsStatement === null) heroIsStatement = stmtIsHero
        break // one variant per direction
      }
    }

    void recordHouseRejections(rejectionHits, heroItemId)

    if (accepted.length + (opts?.acceptedVariants?.length ?? 0) < Math.min(SET_MIN_SIZE, target)) {
      // Not enough distinct variants — stage what we have anyway but report it.
    }
    if (!accepted.length) return { staged: 0, directions: [], error: 'No constitution-passing distinct variants found for this hero' }

    // Register / reuse the set.
    const admin = createAdminClient()
    let stylingSetId = opts?.existingSetId ?? null
    if (!stylingSetId) {
      const { data: setRow, error: setErr } = await (admin.from('styling_set') as any)
        .insert({ stylist_id: sid, hero_item_id: heroItemId, status: 'reviewing', target_size: target })
        .select('styling_set_id')
        .single()
      if (setErr) throw setErr
      stylingSetId = (setRow as any).styling_set_id
    }

    if (opts?.stage !== false) {
      for (const v of accepted) {
        await stageComposedOutfit({
          anchorItemId: heroItemId,
          itemIds: v.items.map((x) => x.item.item_id),
          slots: v.items.map((x) => x.slot),
          vector: v.vector,
          baseScore: v.baseScore,
          confidence: v.confidence,
          lane: v.lane,
          reasons: v.reasons,
          occasionScores: v.occasion as any,
          stylingSetId,
          stylistId: sid,
          variantDirection: v.direction,
          setSize: accepted.length + (opts?.acceptedVariants?.length ?? 0),
        })
      }
      // Every staged variant was OFFERED.
      void recordStyleOffers(
        accepted.map((v) => ({
          items: [toFeature(hero), ...v.items.map((x) => toFeature(x.item))],
          anchorItemId: heroItemId,
          itemIds: [heroItemId, ...v.items.map((x) => x.item.item_id)],
        })),
        'pipeline',
        sid,
      )
    }

    return {
      stylingSetId: stylingSetId ?? undefined,
      staged: accepted.length,
      directions: accepted.map((v) => v.direction),
      variants: accepted,
    }
  } catch (err) {
    console.error('[composeStylingSet]', err)
    return { staged: 0, directions: [], error: err instanceof Error ? err.message : 'Set composition failed' }
  }
}

// ── Under-styled regeneration ────────────────────────────────────────────────
// When rejections drop a set below 2 approved variants, compose replacements
// that respect the rejection signals (rejected combos are excluded; approved
// variants constrain distinctness) and return them to the queue.

export async function regenerateSetVariants(stylingSetId: string): Promise<ComposeSetResult> {
  try {
    const admin = createAdminClient()
    const { data: setRow } = await admin.from('styling_set' as any).select('*').eq('styling_set_id', stylingSetId).maybeSingle()
    if (!setRow) return { staged: 0, directions: [], error: 'Set not found' }
    const set = setRow as any

    const { data: staged } = await admin
      .from('composed_outfit' as any)
      .select('*')
      .eq('styling_set_id', stylingSetId)
    const rows = (staged ?? []) as any[]
    const rejected = rows.filter((r) => r.status === 'rejected')
    const approved = rows.filter((r) => r.status === 'approved')
    const pending = rows.filter((r) => r.status === 'pending')

    const acceptedVariants: SetVariant[] = [...approved, ...pending].map((r) => ({
      supportingIds: r.item_ids ?? [],
      shoeId: (r.item_ids ?? [])[(r.slots ?? []).indexOf('shoe')] ?? null,
      bagId: (r.item_ids ?? [])[(r.slots ?? []).indexOf('bag')] ?? null,
      direction: r.variant_direction ?? null,
      formality: r.occasion_scores?.formality ?? null,
      timeOfDay: r.occasion_scores?.time_of_day ?? null,
      statementItemId: null,
    }))

    const res = await composeStylingSet(set.hero_item_id, {
      stylistId: set.stylist_id,
      targetSize: set.target_size ?? SET_TARGET_SIZE,
      excludeItemCombos: rejected.map((r) => r.item_ids ?? []),
      acceptedVariants,
      existingSetId: stylingSetId,
    })

    await (admin.from('styling_set') as any)
      .update({ status: 'reviewing', updated_at: new Date().toISOString() })
      .eq('styling_set_id', stylingSetId)
    revalidatePath('/admin/pipeline')
    return res
  } catch (err) {
    console.error('[regenerateSetVariants]', err)
    return { staged: 0, directions: [], error: err instanceof Error ? err.message : 'Regeneration failed' }
  }
}

// ── Set status upkeep after a decision ───────────────────────────────────────
// Called after any variant decision: recompute the set's status (live /
// under_styled) from approved + live counts once reviewing is done.

export async function refreshSetStatus(stylingSetId: string): Promise<{ status?: string }> {
  try {
    const admin = createAdminClient()
    const { data: staged } = await admin
      .from('composed_outfit' as any)
      .select('status')
      .eq('styling_set_id', stylingSetId)
    const rows = (staged ?? []) as any[]
    const pending = rows.filter((r) => r.status === 'pending').length
    const approved = rows.filter((r) => r.status === 'approved').length
    let status = 'reviewing'
    if (pending === 0) status = approved >= 2 ? 'live' : 'under_styled'
    await (admin.from('styling_set') as any)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('styling_set_id', stylingSetId)
    return { status }
  } catch (err) {
    console.error('[refreshSetStatus]', err)
    return {}
  }
}

// ── BRAND DEMO MODE (Stage 3 capability, hook built now) ─────────────────────
// "Compose N styling sets where the hero piece is from {brand}" — full
// constitution + confidence gate, output to a DRAFT project, never
// auto-published. The future brand-partnership pitch tool.

export async function composeBrandDemo(
  brandId: string,
  nSets = 3,
  stylistId?: string | null,
): Promise<{ projectId?: string; sets: number; outfits: number; error?: string }> {
  try {
    const admin = createAdminClient()
    const { data: brand } = await admin.from('brand' as any).select('name').eq('brand_id', brandId).maybeSingle()
    if (!brand) return { sets: 0, outfits: 0, error: 'Brand not found' }
    const brandName = (brand as any).name as string

    // Hero candidates: this brand's garments (dresses/tops/bottoms first).
    const HERO_TYPES = new Set([
      'mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress',
      'shirt', 'blouse', 'knitwear', 'corset', 'bodysuit', 't-shirt',
      'trousers', 'jeans', 'skirt', 'coat', 'trench', 'jacket', 'blazer',
    ])
    const { data: items } = await admin
      .from('item' as any)
      .select('item_id, item_type, product_name')
      .eq('brand_id', brandId)
      .in('status', ['ready', 'live'])
      .limit(200)
    const heroes = ((items ?? []) as any[]).filter((it) => HERO_TYPES.has(String(it.item_type))).slice(0, nSets)
    if (!heroes.length) return { sets: 0, outfits: 0, error: `No ready/live hero garments for ${brandName}` }

    // Draft project container — never auto-published.
    const { data: project, error: projErr } = await (admin.from('admin_project') as any)
      .insert({
        title: `BRAND DEMO — ${brandName.toUpperCase()}`,
        status: 'draft',
        outfit_ids: [],
        notes: `Brand-partnership demo: styling sets with ${brandName} hero pieces. Composed under the full constitution + confidence gate. Never auto-publishes.`,
      })
      .select('project_id')
      .single()
    if (projErr) throw projErr
    const projectId = (project as any).project_id as string

    const { approveCandidate } = await import('@/app/admin/composer/actions')
    let setCount = 0
    let outfitCount = 0
    for (const heroRow of heroes) {
      const res = await composeStylingSet(heroRow.item_id, { stylistId, stage: false })
      if (!res.variants?.length || !res.stylingSetId) continue
      setCount++
      for (const v of res.variants) {
        const created = await approveCandidate(
          heroRow.item_id,
          v.items.map((x) => x.item.item_id),
          v.items.map((x) => x.slot),
          { autoShoot: false, recordDecision: false, score: v.baseScore },
        )
        if (!created.outfitId) continue
        outfitCount++
        await (admin.from('outfit') as any)
          .update({
            project_id: projectId,
            styling_set_id: res.stylingSetId,
            stylist_id: await resolveStylistId(stylistId),
            variant_direction: v.direction,
            admin_notes: `Brand demo (${brandName}) — ${v.direction} variant. Draft only.`,
          })
          .eq('outfit_id', created.outfitId)
        const { data: proj } = await admin.from('admin_project' as any).select('outfit_ids').eq('project_id', projectId).single()
        await (admin.from('admin_project') as any)
          .update({ outfit_ids: [...(((proj as any)?.outfit_ids ?? []) as string[]), created.outfitId] })
          .eq('project_id', projectId)
      }
    }
    revalidatePath('/admin/projects')
    return { projectId, sets: setCount, outfits: outfitCount }
  } catch (err) {
    console.error('[composeBrandDemo]', err)
    return { sets: 0, outfits: 0, error: err instanceof Error ? err.message : 'Brand demo failed' }
  }
}
