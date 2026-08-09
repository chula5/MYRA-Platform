'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { getItem, getReadyAndLiveItems, type ItemWithBrand } from '@/lib/admin-queries'
import {
  generateCandidates,
  deriveSlotScores,
  deriveOutfitLevelScores,
  slotForItemType,
  slotPlanForAnchor,
  pairCompat,
  type Slot,
} from '@/lib/composer'
import { revalidatePath } from 'next/cache'
import { generateHiggsfieldShootForOutfit } from '@/app/admin/projects/higgsfield-actions'
import { generateOccasionTags } from '@/app/admin/ai/occasion-tags'
import { loadStyleModel, recordStyleDecision, recordStyleOffers } from '@/lib/style-brain-store'
import { learnedBonus, blendStrength, type FeatureItem } from '@/lib/style-brain'
import {
  formalityBand,
  deriveOccasionScores,
  computeSwapDeltas,
  hardSkipPairs,
  isExcluded,
  confidenceGate,
} from '@/lib/pipeline'
import { evaluateHouseStyle, type RuleHit } from '@/lib/house-style'
import {
  toHouseItem,
  loadLearnedMaterialPairs,
  recordHouseRejections,
  recordMaterialPairings,
} from '@/lib/house-style-store'
import {
  loadEjectionConstraints,
  loadApprovedVectors,
  loadPipelineConfig,
  recordEjection,
  ensureItemsScored,
  vectorForCandidate,
} from '@/lib/pipeline-store'
import { isCloudinaryUrl, persistImageToCloudinary } from '@/lib/cloudinary-persist'

// Map a library item to the Style Brain's feature shape.
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

// ── Compose ──────────────────────────────────────────────────────────────────

export interface ComposedCandidatePayload {
  candidateIndex: number
  score: number
  // Confidence gate: avg cosine to the nearest 5 approved outfits, minus
  // ejection / colour / brand penalties. Routes to a fast or standard lane.
  similarity: number
  confidence: number
  lane: 'fast' | 'standard'
  reasons: string[]
  // House Style Constitution read-out for this candidate.
  statement: string | null      // "the one deliberate surprise"
  echoes: string[]              // what holds the look together
  items: Array<{
    slot: Slot
    item_id: string
    product_name: string
    brand_name: string | null
    image_url: string
    compat: number
  }>
}

// Why candidates were discarded before scoring — so an empty pool is explainable.
export interface HouseRejectionSummary {
  total: number
  byCode: { code: string; rule: string; count: number; message: string }[]
}

export interface SlotPlanPayload {
  anchorSlot: Slot
  required: Slot[]
  optional: Slot[]
}

