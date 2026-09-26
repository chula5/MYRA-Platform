'use server'

// THE BENCH'S ACTIONS — every export here is browser-callable, so each one
// gates first and hands the work to plain modules: the run itself lives in
// ./bench-run (so the trials can run it too), the measuring in
// lib/stylist-bench, the learning in lib/style-brain-store.

import { createAdminClient } from '@/lib/supabase-server'
import { assertAdmin } from '@/lib/admin-audit'
import { benchRun, type BenchItem, type BenchResult } from './bench-run'
import { recordStyleDecision, loadStyleModel } from '@/lib/style-brain-store'
import type { FeatureItem } from '@/lib/style-brain'
import { parseBrief, briefText } from '@/lib/stylist-brief'
import { neverFromPiece, appendNever, type NeverAttr } from '@/lib/stylist-bench'
import { updateStylistBrief } from './actions'
import { checkLook, describeClientForCheck, confidenceFromCheck, type LookCheck } from '@/lib/look-check'

/**
 * How much one bench verdict counts toward the Style Brain's ramp (full
 * strength at 40). One, like every other decision: Chloe's eye on the bench
 * is deliberate, but inflating it would make the ramp lie about how much a
 * stylist has actually been taught. The dial is here if she wants it.
 */
const BENCH_DECISION_WEIGHT = 1

export async function searchBenchItems(query: string): Promise<{ items: BenchItem[]; error?: string }> {
  await assertAdmin()
  try {
    const admin = createAdminClient() as any
    let req = admin
      .from('item')
      .select('item_id, product_name, image_url, item_type, brand:brand_id(name)')
      .in('status', ['ready', 'live'])
      .not('image_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(40)
    const q = query.trim()
    if (q) req = req.ilike('product_name', `%${q}%`)
    const { data, error } = await req
    if (error) return { items: [], error: error.message }
    return {
      items: (data ?? []).map((r: any) => ({
        item_id: r.item_id, product_name: r.product_name, image_url: r.image_url ?? null,
        item_type: r.item_type, brand_name: r.brand?.name ?? null,
      })),
    }
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : 'Search failed' }
  }
}

/** Whose size and library the bench styles in — or none: the stylist alone. */
export async function listBenchMembers(): Promise<{ members: { member_id: string; name: string }[]; error?: string }> {
  await assertAdmin()
  try {
    const admin = createAdminClient() as any
    const { data, error } = await admin.from('pilot_member').select('member_id, name').order('created_at', { ascending: true })
    if (error) return { members: [], error: error.message }
    return { members: (data ?? []).map((m: any) => ({ member_id: m.member_id, name: m.name ?? 'Unnamed' })) }
  } catch (err) {
    return { members: [], error: err instanceof Error ? err.message : 'Load failed' }
  }
}

export async function styleAcrossStylists(
  itemId: string,
  occasionId: string | null,
  /** null = no client: the stylist alone, over the whole library. */
  memberId: string | null,
): Promise<BenchResult> {
  await assertAdmin()
  try {
    return await benchRun(createAdminClient() as any, itemId, occasionId, memberId)
  } catch (err) {
    return { columns: [], error: err instanceof Error ? err.message : 'Bench failed' }
  }
}

/**
 * A verdict on one column teaches that stylist, and only that stylist. A YES
 * approves the look. A NO with the wrong pieces named teaches the pairs that
 * carry the blame — the hero with each named piece — not the whole look; and
 * each never asked for is written into the brief at once, where it works
 * without waiting for the model's ramp.
 */
