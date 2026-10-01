// The one frozen lens — the explicit selected-stylist snapshot service.
//
// A Quality Lab batch freezes *one explicitly selected stylist* into a single
// immutable, canonically-hashed snapshot. Generation and subjective checking
// then read that snapshot by id and hash and never reread mutable stylist
// tables. There is no default stylist and no silent Chloe fallback: a missing
// or unloadable selected stylist fails here, before any snapshot, case,
// candidate, or check is written.
//
// This module is pure and dependency-light so it can be exhaustively unit
// tested. Loading from Supabase and persisting are injected through the
// `StylistSnapshotLoader` / `StylistSnapshotStore` interfaces (see
// `stylist-snapshot-store.ts` for the server-only wiring).

import { createHash } from 'node:crypto'
import { MIN_CONFIRMED_IMAGES } from '@/lib/inspiration'
import { VECTOR_DIM } from '@/lib/taste-vector'
import type { StylistBrief, StylistNever } from '@/lib/stylist-brief'

export { MIN_CONFIRMED_IMAGES }

/** Confirmed-image vectors and envelope mean/spread are exactly this long. */
export const SNAPSHOT_VECTOR_DIM = VECTOR_DIM

// ── System/prompt versions frozen into every snapshot ────────────────────────
//
// These capture the generation and checking machinery a run was frozen against,
// so a snapshot is reproducible provenance. Any change here changes the payload
// hash, which is exactly the point: a different engine is a different lens.
export interface SystemVersions {
  generation_model: string
  prompt_version: string
  objective_rules_version: string
  subjective_check_model: string
  subjective_prompt_version: string
  composer_version: string
  item_query_version: string
}

export const SNAPSHOT_SYSTEM_VERSIONS: SystemVersions = {
  generation_model: 'pilot-composer',
  prompt_version: 'quality-lab-generation-v1',
  objective_rules_version: 'quality-lab-objective-v1',
  // The existing subjective look check runs on this model (see look-check.ts).
  subjective_check_model: 'claude-opus-5',
  subjective_prompt_version: 'quality-lab-subjective-v1',
  composer_version: 'pilot-composer-v1',
  item_query_version: 'quality-lab-item-query-v1',
}

// ── Loaded selected-stylist inputs (the raw bundle, pre-freeze) ──────────────

export interface LoadedStylist {
  stylist_id: string
  slug: string
  name: string
  status: string
  constitution_version: number | null
  constitution: Record<string, unknown> | null
  brief: StylistBrief
  voice_notes: string | null
  envelope: unknown | null
  envelope_status: string | null
  envelope_computed_at: string | null
}

export interface ItemMaskDecision {
  item_id: string
  eligibility: string
  source: string
  updated_at?: string | null
}

export interface LoadedLearnedModel {
  /**
   * Whether the selected stylist has its OWN learned model row in
   * `stylist_model`. There is no fallback: when a stylist has no model of its
   * own, `present` is false and the snapshot records an explicit
   * `status: 'absent'` — never Chloe's model and never a silent empty one.
   */
  present: boolean
  payload: unknown | null
  version: number | null
  decisionCount: number
}

export interface LoadedInspirationImage {
  image_id: string
  image_url: string
  source_url?: string | null
  status: string
  source?: string | null
  scores: unknown | null
  scores_original: unknown | null
  corrected_fields: string[]
  corrected_at?: string | null
  score_confidence: number | null
  vector: number[] | null
  occasion_read: string[] | null
  created_at: string | null
}

export interface SelectedStylistInputs {
  stylist: LoadedStylist
  itemMask: ItemMaskDecision[]
  learnedModel: LoadedLearnedModel
  confirmedInspiration: LoadedInspirationImage[]
  systemVersions?: SystemVersions
}

// ── Canonical serialisation + hashing ────────────────────────────────────────