export async function composeForAnchor(
  anchorItemId: string,
  occasion?: string | null,
): Promise<{
  anchor?: ItemWithBrand
  candidates?: ComposedCandidatePayload[]
  slotPlan?: SlotPlanPayload
  houseRejections?: HouseRejectionSummary
  error?: string
}> {
  try {
    const anchor = await getItem(anchorItemId)
    if (!anchor) return { error: 'Anchor item not found' }

    const library = await getReadyAndLiveItems()
    if (library.length < 3) {
      return { error: 'Library needs at least three ready/live items to compose against' }
    }

    // Style Brain closed loop: fold Chloe's learned taste INTO generation, so
    // the composer builds & keeps the combos she'd approve (not just re-ranks).
    // Safe no-op until there are decisions (blend ramps from 0).
    const [model, constraints, approvedVectors, config, learnedPairs] = await Promise.all([
      loadStyleModel(),
      loadEjectionConstraints(),
      loadApprovedVectors(500),
      loadPipelineConfig(),
      loadLearnedMaterialPairs(),
    ])

    // Ejection constraints: quarantined items and items ejected 2+ times in
    // this context never make it into the candidate pools.
    const band = formalityBand([anchor])
    const pool = library.filter(
      (i) => !isExcluded(constraints, i.item_id, slotForItemType(i.item_type), band),
    )

    // HOUSE STYLE CONSTITUTION — the generative gate. Runs before vector
    // scoring; written rules override learned statistics. The old skip-list
    // rides along as SOFT penalties inside the evaluation.
    const houseOpts = {
      occasion,
      learnedApprovedPairs: learnedPairs.approved,
      learnedRejectedPairs: learnedPairs.rejected,
      softSkipPairs: hardSkipPairs(model),
    }
    const anchorSlot0 = slotForItemType(anchor.item_type)
    const rejectionHits: RuleHit[] = []
    const houseVerdicts = new Map<string, ReturnType<typeof evaluateHouseStyle>>()
    const verdictFor = (items: { item: ItemWithBrand; slot: Slot }[]) => {
      const key = items.map((x) => x.item.item_id).sort().join('|')
      let v = houseVerdicts.get(key)
      if (!v) {
        v = evaluateHouseStyle(
          [toHouseItem(anchor, anchorSlot0), ...items.map((x) => toHouseItem(x.item, x.slot))],
          houseOpts,
        )
        houseVerdicts.set(key, v)
      }
      return v
    }

    const raw = generateCandidates({
      anchor,
      library: pool,
      learnedBlend: blendStrength(model),
      learnedBonus: (items) => learnedBonus(model, [toFeature(anchor), ...items.map((x) => toFeature(x.item))]),
      houseGate: (items) => {
        const v = verdictFor(items)
        if (!v.pass) rejectionHits.push(...v.violations)
        return v.pass
      },
    })
    const allowed = raw

    // Log why candidates never made it, and summarise for the UI.
    void recordHouseRejections(rejectionHits, anchorItemId)
    const rejByCode = new Map<string, { rule: string; count: number; message: string }>()
    for (const h of rejectionHits) {
      const cur = rejByCode.get(h.code) ?? { rule: h.rule, count: 0, message: h.message }
      cur.count++
      rejByCode.set(h.code, cur)
    }
    const houseRejections: HouseRejectionSummary = {
      total: rejectionHits.length,
      byCode: [...rejByCode.entries()]
        .map(([code, v]) => ({ code, ...v }))
        .sort((a, b) => b.count - a.count),
    }

    const candidates: ComposedCandidatePayload[] = allowed.map((c, idx) => {
      // Full 34-dim vector at composition time — real occasion scores, no
      // defaults — then gate against approved history.
      const allEntries = [{ item: anchor, slot: slotForItemType(anchor.item_type) }, ...c.items]
      const occasion = deriveOccasionScores(allEntries)
      const vector = vectorForCandidate(
        allEntries,
        occasion,
        deriveOutfitLevelScores(anchor, c.items),
        deriveSlotScores(allEntries),
      )
      const candBand = formalityBand(allEntries.map((e) => e.item))
      const gate = confidenceGate({
        vector,
        approvedVectors,
        items: allEntries.map((e) => toFeature(e.item)),
        itemIds: allEntries.map((e) => e.item.item_id),
        itemLabels: allEntries.map((e) => [e.item.brand?.name, e.item.product_name].filter(Boolean).join(' ')),
        slotByItemId: Object.fromEntries(allEntries.map((e) => [e.item.item_id, e.slot])),
        band: candBand,
        constraints,
        model,
      })
      // House verdict: soft penalties (white+cream, discordant colours, occasion
      // notes…) subtract from confidence and surface as reasons.
      const hv = verdictFor(c.items)
      const confidence = gate.confidence - hv.penaltyTotal
      const statementItem = hv.statement
        ? allEntries.find((e) => e.item.item_id === hv.statement!.itemId)
        : null
      return {
        candidateIndex: idx,
        score: Number(c.score.toFixed(3)),
        similarity: Number(gate.similarity.toFixed(3)),
        confidence: Number(confidence.toFixed(3)),
        lane: confidence >= config.fast_lane_threshold ? 'fast' as const : 'standard' as const,
        reasons: [...gate.reasons, ...hv.penalties.map((p) => p.message)],
        statement: statementItem
          ? `${[statementItem.item.brand?.name, statementItem.item.product_name].filter(Boolean).join(' ')} (${hv.statement!.kind})`
          : null,
        echoes: hv.echoes,
        items: c.items.map(({ item, slot }) => ({
          slot,
          item_id: item.item_id,
          product_name: item.product_name,
          brand_name: item.brand?.name ?? null,
          image_url: item.image_url,
          compat: Number((c.breakdown.find(b => b.itemId === item.item_id)?.compatWithAnchor ?? 0).toFixed(3)),
        })),
      }
    })

    // Every shown candidate is an OFFER — the denominator of approval rates.
    void recordStyleOffers(
      allowed.map((c) => ({
        items: [toFeature(anchor), ...c.items.map((x) => toFeature(x.item))],
        anchorItemId,
        itemIds: [anchor.item_id, ...c.items.map((x) => x.item.item_id)],
      })),
      'composer',
    )

    const anchorSlot = slotForItemType(anchor.item_type)
    const plan = slotPlanForAnchor(anchorSlot)
    const slotPlan: SlotPlanPayload = {
      anchorSlot,
      required: plan.required,
      optional: plan.optional,
    }

    return { anchor, candidates, slotPlan, houseRejections }
  } catch (err: unknown) {
    console.error('[composeForAnchor]', err)
    return { error: err instanceof Error ? err.message : 'Compose failed' }
  }
}

