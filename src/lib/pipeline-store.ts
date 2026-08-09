// Server-side persistence for the self-critiquing composer pipeline.
// Pure logic lives in pipeline.ts; this file owns the DB.
import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { buildOutfitVector } from '@/lib/taste-vector'
import { slotForItemType } from '@/lib/composer'
import type { ItemWithBrand } from '@/lib/admin-queries'
import type { OutfitWithItems } from '@/types/database'
import {
  buildEjectionConstraints,
  computeSwapDeltas,
  itemNeedsScoring,
  nextThreshold,
  QUARANTINE_AFTER,
  type EjectionConstraints,
  type FormalityBand,
  type SwapDeltas,
} from '@/lib/pipeline'
import { analyseProductImage } from '@/app/admin/items/analyse-image'

// ── Ejections ────────────────────────────────────────────────────────────────

export async function loadEjectionConstraints(): Promise<EjectionConstraints> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('item_ejection' as any)
      .select('item_id, slot, formality_band')
      .limit(20000)
    return buildEjectionConstraints((data ?? []) as any[])
  } catch {
    return buildEjectionConstraints([])
  }
}

// Insert one ejection AND fold its deltas into the aggregated swap_rule table
// (directional rules per slot + formality band, e.g. colour: cream → black).
export async function recordEjection(opts: {
  itemId: string
  slot: string
  band: FormalityBand | 'any'
  occasion?: string | null
  anchorItemId?: string | null
  replacedBy?: string | null
  deltas: SwapDeltas
}): Promise<void> {
  try {
    const admin = createAdminClient()
    await (admin.from('item_ejection') as any).insert({
      item_id: opts.itemId,
      slot: opts.slot,
      formality_band: opts.band,
      occasion: opts.occasion ?? null,
      anchor_item_id: opts.anchorItemId ?? null,
      replaced_by: opts.replacedBy ?? null,
      deltas: opts.deltas,
    })
    for (const [dimension, d] of Object.entries(opts.deltas)) {
      const key = {
        slot: opts.slot,
        formality_band: opts.band,
        dimension,
        from_value: String(d.from),
        to_value: String(d.to),
      }
      const { data: existing } = await admin
        .from('swap_rule' as any)
        .select('id, count')
        .match(key)
        .maybeSingle()
      if (existing) {
        await (admin.from('swap_rule') as any)
          .update({ count: (existing as any).count + 1, updated_at: new Date().toISOString() })
          .eq('id', (existing as any).id)
      } else {
        await (admin.from('swap_rule') as any).insert({ ...key, count: 1 })
      }
    }
  } catch (err) {
    console.error('[recordEjection]', err)
  }
}

export interface SwapRuleRow {
  slot: string
  formality_band: string
  dimension: string
  from_value: string
  to_value: string
  count: number
  updated_at: string
}

export async function loadSwapRules(limit = 30, since?: string): Promise<SwapRuleRow[]> {
  try {
    const admin = createAdminClient()
    let q = admin
      .from('swap_rule' as any)
      .select('slot, formality_band, dimension, from_value, to_value, count, updated_at')
      .order('count', { ascending: false })
      .limit(limit)
    if (since) q = q.gte('updated_at', since)
    const { data } = await q
    return (data ?? []) as any[]
  } catch {
    return []
  }
}

// Quarantined items (3+ ejections) with display info — the weekly
// "retire or keep?" list.
export interface QuarantinedItem {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string | null
  item_type: string
  ejections: number
  contexts: string[]
  last_ejected: string
}