export async function recordBenchVerdict(input: {
  stylistId: string
  heroId: string
  itemIds: string[]
  score: number
  verdict: 'yes' | 'no'
  wrongItemIds?: string[]
  nevers?: { itemId: string; attr: NeverAttr; word?: string | null }[]
  trialRunId?: string | null
}): Promise<{ error?: string; decisions?: number; nevers_added?: number }> {
  await assertAdmin()
  try {
    const admin = createAdminClient() as any
    const ids = Array.from(new Set([input.heroId, ...input.itemIds]))
    const { data: rows, error } = await admin
      .from('item')
      .select('item_id, product_name, item_type, colour_family, pattern, material_formality, material_primary, brand:brand_id(name, price_tier)')
      .in('item_id', ids)
    if (error) return { error: error.message }
    const byId = new Map<string, any>((rows ?? []).map((r: any) => [r.item_id, r]))
    const feat = (r: any): FeatureItem => ({
      item_type: r.item_type, colour_family: r.colour_family ?? null, pattern: r.pattern ?? null,
      material_formality: r.material_formality ?? null, brand_name: r.brand?.name ?? null, price_tier: r.brand?.price_tier ?? null,
    })
    const wrong = (input.wrongItemIds ?? []).filter((id) => byId.has(id) && id !== input.heroId)
    const taught = input.verdict === 'no' && wrong.length ? [input.heroId, ...wrong] : ids
    await recordStyleDecision({
      items: taught.map((id) => byId.get(id)).filter(Boolean).map(feat),
      decision: input.verdict === 'yes' ? 'approve' : 'skip',
      source: 'bench',
      anchorItemId: input.heroId,
      itemIds: input.itemIds,
      baseScore: input.score,
      weight: BENCH_DECISION_WEIGHT,
      extraFeatures: {
        bench: true,
        ...(input.trialRunId ? { trial_run_id: input.trialRunId } : {}),
        ...(wrong.length ? { wrong_item_ids: wrong } : {}),
      },
      stylistId: input.stylistId,
    })

    let nevers_added = 0
    if (input.verdict === 'no' && input.nevers?.length) {
      const { data: st } = await admin.from('stylist').select('name, brief').eq('stylist_id', input.stylistId).single()
      let brief = parseBrief(st?.brief, st?.name ?? '')
      for (const n of input.nevers) {
        const r = byId.get(n.itemId)
        if (!r) continue
        const never = neverFromPiece(
          { product_name: r.product_name, item_type: r.item_type, colour_family: r.colour_family, brand_name: r.brand?.name, material_primary: r.material_primary },
          n.attr, new Date(), typeof n.word === 'string' ? n.word.slice(0, 40) : null,
        )
        if (!never) continue
        const next = appendNever(brief, never)
        if (next !== brief) { brief = next; nevers_added++ }
      }
      if (nevers_added) {
        const r = await updateStylistBrief(input.stylistId, brief)
        if (r.error) return { error: r.error }
      }
    }
    const model = await loadStyleModel(input.stylistId)
    return { decisions: Math.round(model.decisions), nevers_added }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Verdict failed' }
  }
}

/**
 * MYRA's eye on one column: the same photo check the Dressing Room runs,
 * with the stylist's brief as the client. One Opus call, ~2p, 5–10 seconds,
 * no cache — which is why the bench asks rather than assumes.
 */
export async function checkBenchLook(
  stylistId: string,
  pieces: { image_url: string | null; item_type: string | null; product_name: string }[],
): Promise<{ check: LookCheck | null; confidence: number | null; error?: string }> {
  await assertAdmin()
  try {
    const admin = createAdminClient() as any
    const { data: st } = await admin.from('stylist').select('name, brief').eq('stylist_id', stylistId).single()
    const name = st?.name ?? 'the stylist'
    const brief = parseBrief(st?.brief, name)
    const check = await checkLook(pieces, describeClientForCheck({}, name, briefText(name, brief)))
    if (!check) return { check: null, confidence: null, error: 'MYRA could not look at this one' }
    return { check, confidence: confidenceFromCheck(check.verdict, check.colourHarmony, check.piecesGoTogether) }
  } catch (err) {
    return { check: null, confidence: null, error: err instanceof Error ? err.message : 'Check failed' }
  }
}