// ── Swap options ─────────────────────────────────────────────────────────────
// Powers the per-item SWAP / ADD picker on candidate cards.
//
//  - No query  → "most relevant": items in the requested slot, ranked by
//                 compatibility with the anchor (the default suggestions).
//  - A query   → searches the WHOLE library (every slot) by product name or
//                 brand, so you can pick literally any item. Same-slot matches
//                 still float to the top, but nothing is filtered out by slot.
//
// Either way the anchor and items already in the candidate are excluded, and the
// item's true slot is returned so a cross-slot pick lands in the right place.

export interface SwapOption {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  item_type: string
  slot: Slot
  sameSlot: boolean
  compat: number
}

export async function getSwapOptions(
  anchorItemId: string,
  slot: Slot,
  excludeItemIds: string[],
  query = '',
  limit = 60,
): Promise<{ options?: SwapOption[]; error?: string }> {
  try {
    const anchor = await getItem(anchorItemId)
    if (!anchor) return { error: 'Anchor not found' }

    const library = await getReadyAndLiveItems()
    const excluded = new Set([anchor.item_id, ...excludeItemIds])
    const q = query.trim().toLowerCase()

    let pool = library.filter((i) => !excluded.has(i.item_id))

    if (q) {
      // Search the entire library across every slot.
      pool = pool.filter(
        (i) =>
          i.product_name?.toLowerCase().includes(q) ||
          (i.brand?.name?.toLowerCase().includes(q) ?? false) ||
          i.item_type?.toLowerCase().includes(q),
      )
    } else {
      // Default suggestions: only items in the requested slot.
      pool = pool.filter((i) => slotForItemType(i.item_type) === slot)
    }

    const options: SwapOption[] = pool
      .map((item) => {
        const itemSlot = slotForItemType(item.item_type)
        return {
          item_id: item.item_id,
          product_name: item.product_name,
          brand_name: item.brand?.name ?? null,
          image_url: item.image_url,
          item_type: item.item_type,
          slot: itemSlot,
          sameSlot: itemSlot === slot,
          compat: Number(pairCompat(anchor, item).total.toFixed(3)),
        }
      })
      // Most relevant first: matching slot before others, then by compatibility.
      .sort((a, b) => Number(b.sameSlot) - Number(a.sameSlot) || b.compat - a.compat)
      .slice(0, limit)

    return { options }
  } catch (err: unknown) {
    console.error('[getSwapOptions]', err)
    return { error: err instanceof Error ? err.message : 'Swap lookup failed' }
  }
}

// ── Rescore ──────────────────────────────────────────────────────────────────
// Recompute a candidate's coherence + per-item compat after the user edits its
// items via swap/remove. Mirrors the aggregation in generateCandidates so the
// displayed score stays accurate.

