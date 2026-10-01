// Server-only wiring for the stylist snapshot service.
//
// Loads one explicitly selected stylist's full lens from the live source tables
// (stylist, stylist_item_mask, stylist_model, inspiration_image) and persists
// the frozen snapshot insert-only into outfit_quality_stylist_snapshot. There is
// no default resolution and no Chloe fallback here: the loader queries only the
// exact stylist id it is given, and returns null when that id is unknown.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { parseBrief } from '@/lib/stylist-brief'
import {
  createStylistSnapshot,
  StylistSnapshotError,
  type StylistSnapshotLoader,
  type StylistSnapshotStore,
  type LoadedStylist,
  type ItemMaskDecision,
  type LoadedLearnedModel,
  type LoadedInspirationImage,
  type StylistSnapshotInsert,
  type StoredSnapshot,
  type SnapshotPayload,
  type SystemVersions,
  type StylistSnapshotResult,
} from '@/lib/outfit-quality/stylist-snapshot'

type Admin = ReturnType<typeof createAdminClient>

/**
 * Source reads are paged, never silently truncated. A short page ends the
 * scan; any page error aborts the whole load (and therefore the batch Start).
 */
const SOURCE_READ_PAGE = 1000

async function readAllPages<T>(
  stylistId: string,
  table: string,
  page: (from: number, to: number) => Promise<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += SOURCE_READ_PAGE) {
    const { data, error } = await page(from, from + SOURCE_READ_PAGE - 1)
    if (error) {
      throw new StylistSnapshotError(
        'source_read_failed',
        `${table} read failed for stylist ${stylistId}: ${error.message ?? 'unknown error'}`,
        stylistId,
      )
    }
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < SOURCE_READ_PAGE) return out
  }
}

/**
 * The real selected-stylist loader. Every query is scoped to the exact stylist
 * id. `loadStylist` resolves by `stylist_id` only (never by slug or a default),
 * so an unknown id loads nothing and the snapshot run fails closed upstream.
 */
export function createSupabaseStylistSnapshotLoader(admin: Admin = createAdminClient()): StylistSnapshotLoader {
  const db = admin as any
  return {
    async loadStylist(stylistId: string): Promise<LoadedStylist | null> {
      const { data, error } = await db.from('stylist').select('*').eq('stylist_id', stylistId).maybeSingle()
      if (error) {
        throw new StylistSnapshotError(
          'source_read_failed',
          `stylist read failed for ${stylistId}: ${error.message ?? 'unknown error'}`,
          stylistId,
        )
      }
      if (!data) return null
      return {
        stylist_id: data.stylist_id,
        slug: data.slug,
        name: data.name,
        status: data.status,
        constitution_version: data.constitution_version ?? null,
        constitution: data.constitution ?? null,
        brief: parseBrief(data.brief, data.name),
        voice_notes: data.voice_notes ?? null,
        envelope: data.envelope ?? null,
        envelope_status: data.envelope_status ?? null,
        envelope_computed_at: data.envelope_computed_at ?? null,
      }
    },

    async loadItemMask(stylistId: string): Promise<ItemMaskDecision[]> {
      // Paged by stable key so a large mask is loaded completely; a page error
      // aborts the run instead of freezing a silently truncated mask.
      const rows = await readAllPages<any>(stylistId, 'stylist_item_mask', (from, to) =>
        db
          .from('stylist_item_mask')
          .select('item_id, eligibility, source, updated_at')
          .eq('stylist_id', stylistId)
          .order('item_id')
          .range(from, to),
      )
      return rows.map((r) => ({
        item_id: r.item_id,
        eligibility: r.eligibility,
        source: r.source ?? 'auto',
        updated_at: r.updated_at ?? null,
      }))
    },

    async loadLearnedModel(stylistId: string): Promise<LoadedLearnedModel> {
      // The selected stylist's OWN learned model, by exact stylist id. No
      // fallback: the legacy `style_model` singleton (Chloe's model) and the
      // fallback-aware `loadStyleModel`/`getStylistBySlug` path are never
      // consulted here. A stylist with no model row is explicitly absent.
      const { data, error } = await db
        .from('stylist_model')
        .select('model, decisions')
        .eq('stylist_id', stylistId)
        .maybeSingle()
      if (error) {
        throw new StylistSnapshotError(
          'source_read_failed',
          `stylist_model read failed for stylist ${stylistId}: ${error.message ?? 'unknown error'}`,
          stylistId,
        )
      }
      if (!data) return { present: false, payload: null, version: null, decisionCount: 0 }
      const model = data.model
      return {
        present: true,
        payload: model ?? null,
        version: typeof model?.version === 'number' ? model.version : null,
        decisionCount:
          typeof data.decisions === 'number'
            ? data.decisions
            : typeof model?.decisions === 'number'
              ? model.decisions
              : 0,
      }
    },

    async loadConfirmedInspiration(stylistId: string): Promise<LoadedInspirationImage[]> {
      // The stylist's own moodboard: persona_id = stylist, confirmed, and
      // user_id null (a member's own reference pictures are never the style's).
      // Paged like the mask; a page error aborts the run.
      const rows = await readAllPages<any>(stylistId, 'inspiration_image', (from, to) =>
        db
          .from('inspiration_image')
          .select('image_id, image_url, source_url, status, source, scores, scores_original, corrected_fields, corrected_at, score_confidence, vector, occasion_read, created_at')
          .eq('persona_id', stylistId)
          .eq('status', 'confirmed')
          .is('user_id', null)
          .order('image_id')
          .range(from, to),
      )
      return rows.map((r) => ({
        image_id: r.image_id,
        image_url: r.image_url,
        source_url: r.source_url ?? null,
        status: r.status,
        source: r.source ?? null,
        scores: r.scores ?? null,
        scores_original: r.scores_original ?? null,
        corrected_fields: Array.isArray(r.corrected_fields) ? r.corrected_fields : [],
        corrected_at: r.corrected_at ?? null,
        score_confidence: r.score_confidence ?? null,
        vector: Array.isArray(r.vector) ? r.vector : null,
        occasion_read: Array.isArray(r.occasion_read) ? r.occasion_read : null,
        created_at: r.created_at ?? null,
      }))
    },
  }
}

