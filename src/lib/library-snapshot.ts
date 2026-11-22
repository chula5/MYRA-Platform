// THE COMPOSABLE LIBRARY, KEPT WARM — one read of the shop, shared by every
// function that styles.
//
// Styling a piece starts with the whole retail library in memory: ~27,000
// ready and live rows, 86MB of JSON as PostgREST serves them, plus the size
// rows the member gate reads. From the nano database that is 20–50 seconds,
// and on Vercel EVERY drain is a fresh function, so a member's first look
// landed at a median of 44 seconds and three jobs claimed together loaded it
// three times at once (measured 2026-11-03). The database is the bottleneck,
// not the composing (0.4s) or the judge (5–10s).
//
// So the library is read from the database once and kept as a gzipped,
// column-oriented snapshot in Supabase Storage (a plain object store, not the
// database). A function that needs the library downloads the snapshot (one
// GET, a couple of seconds) instead of 27 paged queries. Freshness:
//
//   • in memory and under FRESH_MS         → served as is
//   • snapshot under FRESH_MS              → served as is
//   • snapshot under STALE_OK_MS           → served now, refreshed behind
//   • older, or none                       → read from the database, written
//
// TWICE A DAY (Chloe, 2026-11-22): the snapshot is rebuilt at 06:00 and 18:00
// UTC, and early when new pieces have gone live since it was taken (Brand
// Watch auto-adds, accepted drafts) — never more than once an hour for that.
// It used to be every 10 minutes while anyone styled: ~33,000 pieces and
// ~87,000 size rows re-read from the database each time, one of its heaviest
// loads, for stock that barely moves. Members lose nothing: the composer
// re-reads the stock of the pieces it actually picked before judging
// (styled-ways-compose), and a kept way is dropped on read the moment a piece
// in it dies (lib/styled-ways). The styled-ways cron (every 5 minutes) asks
// refreshLibrarySnapshotIfDue, so a boundary is met within five minutes.

import 'server-only'
import { gzipSync, gunzipSync } from 'node:zlib'
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase-server'
import { getAllItems, type ItemWithBrand } from '@/lib/admin-queries'
import type { SizeRow } from '@/lib/size-match'
import { NEW_ARRIVALS_MIN_GAP_MS, snapshotDueReason } from '@/lib/library-snapshot-timing'
export { REFRESH_HOURS_UTC, NEW_ARRIVALS_MIN_GAP_MS, lastRefreshBoundary, snapshotDueReason } from '@/lib/library-snapshot-timing'

export const LIBRARY_BUCKET = 'library-cache'
const SNAPSHOT_PATH = 'retail-library.json.gz'
/** Served as is: the cron rebuilds it at the twice-daily boundaries. */
export const FRESH_MS = 13 * 60 * 60 * 1000
/** Served while a fresh read runs behind it (only if the cron has missed). */
export const STALE_OK_MS = 26 * 60 * 60 * 1000

export interface RetailLibrary {
  at: number
  items: ItemWithBrand[]
  /** Size rows by item id, for the member gate — read once with the items. */
  sizeRows: Map<string, SizeRow[]>
  from: 'memory' | 'snapshot' | 'db'
}

interface State {
  cache: RetailLibrary | null
  inFlight: Promise<RetailLibrary> | null
  refreshing: Promise<RetailLibrary | null> | null
  bucketReady: boolean
}
// On globalThis so a dev-server recompile keeps the library in memory.
const state = ((globalThis as any).__myraLibrarySnapshot ??= { cache: null, inFlight: null, refreshing: null, bucketReady: false }) as State

/** Test seam: forget what is in memory. */
export function resetLibrarySnapshotMemory(): void {
  state.cache = null
  state.inFlight = null
  state.refreshing = null
}

// ── Encoding ────────────────────────────────────────────────────────────────
// Column-oriented: the column names once, then one array per row. Object
// form repeats eighty keys on every row and is 86MB; this parses in a
// fraction of the time and gzips to a few megabytes.

interface Encoded {
  at: number
  itemCols: string[]
  items: unknown[][]
  brandCols: string[]
  brands: unknown[][]
  sizeCols: string[]
  /** [item_id, ...row] per size row. */
  sizes: unknown[][]
}

function columns(rows: Record<string, unknown>[]): string[] {
  const cols = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) cols.add(k)
  return Array.from(cols)
}
const toRows = (rows: Record<string, unknown>[], cols: string[]) => rows.map((r) => cols.map((c) => r[c] ?? null))
const fromRows = <T,>(rows: unknown[][], cols: string[]): T[] =>
  rows.map((vals) => { const o: Record<string, unknown> = {}; cols.forEach((c, i) => { o[c] = vals[i] }); return o as T })