export async function rescoreCandidate(
  anchorItemId: string,
  additions: Array<{ itemId: string; slot: Slot }>,
): Promise<{ score?: number; itemCompat?: Record<string, number>; error?: string }> {
  try {
    const anchor = await getItem(anchorItemId)
    if (!anchor) return { error: 'Anchor not found' }

    if (additions.length === 0) return { score: 0, itemCompat: {} }

    const items = await Promise.all(additions.map((a) => getItem(a.itemId)))
    if (items.some((i) => !i)) return { error: 'One or more items missing' }
    const entries = (items as ItemWithBrand[]).map((item, i) => ({ item, slot: additions[i].slot }))

    const itemCompat: Record<string, number> = {}
    let sum = 0
    let weight = 0
    for (const { item } of entries) {
      const c = pairCompat(anchor, item).total
      itemCompat[item.item_id] = Number(c.toFixed(3))
      sum += c * 2
      weight += 2
    }
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        sum += pairCompat(entries[i].item, entries[j].item).total
        weight += 1
      }
    }
    const score = weight > 0 ? sum / weight : 0
    return { score: Number(score.toFixed(3)), itemCompat }
  } catch (err: unknown) {
    console.error('[rescoreCandidate]', err)
    return { error: err instanceof Error ? err.message : 'Rescore failed' }
  }
}

// ── Anchor search ────────────────────────────────────────────────────────────

export async function searchAnchorItems(query: string, brandId?: string): Promise<{
  data?: Array<{ item_id: string; product_name: string; image_url: string; brand_name: string | null; item_type: string }>
  error?: string
}> {
  const supabase = createAdminClient()
  try {
    let req = supabase
      .from('item')
      .select('item_id, product_name, image_url, item_type, brand:brand_id(name)')
      .in('status', ['draft', 'ready', 'live'])
      .order('created_at', { ascending: false })
      .limit(60)

    const q = query.trim()
    if (q) req = req.ilike('product_name', `%${q}%`)
    if (brandId) req = req.eq('brand_id', brandId)

    const { data, error } = await req
    if (error) throw error

    return {
      data: (data ?? []).map((r: any) => ({
        item_id: r.item_id,
        product_name: r.product_name,
        image_url: r.image_url,
        item_type: r.item_type,
        brand_name: r.brand?.name ?? null,
      })),
    }
  } catch (err: unknown) {
    console.error('[searchAnchorItems]', err)
    return { error: err instanceof Error ? err.message : 'Search failed' }
  }
}

// ── Approve candidate → draft Outfit ─────────────────────────────────────────

const COMPOSER_PROJECT_TITLE = 'Composer drafts'

async function ensureComposerProject(): Promise<{ projectId?: string; error?: string }> {
  const supabase = createAdminClient()
  try {
    const { data: existing } = await supabase
      .from('admin_project')
      .select('project_id')
      .eq('title', COMPOSER_PROJECT_TITLE)
      .eq('status', 'draft')
      .limit(1)

    const row = (existing ?? [])[0] as { project_id: string } | undefined
    if (row) return { projectId: row.project_id }

    const { data: created, error } = await supabase
      .from('admin_project')
      .insert([{
        title: COMPOSER_PROJECT_TITLE,
        status: 'draft',
        outfit_ids: [],
        notes: 'Auto-created bucket for outfits approved from the Composer. Move outfits into a named project before publishing.',
      }])
      .select('project_id')
      .single()
    if (error) throw error
    return { projectId: (created as { project_id: string }).project_id }
  } catch (err: unknown) {
    console.error('[ensureComposerProject]', err)
    return { error: err instanceof Error ? err.message : 'Could not create composer project' }
  }
}