export async function loadQuarantinedItems(): Promise<QuarantinedItem[]> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('item_ejection' as any)
      .select('item_id, slot, formality_band, created_at')
      .limit(20000)
    const rows = (data ?? []) as any[]
    const byItem = new Map<string, { n: number; contexts: Set<string>; last: string }>()
    for (const r of rows) {
      const cur = byItem.get(r.item_id) ?? { n: 0, contexts: new Set<string>(), last: r.created_at }
      cur.n++
      cur.contexts.add(`${r.slot ?? 'any'} / ${r.formality_band ?? 'any'}`)
      if (r.created_at > cur.last) cur.last = r.created_at
      byItem.set(r.item_id, cur)
    }
    const ids = [...byItem.entries()].filter(([, v]) => v.n >= QUARANTINE_AFTER).map(([id]) => id)
    if (!ids.length) return []
    const { data: items } = await admin
      .from('item' as any)
      .select('item_id, product_name, image_url, item_type, brand:brand_id(name)')
      .in('item_id', ids)
    return ((items ?? []) as any[]).map((it) => {
      const v = byItem.get(it.item_id)!
      return {
        item_id: it.item_id,
        product_name: it.product_name,
        brand_name: it.brand?.name ?? null,
        image_url: it.image_url,
        item_type: String(it.item_type),
        ejections: v.n,
        contexts: [...v.contexts],
        last_ejected: v.last,
      }
    }).sort((a, b) => b.ejections - a.ejections)
  } catch {
    return []
  }
}

// One-off: rebuild item_ejection from the existing style_decision swap history
// (rows recorded before this pipeline existed). Refuses to run twice.
export async function backfillEjectionsFromHistory(): Promise<{ inserted: number; error?: string }> {
  try {
    const admin = createAdminClient()
    const { count } = await admin
      .from('item_ejection' as any)
      .select('*', { count: 'exact', head: true })
    if ((count ?? 0) > 0) return { inserted: 0, error: 'item_ejection already has rows — backfill skipped' }
    const { data } = await admin
      .from('style_decision' as any)
      .select('item_ids, features, anchor_item_id, created_at')
      .eq('source', 'swap')
      .order('created_at', { ascending: true })
      .limit(10000)
    const rows = (data ?? []) as any[]
    const inserts = rows
      .map((r) => {
        const ejectedId = r.item_ids?.[1]
        if (!ejectedId) return null
        const fromType = r.features?.swap?.fromType
        let slot: string = 'any'
        try { if (fromType) slot = slotForItemType(fromType) } catch { /* unknown type */ }
        return {
          item_id: ejectedId,
          slot,
          formality_band: 'any',
          anchor_item_id: r.anchor_item_id ?? null,
          deltas: {},
          created_at: r.created_at,
        }
      })
      .filter(Boolean)
    if (inserts.length) {
      const { error } = await (admin.from('item_ejection') as any).insert(inserts)
      if (error) return { inserted: 0, error: error.message }
    }
    return { inserted: inserts.length }
  } catch (err) {
    return { inserted: 0, error: err instanceof Error ? err.message : 'Backfill failed' }
  }
}

// ── Vision scoring at composition time ───────────────────────────────────────

// Ensure every item is genuinely scored before its outfit enters the pipeline.
// Vision-scores any item with unscored / default dimensions and writes the
// scores back onto the item row (never overwriting a real curated value).
const VISION_FIELDS = [
  'colour_family', 'colour_hex', 'material_category', 'material_primary',
  'fit', 'length', 'rise', 'structure', 'shoulder', 'waist_definition', 'leg_opening',
  'surface', 'colour_depth', 'pattern', 'sheen', 'material_weight', 'material_formality',
  'jewellery_scale', 'jewellery_formality',
] as const