/**
 * Deterministic JSON: object keys are emitted in sorted order at every depth so
 * two semantically identical objects serialise identically. Array order is
 * preserved — an array is inherently ordered, so callers sort set-like
 * collections (item mask, inspiration) by a stable key before building the
 * payload. `undefined` is normalised to `null` so an absent field and an
 * explicit null are indistinguishable.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(toCanonical(value))
}

function toCanonical(value: unknown): unknown {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) return value.map(toCanonical)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      out[key] = toCanonical(obj[key])
    }
    return out
  }
  return value
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function computePayloadHash(payload: SnapshotPayload): string {
  return sha256Hex(canonicalize(payload))
}

// ── Rules-only detection ─────────────────────────────────────────────────────

/**
 * The 34-dimension vector contract: a vector is valid only when it is exactly
 * `VECTOR_DIM` finite numbers. Anything else — wrong length, NaN, Infinity, a
 * stringified or sparse value — is not usable evidence.
 */
export function isValidVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === VECTOR_DIM &&
    value.every((x) => typeof x === 'number' && Number.isFinite(x))
  )
}

/** A confirmed inspiration image counts only when it carries a valid 34-dimension vector. */
export function countValidConfirmedImages(images: readonly LoadedInspirationImage[]): number {
  return images.filter((i) => i.status === 'confirmed' && isValidVector(i.vector)).length
}

/**
 * An envelope is usable when its mean and spread are both valid 34-dimension
 * vectors (matching lengths by contract) and n is a finite positive count.
 */
export function isEnvelopeUsable(envelope: unknown): boolean {
  if (!envelope || typeof envelope !== 'object') return false
  const e = envelope as { mean?: unknown; spread?: unknown; n?: unknown }
  return (
    isValidVector(e.mean) &&
    isValidVector(e.spread) &&
    e.mean.length === e.spread.length &&
    typeof e.n === 'number' &&
    Number.isFinite(e.n) &&
    e.n > 0
  )
}

// ── Canonical payload ────────────────────────────────────────────────────────

export interface SnapshotPayload {
  stylist: {
    stylist_id: string
    slug: string
    display_name: string
    status: string
    constitution_version: number | null
  }
  constitution: Record<string, unknown> | null
  brief: StylistBrief
  brand_direction: string[]
  palette: string[]
  fabrics: string[]
  signature_pieces: string[]
  exclusions: StylistNever[]
  voice: {
    voice_notes: string | null
    tagline: string
    day: string | null
    evening: string | null
    weekend: string | null
    how_she_routes: string | null
  }
  item_mask: {
    count: number
    decisions: { item_id: string; eligibility: string; source: string; updated_at: string | null }[]
  }
  learned_model: {
    /** 'loaded' = this stylist's own model row; 'absent' = it has none (never borrowed). */
    status: 'loaded' | 'absent'
    payload: unknown | null
    version: number | null
    decision_count: number
  }
  inspiration: {
    confirmed_count: number
    images: {
      image_id: string
      image_url: string
      source_url: string | null
      status: string
      source: string | null
      scores: unknown | null
      scores_original: unknown | null
      corrected_fields: string[]
      corrected_at: string | null
      score_confidence: number | null
      vector: number[] | null
      occasion_read: string[] | null
      created_at: string | null
    }[]
  }
  envelope: {
    payload: unknown
    status: string | null
    computed_at: string | null
  } | null
  rules_only: boolean
  system_versions: SystemVersions
}

/**
 * Build the complete canonical payload for one explicitly selected stylist.
 * Only this stylist's own evidence is included; nothing is ever borrowed. Set
 * like collections are sorted by a stable id so the payload — and therefore its
 * hash — is independent of load order.
 */
