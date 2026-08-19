// STYLIST DATA MODEL — server-side store.
//
// Architecture principle: ONE shared item library. Stylists are lenses over it,
// never separate inventories. Every composer run happens in the context of one
// stylist: their constitution, their vector_range, their item mask, their own
// learning state and autonomy stage.
import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { buildOutfitVector, VECTOR_DIM } from '@/lib/taste-vector'
import type { OutfitWithItems } from '@/types/database'
import {
  emptyAutonomy,
  recordReview,
  checkStage3Promotion,
  applyIntervention,
  type AutonomyState,
} from '@/lib/autonomy'

export interface VectorRange {
  min: number[]
  max: number[]
  tolerance: number
}

export interface Stylist {
  stylist_id: string
  name: string
  slug: string
  type: 'real' | 'persona'
  status: 'draft' | 'seeding' | 'live' | 'paused'
  constitution: Record<string, unknown> | null
  vector_range: VectorRange | null
  moodboard: { url: string; vector?: number[] }[]
  centroid: number[] | null
  voice_notes: string | null
  // 0039: envelope computed from confirmed inspiration images (mean + spread).
  // envelope_status flips to 'needs_review' when the confirmed set changes
  // after go-live — the persona keeps behaving as it did until rules are re-read.
  envelope?: { mean: number[]; spread: number[]; n: number; tightness: number } | null
  envelope_status?: 'current' | 'needs_review' | null
  envelope_computed_at?: string | null
}

const DEFAULT_SLUG = 'chloe'

function parseStylist(r: any): Stylist {
  return {
    stylist_id: r.stylist_id,
    name: r.name,
    slug: r.slug,
    type: r.type,
    status: r.status,
    constitution: r.constitution ?? null,
    vector_range: r.vector_range ?? null,
    moodboard: Array.isArray(r.moodboard) ? r.moodboard : [],
    centroid: Array.isArray(r.centroid) ? r.centroid : null,
    voice_notes: r.voice_notes ?? null,
  }
}

export async function getStylistBySlug(slug: string): Promise<Stylist | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('stylist' as any).select('*').eq('slug', slug).maybeSingle()
    return data ? parseStylist(data) : null
  } catch {
    return null
  }
}

export async function getStylist(stylistId: string): Promise<Stylist | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('stylist' as any).select('*').eq('stylist_id', stylistId).maybeSingle()
    return data ? parseStylist(data) : null
  } catch {
    return null
  }
}

export async function listStylists(status?: string): Promise<Stylist[]> {
  try {
    const admin = createAdminClient()
    let q = admin.from('stylist' as any).select('*').order('created_at', { ascending: true })
    if (status) q = q.eq('status', status)
    const { data } = await q
    return ((data ?? []) as any[]).map(parseStylist)
  } catch {
    return []
  }
}

// Every legacy code path runs as Chloe. Resolved once per server invocation.
let defaultStylistId: string | null = null
export async function resolveStylistId(stylistId?: string | null): Promise<string | null> {
  if (stylistId) return stylistId
  if (defaultStylistId) return defaultStylistId
  const chloe = await getStylistBySlug(DEFAULT_SLUG)
  defaultStylistId = chloe?.stylist_id ?? null
  return defaultStylistId
}

// ── Vector range (the stylist's operating envelope) ──────────────────────────

// A stylist never composes outside their envelope. Dims where the range is
// unknown (min===max===null) are unconstrained.
export function withinVectorRange(vector: number[], range: VectorRange | null): boolean {
  if (!range || !Array.isArray(range.min) || !Array.isArray(range.max)) return true
  const tol = typeof range.tolerance === 'number' ? range.tolerance : 0.05
  for (let i = 0; i < Math.min(vector.length, range.min.length, range.max.length); i++) {
    const lo = range.min[i]
    const hi = range.max[i]
    if (lo == null || hi == null) continue
    if (vector[i] < lo - tol || vector[i] > hi + tol) return false
  }
  return true
}

