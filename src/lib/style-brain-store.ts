// Server-side persistence for the Style Brain. Plain (non-action) functions so
// the composer and the admin page can both call them. Uses the admin client.
import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { cosine, buildOutfitVector } from '@/lib/taste-vector'
import type { OutfitWithItems } from '@/types/database'
import {
  type StyleModel,
  type FeatureItem,
  emptyModel,
  applyDecision,
  applyOffer,
  extractFeatures,
  buildHouseStyle,
} from '@/lib/style-brain'

// Load the live learned model for a stylist (default: Chloe). Every stylist has
// an independent learning state. Falls back to the legacy singleton row, then to
// an empty model, so the composer keeps working before migrations are run.
export async function loadStyleModel(stylistId?: string | null): Promise<StyleModel> {
  const parse = (raw: unknown): StyleModel | null => {
    const m = raw as Partial<StyleModel> | null
    if (!m || typeof m !== 'object' || !m.version) return null
    return { ...emptyModel(), ...m, singles: m.singles ?? {}, pairs: m.pairs ?? {}, offers: (m as any).offers ?? {}, offerCount: (m as any).offerCount ?? 0 } as StyleModel
  }
  try {
    const admin = createAdminClient()
    const { resolveStylistId } = await import('@/lib/stylist-store')
    const sid = await resolveStylistId(stylistId)
    if (sid) {
      const { data } = await admin.from('stylist_model' as any).select('model').eq('stylist_id', sid).maybeSingle()
      const m = parse((data as any)?.model)
      if (m) return m
    }
    // Legacy singleton (pre-0022) — Chloe's original model.
    const { data, error } = await admin.from('style_model' as any).select('model').eq('id', 1).maybeSingle()
    if (error || !data) return emptyModel()
    return parse((data as any).model) ?? emptyModel()
  } catch {
    return emptyModel()
  }
}

// ── Recent swaps ─────────────────────────────────────────────────────────────
// What was swapped out, what for, and whether it was a completely different
// piece — read from the swap decisions' stored metadata.
export interface SwapRecord { from: string; to: string | null; action: string; changed: string[]; different: boolean; at: string }
export async function loadRecentSwaps(limit = 20): Promise<{ recent: SwapRecord[]; total: number; differentCount: number } | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('style_decision' as any)
      .select('features, created_at')
      .eq('source', 'swap')
      .order('created_at', { ascending: false })
      .limit(2000)
    if (error || !data) return null
    const all = (data as any[])
      .map((r) => ({ swap: r.features?.swap, at: r.created_at as string }))
      .filter((r) => r.swap)
    const recent = all.slice(0, limit).map((r) => ({
      from: r.swap.from ?? '—', to: r.swap.to ?? null, action: r.swap.action ?? 'swap',
      changed: Array.isArray(r.swap.changed) ? r.swap.changed : [], different: !!r.swap.different, at: r.at,
    }))
    return { recent, total: all.length, differentCount: all.filter((r) => r.swap.different).length }
  } catch {
    return null
  }
}

