// Server-side persistence for the Style Brain. Plain (non-action) functions so
// the composer and the admin page can both call them. Uses the admin client.
import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import {
  type StyleModel,
  type FeatureItem,
  emptyModel,
  applyDecision,
  extractFeatures,
  buildHouseStyle,
} from '@/lib/style-brain'

// Load the live learned model (returns an empty model if the table/row is absent
// so the composer keeps working before the migration is run).
export async function loadStyleModel(): Promise<StyleModel> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('style_model' as any).select('model').eq('id', 1).maybeSingle()
    if (error || !data) return emptyModel()
    const m = (data as any).model as Partial<StyleModel> | null
    if (!m || typeof m !== 'object' || !m.version) return emptyModel()
    return { ...emptyModel(), ...m, singles: m.singles ?? {}, pairs: m.pairs ?? {} } as StyleModel
  } catch {
    return emptyModel()
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
  total: number
  approves: number
  skips: number
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
    // Exclude swap-rejects (source='swap') — they train the model but aren't a
    // deliberate approve/skip, so they shouldn't move the approval-rate metric.
    const rows = (data as { decision: string; source: string | null; base_score: number | null }[]).filter((r) => r.source !== 'swap')
    const total = rows.length
    const approves = rows.filter((r) => r.decision === 'approve').length
    const rateOf = (arr: typeof rows) => (arr.length ? arr.filter((r) => r.decision === 'approve').length / arr.length : 0)
    const half = Math.floor(total / 2)
    const appScores = rows.filter((r) => r.decision === 'approve' && typeof r.base_score === 'number') as { base_score: number }[]
    return {
      total,
      approves,
      skips: total - approves,
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

async function saveStyleModel(model: StyleModel): Promise<void> {
  const admin = createAdminClient()
  model.updatedAt = new Date().toISOString()
  const house = buildHouseStyle(model)
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
}): Promise<void> {
  try {
    const admin = createAdminClient()
    const features = extractFeatures(opts.items)
    // 1. Append to the immutable training log.
    await (admin.from('style_decision') as any).insert({
      decision: opts.decision,
      source: opts.source,
      anchor_item_id: opts.anchorItemId ?? null,
      item_ids: opts.itemIds ?? [],
      features,
      base_score: opts.baseScore ?? null,
    })
    // 2. Fold into the live model.
    const model = await loadStyleModel()
    applyDecision(model, opts.items, opts.decision, opts.weight ?? 1)
    await saveStyleModel(model)
  } catch (err) {
    console.error('[recordStyleDecision]', err)
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
  await saveStyleModel(model)
  return rows.length
}