// Observed per-dimension min/max over a set of vectors, with a small margin.
export function rangeFromVectors(vectors: number[][], tolerance = 0.05): VectorRange | null {
  if (!vectors.length) return null
  const min = new Array(VECTOR_DIM).fill(Infinity)
  const max = new Array(VECTOR_DIM).fill(-Infinity)
  for (const v of vectors) {
    for (let i = 0; i < VECTOR_DIM; i++) {
      const x = v[i] ?? 0.5
      if (x < min[i]) min[i] = x
      if (x > max[i]) max[i] = x
    }
  }
  return {
    min: min.map((x) => (x === Infinity ? 0 : Math.max(0, +(x).toFixed(4)))),
    max: max.map((x) => (x === -Infinity ? 1 : Math.min(1, +(x).toFixed(4)))),
    tolerance,
  }
}

// ── Item eligibility mask ────────────────────────────────────────────────────

export type ItemMask = Map<string, 'eligible' | 'excluded'>

export async function loadItemMask(stylistId: string): Promise<ItemMask> {
  const mask: ItemMask = new Map()
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('stylist_item_mask' as any)
      .select('item_id, eligibility')
      .eq('stylist_id', stylistId)
      .limit(20000)
    for (const r of (data ?? []) as any[]) mask.set(r.item_id, r.eligibility)
  } catch { /* fail-open */ }
  return mask
}

// Absent row = not yet scored → eligible (fail-open; the shared library is the
// default, exclusion is the exception).
export function itemEligible(mask: ItemMask, itemId: string): boolean {
  return mask.get(itemId) !== 'excluded'
}

// An item's footprint in taste-vector space: a single-item pseudo-outfit. Only
// the dimensions the item genuinely drives are meaningful, so range checks look
// at those (brand positioning, colour story, material) rather than the whole
// vector.
const ITEM_DRIVEN_DIMS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 30, 31]

export function itemWithinRange(item: any, range: VectorRange | null): boolean {
  if (!range) return true
  const pseudo = {
    occasion_tags: [],
    outfit_item: [{ slot: 'top', item }],
  } as unknown as OutfitWithItems
  const v = buildOutfitVector(pseudo)
  const tol = (typeof range.tolerance === 'number' ? range.tolerance : 0.05) + 0.05 // items get extra slack
  for (const i of ITEM_DRIVEN_DIMS) {
    const lo = range.min?.[i]
    const hi = range.max?.[i]
    if (lo == null || hi == null) continue
    if (v[i] < lo - tol || v[i] > hi + tol) return false
  }
  return true
}

// Score every item against a stylist's vector_range → auto mask rows. Manual
// overrides always win and are never overwritten by re-scoring.
export async function scoreItemMaskForStylist(stylistId: string): Promise<{ eligible: number; excluded: number }> {
  const admin = createAdminClient()
  const stylist = await getStylist(stylistId)
  if (!stylist) return { eligible: 0, excluded: 0 }
  const { data: items } = await admin
    .from('item' as any)
    .select('*, brand(*)')
    .in('status', ['ready', 'live'])
    .limit(5000)
  const { data: manual } = await admin
    .from('stylist_item_mask' as any)
    .select('item_id')
    .eq('stylist_id', stylistId)
    .eq('source', 'manual')
  const manualIds = new Set(((manual ?? []) as any[]).map((r) => r.item_id))

  let eligible = 0
  let excluded = 0
  const rows: any[] = []
  for (const it of (items ?? []) as any[]) {
    if (manualIds.has(it.item_id)) continue
    const ok = itemWithinRange(it, stylist.vector_range)
    if (ok) eligible++
    else excluded++
    rows.push({
      stylist_id: stylistId,
      item_id: it.item_id,
      eligibility: ok ? 'eligible' : 'excluded',
      source: 'auto',
      updated_at: new Date().toISOString(),
    })
  }
  // Upsert in chunks.
  for (let i = 0; i < rows.length; i += 500) {
    await (admin.from('stylist_item_mask') as any).upsert(rows.slice(i, i + 500), { onConflict: 'stylist_id,item_id' })
  }
  return { eligible, excluded }
}