export async function approveCandidate(
  anchorItemId: string,
  itemIds: string[],
  slots: Slot[],
  // recordDecision:false lets the pipeline pre-create a draft outfit (for
  // overnight Higgsfield pre-rendering) WITHOUT logging an approve Chloe never
  // made — the decision is recorded when she actually taps approve.
  opts?: {
    autoShoot?: boolean
    source?: 'composer' | 'review'
    score?: number
    recordDecision?: boolean
    // Styling-set membership + stylist attribution, stamped onto the outfit.
    stylingSetId?: string | null
    stylistId?: string | null
    variantDirection?: string | null
  },
): Promise<{ outfitId?: string; projectId?: string; error?: string }> {
  if (itemIds.length !== slots.length) return { error: 'itemIds and slots length mismatch' }

  const supabase = createAdminClient()
  try {
    const anchor = await getItem(anchorItemId)
    if (!anchor) return { error: 'Anchor item not found' }

    const additionItems = await Promise.all(itemIds.map(id => getItem(id)))
    if (additionItems.some(i => !i)) return { error: 'One or more candidate items not found' }

    const additions = (additionItems as ItemWithBrand[]).map((item, i) => ({ item, slot: slots[i] }))

    // Pipeline gate: no item enters an outfit with unscored / default
    // dimensions — vision-score any incomplete item's image first.
    await ensureItemsScored([anchor, ...additions.map((a) => a.item)])

    const projRes = await ensureComposerProject()
    if (projRes.error || !projRes.projectId) return { error: projRes.error ?? 'No project' }
    const projectId = projRes.projectId

    const anchorSlot = slotForItemType(anchor.item_type)
    const allEntries = [{ item: anchor, slot: anchorSlot }, ...additions]

    const slotScores = deriveSlotScores(allEntries)
    const outfitLevel = deriveOutfitLevelScores(anchor, additions)
    // Real occasion scores derived from the items — never the defaulted 3s.
    const occasionScores = deriveOccasionScores(allEntries)
    // Full 34-dim taste vector, computed at composition time.
    const tasteVector = vectorForCandidate(allEntries, occasionScores, outfitLevel, slotScores)

    const allBrandIds = Array.from(new Set(
      allEntries.map(e => e.item.brand_id).filter((id): id is string => !!id),
    ))

    const aestheticLabel = `COMPOSED · ${anchor.product_name.toUpperCase()}`

    // The outfit's display image starts as the anchor's photo. When that photo
    // isn't already on Cloudinary (e.g. a raw retailer URL captured at ingest),
    // persist it now — retailer CDNs reject the image optimizer's server-side
    // fetch, which left new outfits with broken hero images on the public feed.
    let displayImageUrl = anchor.image_url
    if (displayImageUrl && !isCloudinaryUrl(displayImageUrl)) {
      const stable = await persistImageToCloudinary(displayImageUrl, {
        folder: 'outfit-saves',
        publicId: `anchor-${anchor.item_id}`,
      })
      if (stable) displayImageUrl = stable
    }

    const { data: outfit, error: outfitErr } = await supabase
      .from('outfit')
      .insert([{
        image_url: displayImageUrl,
        aesthetic_label: aestheticLabel,
        occasion_tags: [],
        source_brand_ids: allBrandIds,
        status: 'draft',
        project_id: projectId,
        admin_notes: 'Generated by Outfit Composer. Review and refine before publishing.',
        ...occasionScores,
        ...outfitLevel,
        ...slotScores,
        taste_vector: tasteVector,
        // Styling-set membership + stylist attribution (Part A/C). Every outfit
        // belongs to exactly one stylist; default resolves to Chloe.
        styling_set_id: opts?.stylingSetId ?? null,
        stylist_id: opts?.stylistId ?? (await (await import('@/lib/stylist-store')).resolveStylistId(null)),
        variant_direction: opts?.variantDirection ?? null,
      }])
      .select('outfit_id')
      .single()

    if (outfitErr) throw outfitErr
    const outfitId = (outfit as { outfit_id: string }).outfit_id

    // Link outfit_item rows for anchor + every addition
    const outfitItemRows = allEntries.map((entry, idx) => ({
      outfit_id: outfitId,
      item_id: entry.item.item_id,
      slot: entry.slot,
      sort_order: idx,
    }))
    const { error: linkErr } = await supabase.from('outfit_item').insert(outfitItemRows)
    if (linkErr) throw linkErr

    // Append outfit_id to project.outfit_ids
    const { data: project } = await supabase
      .from('admin_project')
      .select('outfit_ids')
      .eq('project_id', projectId)
      .single()
    const newIds = [...((project as { outfit_ids: string[] } | null)?.outfit_ids ?? []), outfitId]
    await supabase.from('admin_project').update({ outfit_ids: newIds }).eq('project_id', projectId)

    revalidatePath('/admin/composer')
    revalidatePath(`/admin/projects/${projectId}`)

    // Auto-generate a Refined Higgsfield shoot in the background. Fire-and-forget
    // so Approve to Draft returns instantly; the image attaches to the outfit's
    // additional_images (~30–60s, ~1 credit) and shows when the draft is opened.
    // Never let a shoot failure break approval. Callers that drive the shoot
    // themselves (e.g. Outfit Review, which awaits it for live status) pass
    // autoShoot:false so it isn't generated twice.
    if (opts?.autoShoot !== false) {
      void generateHiggsfieldShootForOutfit(outfitId, 'F6').catch((err) =>
        console.error('[approveCandidate→higgsfield]', err),
      )
    }

    // Auto-generate occasion tags from the outfit's items (fast; fire-and-forget).
    void generateOccasionTags(outfitId, { skipIfTagged: true }).catch((err) =>
      console.error('[approveCandidate→occasionTags]', err),
    )

    // Style Brain: this YES is a positive training signal — learn the combination.
    if (opts?.recordDecision !== false) {
      await recordStyleDecision({
        items: allEntries.map((e) => toFeature(e.item)),
        decision: 'approve',
        source: opts?.source ?? 'composer',
        anchorItemId,
        itemIds: allEntries.map((e) => e.item.item_id),
        baseScore: opts?.score ?? null,
        stylistId: opts?.stylistId ?? null,
      })
      // Constitution learning: every material pairing in an approved outfit
      // grows the pairing table.
      void recordMaterialPairings(allEntries.map((e) => toHouseItem(e.item, e.slot)), 'approve')
    }

    return { outfitId, projectId }
  } catch (err: unknown) {
    console.error('[approveCandidate]', err)
    return { error: err instanceof Error ? err.message : 'Approve failed' }
  }
}

