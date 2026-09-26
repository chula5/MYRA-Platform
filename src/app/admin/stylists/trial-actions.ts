'use server'

// THE TRIALS' ACTIONS — every export is browser-callable, so each gates first.
// The run is ./bench-run's; the comparison is lib/stylist-trials'; the
// learning goes through recordBenchVerdict so a trial verdict teaches exactly
// as a bench verdict does.

import { createHash, randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase-server'
import { assertAdmin } from '@/lib/admin-audit'
import { benchRun, type BenchPiece } from './bench-run'
import { recordBenchVerdict, checkBenchLook } from './bench-actions'
import { parseBrief } from '@/lib/stylist-brief'
import { OCCASION_LABEL } from '@/lib/client-occasions'
import {
  buildReports, latestForStylist, compareToVerdicts,
  type TrialRunLite, type StylistBatchReport, type DeltaMetric,
} from '@/lib/stylist-trials'
import type { NeverAttr, BenchScorecard } from '@/lib/stylist-bench'
import type { LookCheck } from '@/lib/look-check'

export interface Trial {
  trial_id: string
  item_id: string
  occasion_id: string | null
  occasion_label: string | null
  label: string | null
  active: boolean
  created_at: string
  product_name: string
  image_url: string | null
  brand_name: string | null
  runs: number
}

const briefHash = (brief: unknown, name: string) =>
  createHash('sha1').update(JSON.stringify(parseBrief(brief, name))).digest('hex').slice(0, 12)

const trialSelect = 'trial_id, item_id, occasion_id, label, active, created_at, item:item_id(product_name, image_url, brand:brand_id(name))'
const toTrial = (t: any, runs: number): Trial => ({
  trial_id: t.trial_id, item_id: t.item_id, occasion_id: t.occasion_id ?? null,
  occasion_label: t.occasion_id ? (OCCASION_LABEL[t.occasion_id] ?? t.occasion_id) : null,
  label: t.label ?? null, active: !!t.active, created_at: t.created_at,
  product_name: t.item?.product_name ?? '—', image_url: t.item?.image_url ?? null, brand_name: t.item?.brand?.name ?? null,
  runs,
})

/** A trial is born from a bench run: the piece she just styled, with its occasion. */
export async function saveAsTrial(itemId: string, occasionId: string | null, label?: string | null): Promise<{ trial_id?: string; existed?: boolean; error?: string }> {
  await assertAdmin()
  try {
    const admin = createAdminClient() as any
    let q = admin.from('stylist_trial').select('trial_id').eq('item_id', itemId)
    q = occasionId ? q.eq('occasion_id', occasionId) : q.is('occasion_id', null)
    const { data: existing } = await q.maybeSingle()
    if (existing) return { trial_id: existing.trial_id, existed: true }
    const { data, error } = await admin.from('stylist_trial')
      .insert({ item_id: itemId, occasion_id: occasionId, label: label ?? null })
      .select('trial_id').single()
    if (error) return { error: error.message }
    return { trial_id: data.trial_id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Save failed' }
  }
}

export async function listTrials(): Promise<{ trials: Trial[]; error?: string }> {
  await assertAdmin()
  try {
    const admin = createAdminClient() as any
    const [{ data, error }, { data: runRows }] = await Promise.all([
      admin.from('stylist_trial').select(trialSelect).order('created_at', { ascending: false }),
      admin.from('stylist_trial_run').select('trial_id').limit(20000),
    ])
    if (error) return { trials: [], error: error.message }
    const counts = new Map<string, number>()
    for (const r of runRows ?? []) counts.set(r.trial_id, (counts.get(r.trial_id) ?? 0) + 1)
    return { trials: (data ?? []).map((t: any) => toTrial(t, counts.get(t.trial_id) ?? 0)) }
  } catch (err) {
    return { trials: [], error: err instanceof Error ? err.message : 'Load failed' }
  }
}

export async function setTrialActive(trialId: string, active: boolean): Promise<{ error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { error } = await admin.from('stylist_trial').update({ active }).eq('trial_id', trialId)
  return error ? { error: error.message } : {}
}

/**
 * One batch: every active trial, every stylist, each column kept with its
 * scorecard and what the stylist knew at the time (decisions, confirmed
 * pictures, the brief's hash) — so a later batch can say what moved.
 */
export async function runAllTrials(opts: { withEye?: boolean } = {}): Promise<{ batch_id?: string; trials?: number; columns?: number; errors?: number; error?: string }> {
  await assertAdmin()
  try {
    const admin = createAdminClient() as any
    const [{ data: trials, error }, { data: stylists }] = await Promise.all([
      admin.from('stylist_trial').select('trial_id, item_id, occasion_id').eq('active', true).order('created_at', { ascending: true }),
      admin.from('stylist').select('stylist_id, name, brief, role').neq('role', 'chief'),
    ])
    if (error) return { error: error.message }
    if (!trials?.length) return { error: 'No active trials — save one from the bench first' }
    const hashes = new Map<string, string>((stylists ?? []).map((s: any) => [s.stylist_id, briefHash(s.brief, s.name ?? '')]))
    const imageCounts = new Map<string, number>()
    await Promise.all((stylists ?? []).map(async (s: any) => {
      const { count } = await admin.from('inspiration_image').select('image_id', { count: 'exact', head: true })
        .eq('persona_id', s.stylist_id).eq('status', 'confirmed').is('user_id', null)
      imageCounts.set(s.stylist_id, count ?? 0)
    }))

    const batch_id = randomUUID()
    let columns = 0, errors = 0
    for (const t of trials) {
      const res = await benchRun(admin, t.item_id, t.occasion_id ?? null, null)
      if (res.error || !res.hero) {
        errors++
        await admin.from('stylist_trial_run').insert((stylists ?? []).map((s: any) => ({
          trial_id: t.trial_id, stylist_id: s.stylist_id, batch_id, error: res.error ?? 'No hero',
          model_decisions: 0, envelope_images: imageCounts.get(s.stylist_id) ?? 0, brief_hash: hashes.get(s.stylist_id) ?? null,
        })))
        continue
      }
      const rows = await Promise.all(res.columns.map(async (c) => {
        let check_result: LookCheck | null = null
        if (opts.withEye && c.pieces.length) {
          const r = await checkBenchLook(c.stylist_id, c.pieces.map((p) => ({ image_url: p.image_url, item_type: p.item_type, product_name: p.product_name })))
          check_result = r.check
        }
        if (c.error) errors++; else columns++
        return {
          trial_id: t.trial_id, stylist_id: c.stylist_id, batch_id,
          items: c.pieces, item_ids: c.item_ids, scores: c.scorecard ?? {},
          check_result, model_decisions: c.decisions,
          envelope_images: imageCounts.get(c.stylist_id) ?? 0, brief_hash: hashes.get(c.stylist_id) ?? null,
          error: c.error ?? null,
        }
      }))
      const { error: insErr } = await admin.from('stylist_trial_run').insert(rows)
      if (insErr) return { error: insErr.message }
    }
    return { batch_id, trials: trials.length, columns, errors }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Run failed' }
  }
}

const runSelect = 'run_id, trial_id, stylist_id, batch_id, run_at, items, item_ids, scores, verdict, model_decisions, envelope_images, brief_hash, error, check_result, trial:trial_id(item_id, occasion_id, label)'
const toLite = (r: any): TrialRunLite => ({
  run_id: r.run_id, trial_id: r.trial_id, stylist_id: r.stylist_id, batch_id: r.batch_id, run_at: r.run_at,
  hero_id: r.trial?.item_id ?? '',
  items: ((r.items ?? []) as BenchPiece[]).map((p) => ({ item_id: p.item_id, brand: p.brand })),
  scores: r.scores ?? null, verdict: r.verdict ?? null,
  model_decisions: Number(r.model_decisions ?? 0), envelope_images: Number(r.envelope_images ?? 0),
  brief_hash: r.brief_hash ?? null, error: r.error ?? null,
})

export interface StylistTrialRow {
  stylist_id: string
  stylist_name: string
  status: string
  latest: StylistBatchReport | null
  previous: StylistBatchReport | null
  delta: Record<DeltaMetric, number | null> | null
  brief_changed: boolean
  images_before: number | null
}

export interface TrialReport {
  stylists: StylistTrialRow[]
  batches: number
  last_run_at: string | null
  trials: Trial[]
  error?: string
}

export async function loadTrialReport(): Promise<TrialReport> {
  await assertAdmin()
  try {
    const admin = createAdminClient() as any
    const [{ data: runs, error }, { data: stylists }, trials] = await Promise.all([
      admin.from('stylist_trial_run').select(runSelect).order('run_at', { ascending: true }).limit(20000),
      admin.from('stylist').select('stylist_id, name, status, role').neq('role', 'chief').order('created_at', { ascending: true }),
      listTrials(),
    ])
    if (error) return { stylists: [], batches: 0, last_run_at: null, trials: [], error: error.message }
    const lite: TrialRunLite[] = (runs ?? []).map(toLite)
    const reports = buildReports(lite)
    return {
      stylists: (stylists ?? []).map((s: any) => ({ stylist_id: s.stylist_id, stylist_name: s.name, status: s.status, ...latestForStylist(reports, s.stylist_id) })),
      batches: new Set(lite.map((r) => r.batch_id)).size,
      last_run_at: lite.length ? lite[lite.length - 1].run_at : null,
      trials: trials.trials,
    }
  } catch (err) {
    return { stylists: [], batches: 0, last_run_at: null, trials: [], error: err instanceof Error ? err.message : 'Load failed' }
  }
}

export interface TrialCell {
  run_id: string
  trial_id: string
  label: string
  hero_image: string | null
  occasion_label: string | null
  pieces: BenchPiece[]
  scores: Partial<BenchScorecard> | null
  verdict: 'yes' | 'no' | null
  like_yes: boolean
  like_no: boolean
  check_result: LookCheck | null
  error: string | null
}

/** One stylist's latest batch, one cell per trial, each marked against what Chloe judged before. */
export async function loadStylistTrialGrid(stylistId: string): Promise<{ cells: TrialCell[]; batch_id: string | null; error?: string }> {
  await assertAdmin()
  try {
    const admin = createAdminClient() as any
    const [{ data: runs, error }, { data: trials }] = await Promise.all([
      admin.from('stylist_trial_run').select(runSelect).eq('stylist_id', stylistId).order('run_at', { ascending: true }).limit(5000),
      admin.from('stylist_trial').select(trialSelect),
    ])
    if (error) return { cells: [], batch_id: null, error: error.message }
    const all = (runs ?? []) as any[]
    if (!all.length) return { cells: [], batch_id: null }
    const lite = all.map(toLite)
    const latestBatch = lite[lite.length - 1].batch_id
    const byTrial = new Map<string, any>((trials ?? []).map((t: any) => [t.trial_id, t]))
    const cells: TrialCell[] = all.filter((r) => r.batch_id === latestBatch).map((r) => {
      const l = toLite(r)
      const c = compareToVerdicts(l, lite)
      const t = byTrial.get(r.trial_id)
      return {
        run_id: r.run_id, trial_id: r.trial_id,
        label: t?.label || t?.item?.product_name || '—',
        hero_image: t?.item?.image_url ?? null,
        occasion_label: t?.occasion_id ? (OCCASION_LABEL[t.occasion_id] ?? t.occasion_id) : null,
        pieces: (r.items ?? []) as BenchPiece[], scores: r.scores ?? null, verdict: r.verdict ?? null,
        like_yes: c.like_yes, like_no: c.like_no, check_result: r.check_result ?? null, error: r.error ?? null,
      }
    })
    return { cells, batch_id: latestBatch }
  } catch (err) {
    return { cells: [], batch_id: null, error: err instanceof Error ? err.message : 'Load failed' }
  }
}

/** A verdict on a trial run: kept on the run, and taught exactly as a bench verdict is. */
export async function recordTrialVerdict(
  runId: string,
  save: { verdict: 'yes' | 'no'; wrongItemIds: string[]; nevers: { itemId: string; attr: NeverAttr; word?: string | null }[] },
): Promise<{ error?: string; decisions?: number; nevers_added?: number }> {
  await assertAdmin()
  try {
    const admin = createAdminClient() as any
    const { data: run, error } = await admin.from('stylist_trial_run')
      .select('run_id, stylist_id, item_ids, scores, trial:trial_id(item_id)').eq('run_id', runId).single()
    if (error || !run) return { error: error?.message ?? 'Run not found' }
    const { error: upErr } = await admin.from('stylist_trial_run')
      .update({ verdict: save.verdict, wrong_item_ids: save.wrongItemIds }).eq('run_id', runId)
    if (upErr) return { error: upErr.message }
    return recordBenchVerdict({
      stylistId: run.stylist_id, heroId: run.trial?.item_id, itemIds: run.item_ids ?? [],
      score: Number(run.scores?.score ?? 0), verdict: save.verdict,
      wrongItemIds: save.wrongItemIds, nevers: save.nevers, trialRunId: runId,
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Verdict failed' }
  }
}
