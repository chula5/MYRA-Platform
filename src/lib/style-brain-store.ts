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

export async function loadHouseStyle(): Promise<{ md: string; decisions: number }> {
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('style_model' as any).select('house_style_md, decisions').eq('id', 1).maybeSingle()
    return { md: (data as any)?.house_style_md ?? '', decisions: (data as any)?.decisions ?? 0 }
  } catch {
    return { md: '', decisions: 0 }
  }
}

async function saveStyleModel(model: StyleModel): Promise<void> {
  const admin = createAdminClient()
  model.updatedAt = new Date().toISOString()
  const house = buildHouseStyle(model)
  await (admin.from('style_model') as any)
    .update({ model, house_style_md: house, decisions: Math.round(model.decisions), updated_at: model.updatedAt })
    .eq('id', 1)
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