// Style Brain: record a SWAP (or remove). Captures the piece swapped OUT as a
// soft negative, the from→to detail, AND the full scored-dimension delta
// (e.g. colour_family: cream→black) — the swap's "reason". Each swap is also an
// EJECTION with context (slot + formality band + occasion), feeding the
// candidate-pool exclusion and quarantine rules. Fire-and-forget safe.
export async function recordSwap(
  anchorItemId: string,
  fromItemId: string,
  toItemId?: string | null,
  context?: { candidateItemIds?: string[]; occasion?: string | null },
): Promise<{ ok: true }> {
  try {
    const [anchor, from, to] = await Promise.all([
      getItem(anchorItemId),
      getItem(fromItemId),
      toItemId ? getItem(toItemId) : Promise.resolve(null),
    ])
    if (!anchor || !from) return { ok: true }
    const label = (it: ItemWithBrand) => [it.brand?.name, it.product_name].filter(Boolean).join(' — ') || (it.item_type as string)
    const changed: string[] = []
    if (to) {
      if (String(from.item_type) !== String(to.item_type)) changed.push('type')
      if ((from as any).colour_family !== (to as any).colour_family) changed.push('colour')
      if ((from.brand?.name ?? '') !== (to.brand?.name ?? '')) changed.push('brand')
    }
    // "completely different" = a different item type, or two+ attributes changed.
    const different = to ? (changed.includes('type') || changed.length >= 2) : true

    // The scored-dimension diff of outgoing vs incoming — the swap reason.
    const deltas = to ? computeSwapDeltas(from as any, to as any) : {}

    // Ejection context: the formality band of the outfit being edited (from its
    // candidate items when the client passes them, else anchor + ejected item).
    const ctxItems = context?.candidateItemIds?.length
      ? ((await Promise.all(context.candidateItemIds.map((id) => getItem(id)))).filter(Boolean) as ItemWithBrand[])
      : [anchor, from]
    const band = formalityBand(ctxItems as any[])
    const slot = slotForItemType(from.item_type)

    await Promise.all([
      recordStyleDecision({
        items: [toFeature(anchor), toFeature(from)],
        decision: 'skip',
        source: 'swap',
        anchorItemId,
        itemIds: [anchor.item_id, from.item_id],
        extraFeatures: {
          swap: {
            action: to ? 'swap' : 'remove',
            from: label(from),
            to: to ? label(to) : null,
            fromType: from.item_type,
            toType: to?.item_type ?? null,
            changed,
            different,
            deltas,
            slot,
            band,
          },
        },
      }),
      recordEjection({
        itemId: from.item_id,
        slot,
        band,
        occasion: context?.occasion ?? null,
        anchorItemId: anchor.item_id,
        replacedBy: to?.item_id ?? null,
        deltas,
      }),
    ])
    // Constitution learning: the ejected item's material pairings (against the
    // rest of the outfit being edited) are rejections — only pairs involving
    // the ejected piece, not the pairs she kept.
    const others = ctxItems.filter((i) => i.item_id !== from.item_id)
    if (others.length) {
      void recordMaterialPairings(
        [toHouseItem(from), ...others.map((i) => toHouseItem(i))].slice(0, 6),
        'reject',
        from.item_id,
      )
    }
  } catch (err) {
    console.error('[recordSwap]', err)
  }
  return { ok: true }
}