// Auto-score one newly ingested item against every live stylist (called from
// ingestion paths; fire-and-forget safe).
export async function scoreNewItemForAllStylists(itemId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data: item } = await admin.from('item' as any).select('*, brand(*)').eq('item_id', itemId).maybeSingle()
    if (!item) return
    const stylists = await listStylists('live')
    for (const s of stylists) {
      const { data: existing } = await admin
        .from('stylist_item_mask' as any)
        .select('id, source')
        .eq('stylist_id', s.stylist_id)
        .eq('item_id', itemId)
        .maybeSingle()
      if ((existing as any)?.source === 'manual') continue // manual always wins
      const ok = itemWithinRange(item, s.vector_range)
      await (admin.from('stylist_item_mask') as any).upsert(
        { stylist_id: s.stylist_id, item_id: itemId, eligibility: ok ? 'eligible' : 'excluded', source: 'auto', updated_at: new Date().toISOString() },
        { onConflict: 'stylist_id,item_id' },
      )
    }
  } catch (err) {
    console.error('[scoreNewItemForAllStylists]', err)
  }
}

export async function setItemMaskOverride(
  stylistId: string,
  itemId: string,
  eligibility: 'eligible' | 'excluded',
): Promise<void> {
  const admin = createAdminClient()
  await (admin.from('stylist_item_mask') as any).upsert(
    { stylist_id: stylistId, item_id: itemId, eligibility, source: 'manual', updated_at: new Date().toISOString() },
    { onConflict: 'stylist_id,item_id' },
  )
}

// ── Per-stylist autonomy state ───────────────────────────────────────────────

export async function loadAutonomy(stylistId: string): Promise<AutonomyState & { schedule: string }> {
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('stylist_autonomy' as any).select('*').eq('stylist_id', stylistId).maybeSingle()
    if (!data) return { ...emptyAutonomy(), schedule: 'daily' }
    const r = data as any
    return {
      stage: (r.stage ?? 1) as 1 | 2 | 3,
      currentStreak: r.current_streak ?? 0,
      reviewedLog: Array.isArray(r.reviewed_log) ? r.reviewed_log : [],
      stage2Since: r.stage2_since ?? null,
      lastInterventionAt: r.last_intervention_at ?? null,
      demotions: Array.isArray(r.demotions) ? r.demotions : [],
      schedule: r.schedule ?? 'daily',
    }
  } catch {
    return { ...emptyAutonomy(), schedule: 'daily' }
  }
}

export async function saveAutonomy(stylistId: string, state: AutonomyState): Promise<void> {
  try {
    const admin = createAdminClient()
    await (admin.from('stylist_autonomy') as any).upsert(
      {
        stylist_id: stylistId,
        stage: state.stage,
        current_streak: state.currentStreak,
        reviewed_log: state.reviewedLog,
        stage2_since: state.stage2Since,
        last_intervention_at: state.lastInterventionAt,
        demotions: state.demotions,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'stylist_id' },
    )
  } catch (err) {
    console.error('[saveAutonomy]', err)
  }
}

// Fold one reviewed variant into a stylist's autonomy state (streak, trailing
// swap rate, promotion/demotion). Fire-and-forget safe.
export async function foldAutonomyReview(
  stylistId: string | null | undefined,
  entry: { lane: 'fast' | 'standard'; swapped: boolean; approved: boolean },
): Promise<void> {
  try {
    const sid = await resolveStylistId(stylistId)
    if (!sid) return
    const loaded = await loadAutonomy(sid)
    const state = checkStage3Promotion(recordReview(loaded, entry))
    await saveAutonomy(sid, state)
  } catch (err) {
    console.error('[foldAutonomyReview]', err)
  }
}

// An audit intervention on an auto-published outfit: demote per the rules and
// log the reason.
export async function foldAuditIntervention(
  stylistId: string | null | undefined,
  kind: 'swapped' | 'pulled',
): Promise<void> {
  try {
    const sid = await resolveStylistId(stylistId)
    if (!sid) return
    const state = applyIntervention(await loadAutonomy(sid), kind)
    await saveAutonomy(sid, state)
  } catch (err) {
    console.error('[foldAuditIntervention]', err)
  }
}