export function encodeLibrary(lib: { at: number; items: ItemWithBrand[]; sizeRows: Map<string, SizeRow[]> }): Buffer {
  const brandsById = new Map<string, Record<string, unknown>>()
  const bare = lib.items.map((it) => {
    const { brand, ...rest } = it as any
    if (brand?.brand_id) brandsById.set(brand.brand_id, brand)
    return rest as Record<string, unknown>
  })
  const itemCols = columns(bare)
  const brands = Array.from(brandsById.values())
  const brandCols = columns(brands)
  const sizeList: Record<string, unknown>[] = []
  lib.sizeRows.forEach((rows, itemId) => { for (const r of rows) sizeList.push({ item_id: itemId, ...(r as any) }) })
  const sizeCols = columns(sizeList)
  const enc: Encoded = {
    at: lib.at, itemCols, items: toRows(bare, itemCols), brandCols, brands: toRows(brands, brandCols), sizeCols, sizes: toRows(sizeList, sizeCols),
  }
  return gzipSync(Buffer.from(JSON.stringify(enc)), { level: 6 })
}

export function decodeLibrary(buf: Buffer): { at: number; items: ItemWithBrand[]; sizeRows: Map<string, SizeRow[]> } {
  const enc = JSON.parse(gunzipSync(buf).toString('utf8')) as Encoded
  const brands = new Map(fromRows<any>(enc.brands, enc.brandCols).map((b) => [b.brand_id, b]))
  const items = fromRows<any>(enc.items, enc.itemCols).map((it) => ({ ...it, brand: (it.brand_id && brands.get(it.brand_id)) || null })) as ItemWithBrand[]
  const sizeRows = new Map<string, SizeRow[]>()
  for (const r of fromRows<any>(enc.sizes, enc.sizeCols)) {
    const { item_id, ...row } = r
    const list = sizeRows.get(item_id)
    if (list) list.push(row as SizeRow); else sizeRows.set(item_id, [row as SizeRow])
  }
  return { at: enc.at, items, sizeRows }
}

// ── Storage ─────────────────────────────────────────────────────────────────

async function ensureBucket(admin: any): Promise<void> {
  if (state.bucketReady) return
  const { error } = await admin.storage.createBucket(LIBRARY_BUCKET, { public: false })
  if (error && !/already exists|duplicate/i.test(error.message ?? '')) throw new Error(`library-cache bucket: ${error.message}`)
  state.bucketReady = true
}

async function readSnapshot(admin: any): Promise<{ at: number; items: ItemWithBrand[]; sizeRows: Map<string, SizeRow[]> } | null> {
  const t0 = Date.now()
  const { data, error } = await admin.storage.from(LIBRARY_BUCKET).download(SNAPSHOT_PATH)
  if (error || !data) return null
  const buf = Buffer.from(await data.arrayBuffer())
  const lib = decodeLibrary(buf)
  console.log(`[library] snapshot read ${(buf.length / 1e6).toFixed(1)}MB, ${lib.items.length} pieces, ${Math.round((Date.now() - lib.at) / 1000)}s old, in ${Date.now() - t0}ms`)
  return lib
}

async function writeSnapshot(admin: any, lib: { at: number; items: ItemWithBrand[]; sizeRows: Map<string, SizeRow[]> }): Promise<void> {
  const t0 = Date.now()
  await ensureBucket(admin)
  const buf = encodeLibrary(lib)
  const { error } = await admin.storage.from(LIBRARY_BUCKET).upload(SNAPSHOT_PATH, buf, { contentType: 'application/gzip', upsert: true })
  if (error) throw new Error(`library-cache write: ${error.message}`)
  console.log(`[library] snapshot written ${(buf.length / 1e6).toFixed(1)}MB in ${Date.now() - t0}ms`)
}

// ── The database read ───────────────────────────────────────────────────────

async function readFromDatabase(): Promise<{ at: number; items: ItemWithBrand[]; sizeRows: Map<string, SizeRow[]> }> {
  const t0 = Date.now()
  const at = Date.now()
  // Either read failing throws: a timed-out 'ready' read used to come back as
  // [] and the 13 live pieces alone were written as the whole shop (2026-11-16).
  const [ready, live] = await Promise.all([getAllItems('ready', undefined, { throwOnError: true }), getAllItems('live', undefined, { throwOnError: true })])
  const items = [...ready, ...live]
  const { loadSizeRowsFor } = await import('@/lib/size-availability')
  const sizeRows = await loadSizeRowsFor(items.map((i) => i.item_id))
  console.log(`[library] database read ${items.length} pieces, ${sizeRows.size} with sizes, in ${Date.now() - t0}ms`)
  return { at, items, sizeRows }
}

