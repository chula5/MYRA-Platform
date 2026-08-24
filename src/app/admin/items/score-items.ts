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

const COLUMNS = `item_id, product_name, image_url, item_type, colour_family, colour_hex, material_category, material_primary, ${SCORED_DIMENSIONS.join(', ')}`

/**
 * Items whose photograph has not been read, newest first, paged by created_at.
 *
 * The selector is `scored_at`, not a missing dimension, because some pieces
 * have no scores to give: a bag has no rise, hem length or leg opening, and
 * the prompt correctly returns null for all of them, so `structure IS NULL`
 * stays true however many times it is read. Selecting on that re-read the same
 * ~490 accessories on every run and stalled the backfill on them. scored_at
 * records the attempt rather than the outcome.
 *
 * The cursor still moves regardless, so a database without 0050 yet degrades
 * to the old behaviour instead of looping.
 */
async function unscoredBatch(
  admin: any,
  limit: number,
  before?: string | null,
  missingField: string = 'structure',
  types?: readonly string[],
): Promise<ScorableItem[]> {
  // neckline and sleeve are selected too when they are the gap being closed;
  // asking for a column this database has not got yet fails the whole query.
  const extra = missingField === 'structure' ? '' : `, ${missingField}`
  const run = async (gapColumn: string) => {
    let q = admin
      .from('item')
      .select(`${COLUMNS}${extra}, created_at`)
      .in('status', ['ready', 'live'])
      .is(gapColumn, null)
    if (types?.length) q = q.in('item_type', types)
    q = q
      .not('image_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (before) q = q.lt('created_at', before)
    return q
  }
  // The main sweep asks "has this been read?"; a targeted pass (sleeve) asks
  // for its own gap, because a piece read before that column existed still
  // needs looking at.
  const primary = missingField === 'structure' ? 'scored_at' : missingField
  let { data, error } = await run(primary)
  if (error && /schema cache|does not exist/i.test(error.message)) {
    ;({ data } = await run(missingField))
  }
  return (data ?? []) as ScorableItem[]
}

/**
 * Write the scores and stamp the attempt.
 *
 * Columns can legitimately be missing on this database: `scored_at` arrives
 * with migration 0050, and `sleeve` with 0047, which has not been run — so a
 * write naming either is rejected outright and takes the whole update with it.
 * Rather than guess the schema, drop whatever column PostgREST names and try
 * again, so the scores that CAN land always land. Missing columns come back as
 * "could not find the 'x' column … in the schema cache".
 */
async function writeScores(admin: any, itemId: string, update: Record<string, unknown>): Promise<{ error?: string }> {
  let payload: Record<string, unknown> = { ...update, scored_at: new Date().toISOString() }
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await admin.from('item').update(payload).eq('item_id', itemId)
    if (!error) return {}
    const missing = error.message.match(/'([a-z_]+)' column/i)?.[1]
      ?? error.message.match(/column "?([a-z_.]+)"? .*does not exist/i)?.[1]?.split('.').pop()
    if (!missing || !(missing in payload)) return { error: error.message }
    const { [missing]: _dropped, ...rest } = payload
    payload = rest
    if (!Object.keys(payload).length) return {}
  }
  return { error: 'could not write scores' }
}

export async function countUnscored(): Promise<{ unscored: number; total: number }> {
  const admin = createAdminClient() as any
  const gap = async (column: string) => admin.from('item')
    .select('item_id', { count: 'exact', head: true })
    .in('status', ['ready', 'live']).is(column, null).not('image_url', 'is', null)
  let counted = await gap('scored_at')
  if (counted.error) counted = await gap('structure')  // pre-0050
  const { count: total } = await admin
    .from('item').select('item_id', { count: 'exact', head: true }).in('status', ['ready', 'live'])
  return { unscored: counted.count ?? 0, total: total ?? 0 }
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
  // Which gap to close. 'structure' is the main sweep; a second pass on
  // 'sleeve' catches tops and dresses once migration 0047 has given that
  // column back — "sleeves too long" is real feedback with nowhere to land
  // until it exists.
  missingField: string = 'structure',
  types?: readonly string[],
): Promise<ScoreRunResult> {
  const admin = createAdminClient() as any
  const items = await unscoredBatch(admin, limit, before, missingField, types)
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