/**
 * Insert-only snapshot persistence. The table has a unique constraint on
 * `idempotency_key`; a replay returns the existing row rather than updating it,
 * and no column of an existing snapshot is ever mutated.
 */
export function createSupabaseStylistSnapshotStore(admin: Admin = createAdminClient()): StylistSnapshotStore {
  const db = admin as any
  return {
    async findByIdempotencyKey(key: string): Promise<StoredSnapshot | null> {
      const { data, error } = await db
        .from('outfit_quality_stylist_snapshot')
        .select('snapshot_id, payload_hash, rules_only, confirmed_inspiration_count, payload')
        .eq('idempotency_key', key)
        .maybeSingle()
      if (error) throw new Error(`stylist snapshot lookup failed: ${(error as any).message ?? 'unknown error'}`)
      return data ? toStored(data) : null
    },

    async insert(row: StylistSnapshotInsert): Promise<{ snapshot: StoredSnapshot; created: boolean }> {
      const insertRow = {
        stylist_id: row.stylist_id,
        constitution_version: row.constitution_version,
        payload: row.payload,
        payload_hash: row.payload_hash,
        confirmed_inspiration_count: row.confirmed_inspiration_count,
        rules_only: row.rules_only,
        generation_model: row.generation_model,
        prompt_version: row.prompt_version,
        objective_rules_version: row.objective_rules_version,
        subjective_check_model: row.subjective_check_model,
        subjective_prompt_version: row.subjective_prompt_version,
        composer_version: row.composer_version,
        item_query_version: row.item_query_version,
        idempotency_key: row.idempotency_key,
      }
      const { data, error } = await db
        .from('outfit_quality_stylist_snapshot')
        .insert(insertRow)
        .select('snapshot_id, payload_hash, rules_only, confirmed_inspiration_count, payload')
        .maybeSingle()

      if (error) {
        // Unique-violation on the idempotency key means a concurrent writer won
        // the race. Return that row; never overwrite it.
        if ((error as any).code === '23505') {
          const existing = await db
            .from('outfit_quality_stylist_snapshot')
            .select('snapshot_id, payload_hash, rules_only, confirmed_inspiration_count, payload')
            .eq('idempotency_key', row.idempotency_key)
            .maybeSingle()
          if (existing.error) {
            throw new Error(`stylist snapshot conflict re-read failed: ${(existing.error as any).message ?? 'unknown error'}`)
          }
          if (existing.data) return { snapshot: toStored(existing.data), created: false }
        }
        throw new Error(`stylist snapshot insert failed: ${(error as any).message ?? 'unknown error'}`)
      }
      if (!data) throw new Error('stylist snapshot insert returned no row')
      return { snapshot: toStored(data), created: true }
    },
  }
}

/**
 * Freeze the explicitly selected stylist for one batch, against the live source
 * tables. The idempotency key is derived from the batch so Start is idempotent:
 * calling it twice for the same batch returns the same snapshot and never
 * reloads mutable stylist state on replay. A missing or unloadable stylist
 * throws `StylistSnapshotError` before any snapshot row is written.
 */
export async function freezeSelectedStylistSnapshot(args: {
  batchId: string
  stylistId: string
  systemVersions?: SystemVersions
  admin?: Admin
}): Promise<StylistSnapshotResult> {
  const admin = args.admin ?? createAdminClient()
  return createStylistSnapshot({
    stylistId: args.stylistId,
    loader: createSupabaseStylistSnapshotLoader(admin),
    store: createSupabaseStylistSnapshotStore(admin),
    idempotencyKey: `batch:${args.batchId}:stylist:${args.stylistId}`,
    systemVersions: args.systemVersions,
  })
}

function toStored(data: any): StoredSnapshot {
  return {
    snapshot_id: data.snapshot_id,
    payload_hash: data.payload_hash,
    rules_only: !!data.rules_only,
    confirmed_inspiration_count: data.confirmed_inspiration_count ?? 0,
    payload: data.payload as SnapshotPayload,
  }
}