export function buildSnapshotPayload(inputs: SelectedStylistInputs): SnapshotPayload {
  const { stylist, itemMask, learnedModel } = inputs
  const brief = stylist.brief
  const systemVersions = inputs.systemVersions ?? SNAPSHOT_SYSTEM_VERSIONS

  // Only this stylist's own confirmed inspiration — never substituted.
  const confirmed = inputs.confirmedInspiration.filter((i) => i.status === 'confirmed')
  const confirmedCount = countValidConfirmedImages(inputs.confirmedInspiration)
  const envelopeUsable = isEnvelopeUsable(stylist.envelope)
  const rulesOnly = confirmedCount < MIN_CONFIRMED_IMAGES || !envelopeUsable

  const decisions = [...itemMask]
    .sort((a, b) => a.item_id.localeCompare(b.item_id))
    .map((d) => ({ item_id: d.item_id, eligibility: d.eligibility, source: d.source, updated_at: d.updated_at ?? null }))

  const images = [...confirmed]
    .sort((a, b) => a.image_id.localeCompare(b.image_id))
    .map((i) => ({
      image_id: i.image_id,
      image_url: i.image_url,
      source_url: i.source_url ?? null,
      status: i.status,
      source: i.source ?? null,
      scores: i.scores ?? null,
      scores_original: i.scores_original ?? null,
      corrected_fields: [...(i.corrected_fields ?? [])].sort(),
      corrected_at: i.corrected_at ?? null,
      score_confidence: i.score_confidence ?? null,
      vector: Array.isArray(i.vector) ? i.vector : null,
      occasion_read: i.occasion_read ?? null,
      created_at: i.created_at ?? null,
    }))

  return {
    stylist: {
      stylist_id: stylist.stylist_id,
      slug: stylist.slug,
      display_name: stylist.name,
      status: stylist.status,
      constitution_version: stylist.constitution_version ?? null,
    },
    constitution: stylist.constitution ?? null,
    brief,
    brand_direction: [...brief.brands],
    palette: [...brief.palette],
    fabrics: [...brief.fabrics],
    signature_pieces: [...brief.signature_pieces],
    exclusions: [...brief.nevers],
    voice: {
      voice_notes: stylist.voice_notes ?? null,
      tagline: brief.tagline ?? '',
      day: brief.day ?? null,
      evening: brief.evening ?? null,
      weekend: brief.weekend ?? null,
      how_she_routes: brief.how_she_routes ?? null,
    },
    item_mask: { count: decisions.length, decisions },
    learned_model: learnedModel.present
      ? {
          status: 'loaded',
          payload: learnedModel.payload ?? null,
          version: learnedModel.version ?? null,
          decision_count: learnedModel.decisionCount,
        }
      : { status: 'absent', payload: null, version: null, decision_count: 0 },
    inspiration: { confirmed_count: confirmedCount, images },
    // A rules-only snapshot carries no envelope at all — never a borrowed one.
    envelope: envelopeUsable
      ? { payload: stylist.envelope, status: stylist.envelope_status ?? null, computed_at: stylist.envelope_computed_at ?? null }
      : null,
    rules_only: rulesOnly,
    system_versions: systemVersions,
  }
}

// ── Snapshot row (payload + indexed columns + hash) ──────────────────────────

export interface BuiltStylistSnapshot {
  stylist_id: string
  constitution_version: number | null
  payload: SnapshotPayload
  payload_hash: string
  confirmed_inspiration_count: number
  rules_only: boolean
  generation_model: string
  prompt_version: string
  objective_rules_version: string
  subjective_check_model: string
  subjective_prompt_version: string
  composer_version: string
  item_query_version: string
}

export function buildStylistSnapshot(inputs: SelectedStylistInputs): BuiltStylistSnapshot {
  const payload = buildSnapshotPayload(inputs)
  const v = payload.system_versions
  return {
    stylist_id: inputs.stylist.stylist_id,
    constitution_version: payload.stylist.constitution_version,
    payload,
    payload_hash: computePayloadHash(payload),
    confirmed_inspiration_count: payload.inspiration.confirmed_count,
    rules_only: payload.rules_only,
    generation_model: v.generation_model,
    prompt_version: v.prompt_version,
    objective_rules_version: v.objective_rules_version,
    subjective_check_model: v.subjective_check_model,
    subjective_prompt_version: v.subjective_prompt_version,
    composer_version: v.composer_version,
    item_query_version: v.item_query_version,
  }
}

// ── Orchestration (fail-closed, insert-only, idempotent) ─────────────────────

export type StylistSnapshotErrorCode = 'missing_stylist' | 'stylist_not_loadable' | 'source_read_failed'