// ── Site taste profile (radar) ───────────────────────────────────────────────
// The 34-dim outfit vector grouped into interpretable axes. We show two shapes:
// CATALOGUE = the average of every live outfit (what you've built), and PEOPLE =
// the view-weighted average (what visitors gravitate to). Comparing the two
// shows where demand pulls away from supply.
const TASTE_AXES: { label: string; dims: number[] }[] = [
  { label: 'STRUCTURED', dims: [0, 4] },
  { label: 'VOLUME', dims: [6] },
  { label: 'PRINT / SURFACE', dims: [1, 5] },
  { label: 'DRESSY', dims: [3, 30, 33, 29] },
  { label: 'ELEVATED BRANDS', dims: [9, 11, 12, 13] },
  { label: 'NEUTRAL PALETTE', dims: [14] },
  { label: 'BOLD COLOUR', dims: [20, 21] },
  { label: 'LAYERED', dims: [2, 25] },
  { label: 'STATEMENT ACCESS.', dims: [28, 27] },
]
export interface TasteAxis {
  label: string
  catalogue: number
  people: number
  // Share of live outfits scoring low (<0.33) / mid / high (≥0.66) on this axis.
  low: number
  mid: number
  high: number
}
export async function loadSiteTasteProfile(): Promise<{ axes: TasteAxis[]; n: number; hasPeople: boolean } | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('outfit' as any)
      .select('*, outfit_item(*, item(*, brand(*)))')
      .eq('status', 'live')
      .limit(2000)
    if (error || !data) return null
    const outfits = data as unknown as OutfitWithItems[]
    if (!outfits.length) return { axes: [], n: 0, hasPeople: false }

    // View weights (what people gravitate to).
    const viewC = new Map<string, number>()
    const { data: ev } = await admin.from('landing_event' as any).select('path').eq('event_type', 'outfit_view').limit(100000)
    for (const e of (ev ?? []) as { path: string }[]) viewC.set(e.path, (viewC.get(e.path) ?? 0) + 1)

    const DIM = 34
    const catAcc = new Array(DIM).fill(0)
    const peoAcc = new Array(DIM).fill(0)
    let peoW = 0
    for (const o of outfits) {
      const v = buildOutfitVector(o)
      for (let i = 0; i < DIM; i++) catAcc[i] += v[i] ?? 0
      const w = viewC.get((o as any).outfit_id) ?? 0
      if (w > 0) { for (let i = 0; i < DIM; i++) peoAcc[i] += (v[i] ?? 0) * w; peoW += w }
    }
    const catVec = catAcc.map((x) => x / outfits.length)
    const hasPeople = peoW > 0
    const peoVec = hasPeople ? peoAcc.map((x) => x / peoW) : catVec
    const axisVal = (vec: number[], dims: number[]) => dims.reduce((s, d) => s + (vec[d] ?? 0), 0) / dims.length

    // Per-axis distribution: what share of individual outfits land low/mid/high.
    const dist = TASTE_AXES.map(() => ({ low: 0, mid: 0, high: 0 }))
    for (const o of outfits) {
      const v = buildOutfitVector(o)
      TASTE_AXES.forEach((a, ai) => {
        const val = axisVal(v, a.dims)
        if (val < 0.33) dist[ai].low++
        else if (val < 0.66) dist[ai].mid++
        else dist[ai].high++
      })
    }
    const n = outfits.length
    const axes = TASTE_AXES.map((a, ai) => ({
      label: a.label,
      catalogue: axisVal(catVec, a.dims),
      people: axisVal(peoVec, a.dims),
      low: dist[ai].low / n,
      mid: dist[ai].mid / n,
      high: dist[ai].high / n,
    }))
    return { axes, n, hasPeople }
  } catch {
    return null
  }
}

// ── Taste spread / diversity ─────────────────────────────────────────────────
// How varied the live outfits are in taste-vector space. spread = 1 − average
// cosine of each outfit to the collection centroid: high = a wide range of
// aesthetics, low = everything clusters around one look ("samey").
export async function loadTasteSpread(): Promise<{ spread: number; label: string; n: number } | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('outfit' as any).select('taste_vector').eq('status', 'live').limit(5000)
    if (error || !data) return null
    const parse = (v: unknown): number[] | null => {
      if (Array.isArray(v)) return v as number[]
      if (typeof v === 'string') { try { const a = JSON.parse(v); return Array.isArray(a) ? a : null } catch { return null } }
      return null
    }
    const vecs = (data as any[]).map((o) => parse(o.taste_vector)).filter((v): v is number[] => !!v && v.length > 0)
    if (vecs.length < 3) return { spread: 0, label: 'NOT ENOUGH SCORED OUTFITS', n: vecs.length }
    const dim = vecs[0].length
    const centroid = new Array(dim).fill(0)
    for (const v of vecs) for (let i = 0; i < dim; i++) centroid[i] += v[i] ?? 0
    for (let i = 0; i < dim; i++) centroid[i] /= vecs.length
    const avgCos = vecs.reduce((s, v) => s + cosine(v, centroid), 0) / vecs.length
    const spread = Math.max(0, Math.min(1, 1 - avgCos))
    const label = spread > 0.35 ? 'GOOD RANGE' : spread > 0.18 ? 'MODERATE' : 'QUITE SAMEY'
    return { spread, label, n: vecs.length }
  } catch {
    return null
  }
}