export async function ensureItemsScored(items: ItemWithBrand[]): Promise<{ scored: string[]; failed: string[] }> {
  const scored: string[] = []
  const failed: string[] = []
  const admin = createAdminClient()
  for (const item of items) {
    const it = item as any
    if (!itemNeedsScoring(it)) continue
    if (!it.image_url) { failed.push(it.item_id); continue }
    try {
      const { data, error } = await analyseProductImage(it.image_url)
      if (error || !data) { failed.push(it.item_id); continue }
      const update: Record<string, unknown> = {}
      for (const f of VISION_FIELDS) {
        const v = (data as any)[f]
        if (v == null) continue
        // Fill blanks always; replace an untouched default 3 with the vision read.
        if (it[f] == null || it[f] === 3) update[f] = v
      }
      if (Object.keys(update).length) {
        await (admin.from('item') as any).update(update).eq('item_id', it.item_id)
        Object.assign(it, update) // callers keep working with fresh scores
      }
      scored.push(it.item_id)
    } catch (err) {
      console.error('[ensureItemsScored]', it.item_id, err)
      failed.push(it.item_id)
    }
  }
  return { scored, failed }
}

// ── Vector at composition time ───────────────────────────────────────────────

// Build the full 34-dim taste vector for a candidate the moment it's composed —
// shaped exactly like a stored outfit so cosine against approved history works.
export function vectorForCandidate(
  entries: { item: ItemWithBrand; slot: string }[],
  occasion: { formality: number; planning: number; wearer_priority: number; time_of_day: number },
  outfitLevel: Record<string, number | null>,
  slotScores: Record<string, number | null>,
): number[] {
  const pseudo = {
    ...occasion,
    ...outfitLevel,
    ...slotScores,
    occasion_tags: [],
    outfit_item: entries.map((e) => ({ slot: e.slot, item: e.item })),
  } as unknown as OutfitWithItems
  return buildOutfitVector(pseudo)
}

// Vectors of every outfit Chloe has approved (any non-archived outfit — they
// all passed her hand). Prefers the stored taste_vector; falls back to
// building from items.
export async function loadApprovedVectors(limit = 1000): Promise<number[][]> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('outfit' as any)
      .select('*, outfit_item(*, item(*, brand(*)))')
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(limit)
    const outfits = (data ?? []) as unknown as OutfitWithItems[]
    return outfits.map((o) => {
      const tv = (o as any).taste_vector
      if (Array.isArray(tv) && tv.length) return tv as number[]
      if (typeof tv === 'string') {
        try { const a = JSON.parse(tv); if (Array.isArray(a) && a.length) return a } catch { /* fall through */ }
      }
      return buildOutfitVector(o)
    })
  } catch {
    return []
  }
}

// ── Composed-outfit staging (the pipeline queue) ─────────────────────────────

export interface StagedOutfit {
  id: string
  anchor_item_id: string
  item_ids: string[]
  slots: string[]
  taste_vector: number[] | null
  base_score: number | null
  confidence: number | null
  lane: 'fast' | 'standard'
  reasons: string[]
  occasion_scores: Record<string, number>
  status: string
  overridden: boolean
  outfit_id: string | null
  prerender_status: string
  prerender_image_url: string | null
  created_at: string
  styling_set_id: string | null
  stylist_id: string | null
  variant_direction: string | null
  set_size: number | null
}

export async function stageComposedOutfit(row: {
  anchorItemId: string
  itemIds: string[]
  slots: string[]
  vector: number[]
  baseScore: number
  confidence: number
  lane: 'fast' | 'standard'
  reasons: string[]
  occasionScores: Record<string, number>
  // Styling-set membership (Part A) + stylist attribution (Part C).
  stylingSetId?: string | null
  stylistId?: string | null
  variantDirection?: string | null
  setSize?: number | null
}): Promise<string | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await (admin.from('composed_outfit') as any)
      .insert({
        anchor_item_id: row.anchorItemId,
        item_ids: row.itemIds,
        slots: row.slots,
        taste_vector: row.vector,
        base_score: row.baseScore,
        confidence: row.confidence,
        lane: row.lane,
        reasons: row.reasons,
        occasion_scores: row.occasionScores,
        styling_set_id: row.stylingSetId ?? null,
        stylist_id: row.stylistId ?? null,
        variant_direction: row.variantDirection ?? null,
        set_size: row.setSize ?? null,
      })
      .select('id')
      .single()
    if (error) throw error
    return (data as any).id as string
  } catch (err) {
    console.error('[stageComposedOutfit]', err)
    return null
  }
}