export class StylistSnapshotError extends Error {
  readonly code: StylistSnapshotErrorCode
  readonly stylistId: string | null
  constructor(code: StylistSnapshotErrorCode, message: string, stylistId: string | null = null) {
    super(message)
    this.name = 'StylistSnapshotError'
    this.code = code
    this.stylistId = stylistId
  }
}

/**
 * Loads only the one explicitly selected stylist. Every method is given the
 * exact stylist id; no implementation may resolve a default or Chloe fallback.
 * `loadStylist` returns null when the id is unknown/unloadable, which fails the
 * run closed before any further load.
 */
export interface StylistSnapshotLoader {
  loadStylist(stylistId: string): Promise<LoadedStylist | null>
  loadItemMask(stylistId: string): Promise<ItemMaskDecision[]>
  /**
   * Load the selected stylist's OWN learned model by exact stylist id. A
   * stylist with no model row returns `{ present: false, ... }` — an explicit
   * absence, never a fallback to another stylist's model. Implementations
   * throw `StylistSnapshotError('source_read_failed')` on a read error.
   */
  loadLearnedModel(stylistId: string): Promise<LoadedLearnedModel>
  loadConfirmedInspiration(stylistId: string): Promise<LoadedInspirationImage[]>
}

export interface StylistSnapshotInsert extends BuiltStylistSnapshot {
  idempotency_key: string
}

export interface StoredSnapshot {
  snapshot_id: string
  payload_hash: string
  rules_only: boolean
  confirmed_inspiration_count: number
  payload: SnapshotPayload
}

/**
 * Insert-only persistence. `insert` must honour a unique constraint on
 * `idempotency_key` and, on conflict, return the existing row with
 * `created: false` rather than updating anything.
 */
export interface StylistSnapshotStore {
  findByIdempotencyKey(key: string): Promise<StoredSnapshot | null>
  insert(row: StylistSnapshotInsert): Promise<{ snapshot: StoredSnapshot; created: boolean }>
}

export interface CreateStylistSnapshotArgs {
  stylistId: string
  loader: StylistSnapshotLoader
  store: StylistSnapshotStore
  idempotencyKey: string
  systemVersions?: SystemVersions
}

export interface StylistSnapshotResult {
  snapshotId: string
  payloadHash: string
  rulesOnly: boolean
  confirmedInspirationCount: number
  reused: boolean
}

/**
 * Freeze one explicitly selected stylist into an immutable snapshot. Fails
 * closed on a missing or unloadable stylist (no fallback, no downstream
 * writes), and is idempotent on replay: the same creation key returns the same
 * snapshot without reloading mutable stylist state.
 */
export async function createStylistSnapshot(args: CreateStylistSnapshotArgs): Promise<StylistSnapshotResult> {
  const { stylistId, loader, store, idempotencyKey } = args
  if (!stylistId) {
    throw new StylistSnapshotError('missing_stylist', 'A stylist snapshot requires an explicit selected stylist id')
  }

  const existing = await store.findByIdempotencyKey(idempotencyKey)
  if (existing) return toResult(existing, true)

  const stylist = await loader.loadStylist(stylistId)
  if (!stylist) {
    throw new StylistSnapshotError('stylist_not_loadable', `Selected stylist ${stylistId} could not be loaded`, stylistId)
  }

  const [itemMask, learnedModel, confirmedInspiration] = await Promise.all([
    loader.loadItemMask(stylistId),
    loader.loadLearnedModel(stylistId),
    loader.loadConfirmedInspiration(stylistId),
  ])

  const built = buildStylistSnapshot({
    stylist,
    itemMask,
    learnedModel,
    confirmedInspiration,
    systemVersions: args.systemVersions,
  })

  const { snapshot, created } = await store.insert({ ...built, idempotency_key: idempotencyKey })
  return toResult(snapshot, !created)
}

function toResult(snapshot: StoredSnapshot, reused: boolean): StylistSnapshotResult {
  return {
    snapshotId: snapshot.snapshot_id,
    payloadHash: snapshot.payload_hash,
    rulesOnly: snapshot.rules_only,
    confirmedInspirationCount: snapshot.confirmed_inspiration_count,
    reused,
  }
}