// ── Chloe backfill (stylist 001) ─────────────────────────────────────────────
// Idempotent: vector_range from approved history, mask = all ready/live items
// eligible, stylist_id on every outfit, retroactive styling_set_ids grouping
// outfits that share a hero item.

function heroOf(o: any): string | null {
  const its = ((o.outfit_item ?? []) as any[]).filter((oi) => oi.item_id)
  const bySlot = (slot: string) => its.find((oi) => oi.slot === slot)?.item_id
  return bySlot('dress') || bySlot('top') || bySlot('bottom') || bySlot('outerwear') || its[0]?.item_id || null
}

export async function runChloeBackfill(): Promise<{
  vectorRangeDims: number
  maskRows: number
  outfitsAttributed: number
  setsCreated: number
  error?: string
}> {
  try {
    const admin = createAdminClient()
    const chloe = await getStylistBySlug(DEFAULT_SLUG)
    if (!chloe) return { vectorRangeDims: 0, maskRows: 0, outfitsAttributed: 0, setsCreated: 0, error: 'Chloe stylist row missing — run migration 0022' }

    // 1. vector_range from approved-outfit history (all non-archived).
    const { data: outfits } = await admin
      .from('outfit' as any)
      .select('*, outfit_item(*, item(*, brand(*)))')
      .neq('status', 'archived')
      .limit(2000)
    const all = (outfits ?? []) as any[]
    const vectors = all.map((o) => buildOutfitVector(o as OutfitWithItems))
    const range = rangeFromVectors(vectors, 0.08)
    if (range && !chloe.vector_range) {
      await (admin.from('stylist' as any) as any)
        .update({ vector_range: range, updated_at: new Date().toISOString() })
        .eq('stylist_id', chloe.stylist_id)
    }

    // 2. Item mask: all current ready/live items eligible.
    const { data: items } = await admin.from('item' as any).select('item_id').in('status', ['ready', 'live']).limit(20000)
    const maskRows = ((items ?? []) as any[]).map((it) => ({
      stylist_id: chloe.stylist_id,
      item_id: it.item_id,
      eligibility: 'eligible',
      source: 'auto',
    }))
    for (let i = 0; i < maskRows.length; i += 500) {
      await (admin.from('stylist_item_mask') as any).upsert(maskRows.slice(i, i + 500), { onConflict: 'stylist_id,item_id', ignoreDuplicates: true })
    }

    // 3. stylist_id on every outfit.
    const { count: attributed } = await (admin.from('outfit') as any)
      .update({ stylist_id: chloe.stylist_id }, { count: 'exact' })
      .is('stylist_id', null)

    // 4. Retroactive styling sets: group outfits sharing a hero item.
    const byHero = new Map<string, any[]>()
    for (const o of all) {
      const hero = heroOf(o)
      if (!hero) continue
      const arr = byHero.get(hero) ?? []
      arr.push(o)
      byHero.set(hero, arr)
    }
    let setsCreated = 0
    for (const [hero, members] of byHero) {
      // Skip outfits that already belong to a set.
      const unset = members.filter((o: any) => !o.styling_set_id)
      if (!unset.length) continue
      const { data: setRow, error: setErr } = await (admin.from('styling_set') as any)
        .insert({
          stylist_id: chloe.stylist_id,
          hero_item_id: hero,
          status: unset.filter((o: any) => o.status === 'live').length >= 2 ? 'live' : 'under_styled',
          target_size: 4,
        })
        .select('styling_set_id')
        .single()
      if (setErr || !setRow) continue
      await (admin.from('outfit') as any)
        .update({ styling_set_id: (setRow as any).styling_set_id })
        .in('outfit_id', unset.map((o: any) => o.outfit_id))
      setsCreated++
    }

    return {
      vectorRangeDims: range ? VECTOR_DIM : 0,
      maskRows: maskRows.length,
      outfitsAttributed: attributed ?? 0,
      setsCreated,
    }
  } catch (err) {
    console.error('[runChloeBackfill]', err)
    return { vectorRangeDims: 0, maskRows: 0, outfitsAttributed: 0, setsCreated: 0, error: err instanceof Error ? err.message : 'Backfill failed' }
  }
}
