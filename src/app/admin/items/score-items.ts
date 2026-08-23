'use server'

// BACKFILL — read the style dimensions off the photograph for items that
// arrived without them.
//
// Brand Watch inserts a kept piece straight to status 'ready' with the feed's
// facts only: type, colour, material, price. None of the 1-5 dimensions. The
// composer ranks on those dimensions — shape preferences, the persona lens and
// the house-style checks all read them — so an unscored piece is dressed with
// on brand and colour alone. Measured on 2026-08-23: 24 of 2,389 ready items
// carried them, 1.0%, which is why a member's stated "wide-leg, oversized"
// could not influence a single look.

import { createAdminClient } from '@/lib/supabase-server'
import { analyseProductImage } from '@/app/admin/items/analyse-image'
import { scoreUpdateFor, SCORED_DIMENSIONS, type ScorableItem } from '@/lib/item-scoring'

export interface ScoreRunResult {
  looked: number
  scored: number
  /** Read, but nothing worth writing came back — see `unscorable`. */
  skipped: number
  failed: number
  remaining: number
  /** Page forward from here: the oldest created_at this batch looked at. */
  nextCursor: string | null
  errors: string[]
}

const COLUMNS = `item_id, product_name, image_url, item_type, colour_family, colour_hex, material_category, material_primary, neckline, ${SCORED_DIMENSIONS.join(', ')}`

/**
 * Items still missing their dimensions, newest first, paged by created_at.
 *
 * Paging matters more than it looks. Some pieces have no scores to give — a
 * bag has no rise, hem length or leg opening, and the prompt correctly returns
 * null for all of them — so `structure IS NULL` stays true however many times
 * they are read. Selecting purely on that put the same unscorable items at the
 * front of every batch and the run stalled on them. The cursor always moves.
 */
async function unscoredBatch(admin: any, limit: number, before?: string | null): Promise<ScorableItem[]> {
  let q = admin
    .from('item')
    .select(`${COLUMNS}, created_at`)
    .in('status', ['ready', 'live'])
    .is('structure', null)
    .not('image_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (before) q = q.lt('created_at', before)
  const { data } = await q
  return (data ?? []) as ScorableItem[]
}

/**
 * Write the scores and stamp the attempt.
 *
 * scored_at arrives with migration 0050; until that has been run PostgREST
 * rejects the whole update for the unknown column, so the stamp is dropped and
 * the scores still land. Missing columns come back as "could not find the
 * column … in the schema cache", not "does not exist".
 */
async function writeScores(admin: any, itemId: string, update: Record<string, unknown>): Promise<{ error?: string }> {
  const stamped = { ...update, scored_at: new Date().toISOString() }
  const first = await admin.from('item').update(stamped).eq('item_id', itemId)
  if (!first.error) return {}
  if (!/schema cache|does not exist/i.test(first.error.message)) return { error: first.error.message }
  if (!Object.keys(update).length) return {}
  const retry = await admin.from('item').update(update).eq('item_id', itemId)
  return retry.error ? { error: retry.error.message } : {}
}

export async function countUnscored(): Promise<{ unscored: number; total: number }> {
  const admin = createAdminClient() as any
  const [{ count: unscored }, { count: total }] = await Promise.all([
    admin.from('item').select('item_id', { count: 'exact', head: true })
      .in('status', ['ready', 'live']).is('structure', null).not('image_url', 'is', null),
    admin.from('item').select('item_id', { count: 'exact', head: true }).in('status', ['ready', 'live']),
  ])
  return { unscored: unscored ?? 0, total: total ?? 0 }
}

/**
 * Score one batch. Deliberately batch-at-a-time rather than "the whole
 * library": each call is bounded, safe to re-run, and picks up wherever the
 * last one stopped, so the same function serves the one-off backfill, the
 * nightly cron and a button in admin.
 */
export async function scoreUnscoredItems(
  limit = 40,
  concurrency = 5,
  before?: string | null,
): Promise<ScoreRunResult> {
  const admin = createAdminClient() as any
  const items = await unscoredBatch(admin, limit, before)
  const res: ScoreRunResult = {
    looked: items.length, scored: 0, skipped: 0, failed: 0, remaining: 0,
    nextCursor: items.length ? String((items[items.length - 1] as any).created_at) : null,
    errors: [],
  }

  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency)
    const reads = await Promise.all(chunk.map((it) =>
      analyseProductImage(String(it.image_url)).catch((e) => ({ error: e instanceof Error ? e.message : 'failed' }))))
    for (let j = 0; j < reads.length; j++) {
      const r = reads[j]
      const it = chunk[j]
      if (!('data' in r) || !r.data) {
        res.failed++
        if (res.errors.length < 5) res.errors.push(`${it.product_name}: ${(r as any).error ?? 'no data'}`)
        continue
      }
      const update = scoreUpdateFor(it, r.data as any)
      const wroteSomething = Object.keys(update).length > 0
      const { error } = await writeScores(admin, it.item_id, update)
      if (error) { res.failed++; if (res.errors.length < 5) res.errors.push(`${it.product_name}: ${error}`) }
      // Nothing to write is not a failure — a bag genuinely has no rise or
      // leg opening. Worth counting separately so a run of them is visible
      // rather than reading as silent success.
      else if (wroteSomething) res.scored++
      else res.skipped++
    }
  }

  res.remaining = (await countUnscored()).unscored
  return res
}