// Fast-lane feedback: a one-tap approve with no edits is a clean approve; an
// approve after swapping/adding anything is an OVERRIDE (the gate was wrong).
// Overrides tighten the fast-lane threshold; a sustained clean streak relaxes
// it. Fire-and-forget safe.
export async function recordFastLaneOutcome(event: 'override' | 'clean_approve'): Promise<{ ok: true }> {
  try {
    const { applyFastLaneEvent } = await import('@/lib/pipeline-store')
    await applyFastLaneEvent(event)
    // Autonomy tracker: a fast-lane review outcome (variant-level).
    const { foldAutonomyReview } = await import('@/lib/stylist-store')
    await foldAutonomyReview(null, { lane: 'fast', swapped: event === 'override', approved: true })
  } catch (err) {
    console.error('[recordFastLaneOutcome]', err)
  }
  return { ok: true }
}

// Autonomy tracker: fold any reviewed variant (either lane, any outcome) into
// the stylist's graduation state. Fire-and-forget safe.
export async function recordReviewOutcome(
  lane: 'fast' | 'standard',
  swapped: boolean,
  approved: boolean,
  stylistId?: string | null,
): Promise<{ ok: true }> {
  try {
    const { foldAutonomyReview } = await import('@/lib/stylist-store')
    await foldAutonomyReview(stylistId ?? null, { lane, swapped, approved })
  } catch (err) {
    console.error('[recordReviewOutcome]', err)
  }
  return { ok: true }
}

// Style Brain: record a SKIP (negative signal) when a shown candidate is passed
// over. Fetches full item attributes server-side from the ids. Fire-and-forget
// safe — never blocks the UI, never throws.
export async function recordSkipDecision(
  anchorItemId: string,
  itemIds: string[],
  source: 'composer' | 'review' | 'swap' = 'review',
  score?: number,
): Promise<{ ok: true }> {
  try {
    const anchor = await getItem(anchorItemId)
    const items = (await Promise.all(itemIds.map((id) => getItem(id)))).filter(Boolean) as ItemWithBrand[]
    const all = [anchor, ...items].filter(Boolean) as ItemWithBrand[]
    if (all.length >= 2) {
      await recordStyleDecision({
        items: all.map(toFeature),
        decision: 'skip',
        source,
        anchorItemId,
        itemIds: all.map((i) => i.item_id),
        baseScore: score ?? null,
      })
    }
  } catch (err) {
    console.error('[recordSkipDecision]', err)
  }
  return { ok: true }
}