/** Read the shop afresh and write the snapshot; shared when already running. */
function refresh(admin: any): Promise<RetailLibrary | null> {
  if (state.refreshing) return state.refreshing
  state.refreshing = (async () => {
    try {
      const lib = await readFromDatabase()
      if (!lib.items.length) return null // a failed read is never written over a good snapshot
      // Nor a read that lost most of the shop: the library never halves in an hour.
      const before = state.cache?.items.length ?? (await readSnapshot(admin).catch(() => null))?.items.length ?? 0
      if (before && lib.items.length < before * 0.5) {
        console.error(`[library] refresh read ${lib.items.length} pieces against ${before} before — not written`)
        return null
      }
      const value: RetailLibrary = { ...lib, from: 'db' }
      state.cache = value
      try { await writeSnapshot(admin, lib) } catch (err) { console.error('[library] snapshot write', err) }
      return value
    } catch (err) {
      console.error('[library] refresh', err)
      return null
    } finally {
      state.refreshing = null
    }
  })()
  return state.refreshing
}

/**
 * The retail library (ready + live, retail only) with its size rows — from
 * memory, from the snapshot, or from the database, in that order of cost.
 * Concurrent callers in one function share one read.
 */
export async function loadRetailLibrary(opts: { admin?: any } = {}): Promise<RetailLibrary> {
  const cache = state.cache
  if (cache && Date.now() - cache.at < FRESH_MS) return { ...cache, from: 'memory' }
  if (state.inFlight) return state.inFlight
  state.inFlight = (async () => {
    const admin = opts.admin ?? (createAdminClient() as any)
    try {
      // What is in memory but ageing is as good as a snapshot of the same age.
      let lib: { at: number; items: ItemWithBrand[]; sizeRows: Map<string, SizeRow[]> } | null = cache
      let from: RetailLibrary['from'] = 'memory'
      if (!lib || Date.now() - lib.at >= STALE_OK_MS) {
        const snap = await readSnapshot(admin).catch((err) => { console.error('[library] snapshot read', err); return null })
        if (snap && (!lib || snap.at > lib.at)) { lib = snap; from = 'snapshot' }
      }
      const age = lib ? Date.now() - lib.at : Infinity
      if (lib && age < FRESH_MS) {
        state.cache = { ...lib, from }
        return state.cache
      }
      if (lib && age < STALE_OK_MS) {
        state.cache = { ...lib, from }
        const behind = refresh(admin)
        try { waitUntil(behind) } catch { /* local: it simply runs */ }
        return state.cache
      }
      const fresh = await refresh(admin)
      if (fresh) return fresh
      if (lib) return { ...lib, from } // the database refused: an old library beats none
      throw new Error('MYRA could not read the library just now')
    } finally {
      state.inFlight = null
    }
  })()
  return state.inFlight
}

/**
 * For the cron (every 5 minutes): rebuild the snapshot when it predates the
 * last 06:00 / 18:00 UTC boundary, or — at most hourly — when pieces have
 * gone live since it was taken. Otherwise one cheap check and nothing more.
 * `demand` is kept for callers but no longer shortens the interval.
 */
export async function refreshLibrarySnapshotIfDue(opts: { demand?: boolean; admin?: any; /** Rebuild now whatever its age (repairs). */ force?: boolean } = {}): Promise<{ refreshed: boolean; ageMs: number | null; reason?: string }> {
  const admin = opts.admin ?? (createAdminClient() as any)
  const now = Date.now()
  let takenAt: number | null = null
  try {
    const { data } = await admin.storage.from(LIBRARY_BUCKET).list('', { search: SNAPSHOT_PATH, limit: 1 })
    const obj = (data ?? []).find((o: any) => o.name === SNAPSHOT_PATH)
    if (obj?.updated_at) takenAt = Date.parse(obj.updated_at)
  } catch { /* no bucket yet: due */ }
  const ageMs = takenAt == null ? null : now - takenAt
  let reason = snapshotDueReason({ force: !!opts.force, takenAt, now })
  if (!reason && takenAt != null && now - takenAt >= NEW_ARRIVALS_MIN_GAP_MS && (await newPiecesSince(admin, takenAt))) reason = 'new arrivals'
  if (!reason) return { refreshed: false, ageMs }
  const r = await refresh(admin)
  return { refreshed: !!r, ageMs, reason }
}


/** Has a shoppable piece been created since the snapshot? One indexed row read. */
async function newPiecesSince(admin: any, since: number): Promise<boolean> {
  try {
    const { data } = await admin.from('item').select('item_id')
      .in('status', ['ready', 'live']).eq('ownership', 'retail')
      .gt('created_at', new Date(since).toISOString()).limit(1)
    return (data ?? []).length > 0
  } catch { return false }
}