// ── Catalogue balance ────────────────────────────────────────────────────────
// Distribution of the LIVE outfit collection across occasions, colours, price
// bands and formality — so you can see where you're well-covered vs thin (a
// gap to fill or an over-concentration).
export interface CatalogueBalance {
  totalOutfits: number
  occasions: [string, number][]      // occasion tag → live-outfit count
  colours: [string, number][]        // colour family → item count
  priceBands: { label: string; count: number }[]
  formality: { label: string; count: number }[]
}
const PRICE_BANDS: { label: string; max: number }[] = [
  { label: 'UNDER 150', max: 150 },
  { label: '150–400', max: 400 },
  { label: '400–800', max: 800 },
  { label: '800+', max: Infinity },
]
const FORMALITY_LABELS = ['VERY CASUAL', 'CASUAL', 'SMART', 'DRESSY', 'FORMAL']
function parsePrice(p: unknown): number | null {
  if (p == null) return null
  const n = parseFloat(String(p).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? null : n
}
export async function loadCatalogueBalance(): Promise<CatalogueBalance | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('outfit' as any)
      .select('formality, occasion_tags, outfit_item(item(colour_family, price, item_type))')
      .eq('status', 'live')
      .limit(5000)
    if (error || !data) return null
    const outfits = data as any[]
    const occ = new Map<string, number>()
    const col = new Map<string, number>()
    const bands = new Map<string, number>(PRICE_BANDS.map((b) => [b.label, 0]))
    const form = new Map<string, number>(FORMALITY_LABELS.map((l) => [l, 0]))
    for (const o of outfits) {
      for (const t of (o.occasion_tags ?? []) as string[]) {
        const k = String(t).trim().toLowerCase()
        if (k) occ.set(k, (occ.get(k) ?? 0) + 1)
      }
      const fl = Math.max(1, Math.min(5, Math.round(o.formality ?? 3)))
      const flLabel = FORMALITY_LABELS[fl - 1]
      form.set(flLabel, (form.get(flLabel) ?? 0) + 1)
      for (const oi of (o.outfit_item ?? []) as any[]) {
        const it = oi.item
        if (!it) continue
        if (it.colour_family) col.set(it.colour_family, (col.get(it.colour_family) ?? 0) + 1)
        const price = parsePrice(it.price)
        if (price != null) {
          const band = PRICE_BANDS.find((b) => price < b.max) ?? PRICE_BANDS[PRICE_BANDS.length - 1]
          bands.set(band.label, (bands.get(band.label) ?? 0) + 1)
        }
      }
    }
    return {
      totalOutfits: outfits.length,
      occasions: [...occ.entries()].sort((a, b) => b[1] - a[1]),
      colours: [...col.entries()].sort((a, b) => b[1] - a[1]),
      priceBands: PRICE_BANDS.map((b) => ({ label: b.label, count: bands.get(b.label) ?? 0 })),
      formality: FORMALITY_LABELS.map((l) => ({ label: l, count: form.get(l) ?? 0 })),
    }
  } catch {
    return null
  }
}

// "Is it getting smarter?" stats, computed from the decision log. As the model
// learns your taste, the composer surfaces outfits you approve more often
// (approval rate rises) — comparing the recent half vs the early half shows the
// trend. avgApprovedScore = the composer's own coherence score on outfits you
// kept (quality of what it proposes).
export interface DecisionStats {
  total: number                // genuine approve/skip decisions (excludes swaps)
  approves: number
  skips: number
  swaps: number                // pieces swapped out / removed (source='swap')
  approvalRate: number         // 0..1
  earlyRate: number            // 0..1, first half
  recentRate: number           // 0..1, second half
  avgApprovedScore: number | null // 0..1
}
export async function loadDecisionStats(): Promise<DecisionStats | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('style_decision' as any)
      .select('decision, source, base_score, created_at')
      .order('created_at', { ascending: true })
      .limit(100000)
    if (error || !data) return null
    const allRows = data as { decision: string; source: string | null; base_score: number | null }[]
    const swaps = allRows.filter((r) => r.source === 'swap').length
    // Exclude swap-rejects from the approve/skip stats — they train the model but
    // aren't a deliberate approve/skip, so they shouldn't move the approval rate.
    const rows = allRows.filter((r) => r.source !== 'swap')
    const total = rows.length
    const approves = rows.filter((r) => r.decision === 'approve').length
    const rateOf = (arr: typeof rows) => (arr.length ? arr.filter((r) => r.decision === 'approve').length / arr.length : 0)
    const half = Math.floor(total / 2)
    const appScores = rows.filter((r) => r.decision === 'approve' && typeof r.base_score === 'number') as { base_score: number }[]
    return {
      total,
      approves,
      skips: total - approves,
      swaps,
      approvalRate: total ? approves / total : 0,
      earlyRate: rateOf(rows.slice(0, half)),
      recentRate: rateOf(rows.slice(half)),
      avgApprovedScore: appScores.length ? appScores.reduce((s, r) => s + Number(r.base_score), 0) / appScores.length : null,
    }
  } catch {
    return null
  }
}

export async function loadHouseStyle(): Promise<{ md: string; decisions: number; ready: boolean }> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('style_model' as any).select('house_style_md, decisions').eq('id', 1).maybeSingle()
    // ready = the table is reachable via the API (migration run + schema cache
    // refreshed). Distinguishes "no data yet" from "table missing".
    return { md: (data as any)?.house_style_md ?? '', decisions: (data as any)?.decisions ?? 0, ready: !error }
  } catch {
    return { md: '', decisions: 0, ready: false }
  }
}