export async function loadPipelineQueue(lane?: 'fast' | 'standard'): Promise<StagedOutfit[]> {
  try {
    const admin = createAdminClient()
    let q = admin
      .from('composed_outfit' as any)
      .select('*')
      .eq('status', 'pending')
      .order('confidence', { ascending: false })
      .limit(200)
    if (lane) q = q.eq('lane', lane)
    const { data } = await q
    return ((data ?? []) as any[]).map((r) => ({
      ...r,
      taste_vector: Array.isArray(r.taste_vector) ? r.taste_vector : null,
      reasons: Array.isArray(r.reasons) ? r.reasons : [],
      occasion_scores: r.occasion_scores ?? {},
    }))
  } catch {
    return []
  }
}

export async function markComposedOutfit(
  id: string,
  patch: Partial<{
    status: 'pending' | 'approved' | 'rejected'
    overridden: boolean
    outfit_id: string
    prerender_status: 'none' | 'queued' | 'done' | 'failed'
    prerender_image_url: string
  }>,
): Promise<void> {
  try {
    const admin = createAdminClient()
    const update: Record<string, unknown> = { ...patch }
    if (patch.status && patch.status !== 'pending') update.decided_at = new Date().toISOString()
    await (admin.from('composed_outfit') as any).update(update).eq('id', id)
  } catch (err) {
    console.error('[markComposedOutfit]', err)
  }
}

// ── Adaptive fast-lane threshold ─────────────────────────────────────────────

export interface PipelineConfig {
  fast_lane_threshold: number
  fast_lane_approvals: number
  fast_lane_overrides: number
  clean_streak: number
  threshold_log: { at: string; from: number; to: number; event: string }[]
}

const DEFAULT_CONFIG: PipelineConfig = {
  fast_lane_threshold: 0.82,
  fast_lane_approvals: 0,
  fast_lane_overrides: 0,
  clean_streak: 0,
  threshold_log: [],
}

export async function loadPipelineConfig(): Promise<PipelineConfig> {
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('pipeline_config' as any).select('*').eq('id', 1).maybeSingle()
    if (!data) return { ...DEFAULT_CONFIG }
    const r = data as any
    return {
      fast_lane_threshold: Number(r.fast_lane_threshold ?? DEFAULT_CONFIG.fast_lane_threshold),
      fast_lane_approvals: r.fast_lane_approvals ?? 0,
      fast_lane_overrides: r.fast_lane_overrides ?? 0,
      clean_streak: r.clean_streak ?? 0,
      threshold_log: Array.isArray(r.threshold_log) ? r.threshold_log : [],
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

// A fast-lane decision happened: clean one-tap approve, or an override (she had
// to swap/edit something the gate said was safe). Overrides TIGHTEN the
// threshold; a sustained clean streak relaxes it slightly.
export async function applyFastLaneEvent(event: 'override' | 'clean_approve'): Promise<PipelineConfig> {
  const cfg = await loadPipelineConfig()
  const res = nextThreshold(cfg.fast_lane_threshold, event, cfg.clean_streak)
  const next: PipelineConfig = {
    fast_lane_threshold: res.threshold,
    fast_lane_approvals: cfg.fast_lane_approvals + 1,
    fast_lane_overrides: cfg.fast_lane_overrides + (event === 'override' ? 1 : 0),
    clean_streak: res.cleanStreak,
    threshold_log: res.changed
      ? [...cfg.threshold_log, { at: new Date().toISOString(), from: cfg.fast_lane_threshold, to: res.threshold, event }].slice(-50)
      : cfg.threshold_log,
  }
  try {
    const admin = createAdminClient()
    await (admin.from('pipeline_config') as any)
      .upsert({ id: 1, ...next, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  } catch (err) {
    console.error('[applyFastLaneEvent]', err)
  }
  return next
}
