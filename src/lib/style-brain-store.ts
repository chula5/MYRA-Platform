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
      .select('decision, base_score, created_at')
      .order('created_at', { ascending: true })
      .limit(100000)
    if (error || !data) return null
    const rows = data as { decision: string; base_score: number | null }[]
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
  source: 'composer' | 'review'
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