async function saveStyleModel(model: StyleModel, stylistId?: string | null): Promise<void> {
  const admin = createAdminClient()
  model.updatedAt = new Date().toISOString()
  const house = buildHouseStyle(model)
  const { resolveStylistId, getStylistBySlug } = await import('@/lib/stylist-store')
  const sid = await resolveStylistId(stylistId)
  if (sid) {
    await (admin.from('stylist_model') as any).upsert(
      { stylist_id: sid, model, house_style_md: house, decisions: Math.round(model.decisions), updated_at: model.updatedAt },
      { onConflict: 'stylist_id' },
    )
    // Mirror Chloe's model into the legacy singleton so pre-0022 readers agree.
    const chloe = await getStylistBySlug('chloe')
    if (chloe?.stylist_id !== sid) return
  }
  // Upsert (not update) so the singleton row is created if the migration's seed
  // insert didn't run — otherwise an UPDATE on a missing row silently no-ops and
  // decisions are lost.
  await (admin.from('style_model') as any)
    .upsert({ id: 1, model, house_style_md: house, decisions: Math.round(model.decisions), updated_at: model.updatedAt }, { onConflict: 'id' })
}

// Record one decision: append to the raw log AND fold it into the live model.
// Never throws into the caller — learning must not break approve/skip.
export async function recordStyleDecision(opts: {
  items: FeatureItem[]
  decision: 'approve' | 'skip'
  source: 'composer' | 'review' | 'swap'
  anchorItemId?: string | null
  itemIds?: string[]
  baseScore?: number | null
  weight?: number
  extraFeatures?: Record<string, unknown>
  stylistId?: string | null
}): Promise<void> {
  try {
    const admin = createAdminClient()
    const { resolveStylistId } = await import('@/lib/stylist-store')
    const sid = await resolveStylistId(opts.stylistId)
    const features = { ...extractFeatures(opts.items), ...(opts.extraFeatures ?? {}) }
    // 1. Append to the immutable training log.
    await (admin.from('style_decision') as any).insert({
      decision: opts.decision,
      source: opts.source,
      anchor_item_id: opts.anchorItemId ?? null,
      item_ids: opts.itemIds ?? [],
      features,
      base_score: opts.baseScore ?? null,
      stylist_id: sid,
    })
    // 2. Fold into that stylist's live model.
    const model = await loadStyleModel(sid)
    applyDecision(model, opts.items, opts.decision, opts.weight ?? 1)
    await saveStyleModel(model, sid)
  } catch (err) {
    console.error('[recordStyleDecision]', err)
  }
}

// Record OFFERS: every candidate shown to Chloe counts as one offer of its
// features, so house-style stats can be true approval rates. Batched (one model
// write per call). Fire-and-forget safe — never throws into the caller.
export async function recordStyleOffers(
  offers: { items: FeatureItem[]; anchorItemId?: string | null; itemIds?: string[] }[],
  source: 'composer' | 'review' | 'pipeline',
  stylistId?: string | null,
): Promise<void> {
  if (!offers.length) return
  try {
    const admin = createAdminClient()
    const { resolveStylistId } = await import('@/lib/stylist-store')
    const sid = await resolveStylistId(stylistId)
    await (admin.from('style_offer') as any).insert(
      offers.map((o) => ({
        anchor_item_id: o.anchorItemId ?? null,
        item_ids: o.itemIds ?? [],
        features: extractFeatures(o.items),
        source,
        stylist_id: sid,
      })),
    )
    const model = await loadStyleModel(sid)
    for (const o of offers) applyOffer(model, o.items)
    await saveStyleModel(model, sid)
  } catch (err) {
    console.error('[recordStyleOffers]', err)
  }
}

// Rebuild the model from scratch from the full decision log (use after changing
// the feature logic, or to repair drift). Returns the decision count processed.
export async function recomputeStyleModel(): Promise<number> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('style_decision' as any)
    .select('decision, features')
    .order('created_at', { ascending: true })
    .limit(100000)
  const rows = (data ?? []) as { decision: 'approve' | 'skip'; features: { singles: string[]; pairs: string[] } }[]
  const model = emptyModel()
  for (const r of rows) {
    const slot = r.decision === 'approve' ? 0 : 1
    const bump = (table: Record<string, [number, number]>, key: string) => {
      const cur = table[key] ?? [0, 0]
      cur[slot] += 1
      table[key] = cur
    }
    ;(r.features?.singles ?? []).forEach((k) => bump(model.singles, k))
    ;(r.features?.pairs ?? []).forEach((k) => bump(model.pairs, k))
    model.decisions += 1
    if (r.decision === 'approve') model.approves += 1
    else model.skips += 1
  }
  // Rebuild offer counts from the offer log too (rates need both sides).
  try {
    const { data: offerRows } = await admin
      .from('style_offer' as any)
      .select('features')
      .limit(100000)
    for (const o of (offerRows ?? []) as { features: { singles?: string[]; pairs?: string[] } }[]) {
      for (const k of [...(o.features?.singles ?? []), ...(o.features?.pairs ?? [])]) {
        model.offers[k] = (model.offers[k] ?? 0) + 1
      }
      model.offerCount += 1
    }
  } catch { /* style_offer table not there yet — rates fall back to acted-on counts */ }
  await saveStyleModel(model)
  return rows.length
}
