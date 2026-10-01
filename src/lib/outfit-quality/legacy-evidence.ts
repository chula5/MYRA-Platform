// Legacy canonical evidence import for the Outfit Quality Lab.
//
// The existing canonical outfit set is recorded, once, as positive Chloe-only
// stylist evidence. It is attributed to exactly one scope — the Chloe stylist —
// and produces no global projection, no member event, and no attribution to any
// other stylist. The import is a closed set: it must be exactly the known
// manifest, with no altered, missing, extra, duplicate, or unknown IDs, and
// rerunning it is idempotent.

import { CHLOE_STYLIST_ID } from '@/lib/outfit-quality/identities'

/** The exact number of approved legacy canonical outfits. */
export const EXPECTED_LEGACY_CANONICAL_COUNT = 444

/** The fixed, non-negotiable attribution every legacy evidence row carries. */
export const LEGACY_EVIDENCE_ATTRIBUTION = {
  data_partition: 'training',
  polarity: 'positive',
  scope: 'stylist',
  source: 'legacy_canonical',
} as const

export type LegacyManifestError =
  | { code: 'wrong_count'; message: string; expected: number; actual: number }
  | { code: 'duplicate'; message: string; ids: string[] }
  | { code: 'unknown'; message: string; ids: string[] }
  | { code: 'missing'; message: string; ids: string[] }

export type LegacyManifestValidation =
  | { ok: true; ids: string[] }
  | { ok: false; error: LegacyManifestError }

/**
 * Validate a proposed manifest against the authoritative known canonical set.
 *
 * Rejects, before any write, a manifest that is the wrong size, contains a
 * duplicate, contains an ID that is not a known canonical outfit (altered or
 * extra/unknown), or omits a known canonical outfit (missing).
 */
export function validateLegacyManifest(
  manifest: readonly string[],
  knownCanonicalIds: readonly string[],
  expectedCount: number = EXPECTED_LEGACY_CANONICAL_COUNT,
): LegacyManifestValidation {
  if (manifest.length !== expectedCount) {
    return {
      ok: false,
      error: { code: 'wrong_count', message: `Manifest must contain exactly ${expectedCount} outfit IDs; received ${manifest.length}`, expected: expectedCount, actual: manifest.length },
    }
  }

  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const id of manifest) {
    if (seen.has(id)) dupes.add(id)
    seen.add(id)
  }
  if (dupes.size > 0) {
    return { ok: false, error: { code: 'duplicate', message: 'Manifest contains duplicate outfit IDs', ids: Array.from(dupes).sort() } }
  }

  const known = new Set(knownCanonicalIds)
  const unknown = manifest.filter((id) => !known.has(id))
  if (unknown.length > 0) {
    return { ok: false, error: { code: 'unknown', message: 'Manifest contains outfit IDs that are not known canonical outfits', ids: [...unknown].sort() } }
  }

  const missing = Array.from(known).filter((id) => !seen.has(id))
  if (missing.length > 0) {
    return { ok: false, error: { code: 'missing', message: 'Manifest omits known canonical outfit IDs', ids: missing.sort() } }
  }

  return { ok: true, ids: [...manifest] }
}

export interface LegacyEvidenceRow {
  outfit_id: string
  stylist_id: string
  data_partition: 'training'
  polarity: 'positive'
  scope: 'stylist'
  source: 'legacy_canonical'
  import_manifest_id: string
}

/** Build the exact evidence rows for a validated manifest. Chloe-only, by ID. */
export function buildLegacyEvidenceRows(args: {
  manifest: readonly string[]
  knownCanonicalIds: readonly string[]
  importManifestId: string
  chloeStylistId?: string
  expectedCount?: number
}): { ok: true; rows: LegacyEvidenceRow[] } | { ok: false; error: LegacyManifestError } {
  const stylistId = args.chloeStylistId ?? CHLOE_STYLIST_ID
  const validation = validateLegacyManifest(args.manifest, args.knownCanonicalIds, args.expectedCount)
  if (!validation.ok) return { ok: false, error: validation.error }
  const rows = validation.ids.map((outfit_id) => ({
    outfit_id,
    stylist_id: stylistId,
    ...LEGACY_EVIDENCE_ATTRIBUTION,
    import_manifest_id: args.importManifestId,
  }))
  return { ok: true, rows }
}

/**
 * A store the importer writes through. Implementations insert idempotently
 * (ON CONFLICT DO NOTHING on the outfit_id primary key), so a replay inserts
 * nothing new.
 */
export interface LegacyEvidenceStore {
  /** The authoritative set of known canonical outfit IDs. */
  knownCanonicalIds(): Promise<string[]>
  /** Outfit IDs already present in the legacy evidence table. */
  existingEvidenceOutfitIds(): Promise<string[]>
  /** Insert rows idempotently; returns how many were newly inserted. */
  insertEvidence(rows: LegacyEvidenceRow[]): Promise<number>
}

export interface LegacyImportResult {
  inserted: number
  skipped: number
  total: number
  importManifestId: string
}

/**
 * Import the manifest as Chloe-only legacy evidence. Validates the full closed
 * set first, then inserts only rows not already present. Idempotent on replay.
 */
export async function importLegacyCanonicalEvidence(args: {
  manifest: readonly string[]
  store: LegacyEvidenceStore
  importManifestId: string
  chloeStylistId?: string
  expectedCount?: number
}): Promise<LegacyImportResult> {
  const known = await args.store.knownCanonicalIds()
  const built = buildLegacyEvidenceRows({
    manifest: args.manifest,
    knownCanonicalIds: known,
    importManifestId: args.importManifestId,
    chloeStylistId: args.chloeStylistId,
    expectedCount: args.expectedCount,
  })
  if (!built.ok) {
    throw new LegacyImportError(built.error)
  }
  const already = new Set(await args.store.existingEvidenceOutfitIds())
  const toInsert = built.rows.filter((r) => !already.has(r.outfit_id))
  const inserted = toInsert.length === 0 ? 0 : await args.store.insertEvidence(toInsert)
  return {
    inserted,
    skipped: built.rows.length - toInsert.length,
    total: built.rows.length,
    importManifestId: args.importManifestId,
  }
}

export class LegacyImportError extends Error {
  readonly error: LegacyManifestError
  constructor(error: LegacyManifestError) {
    super(error.message)
    this.name = 'LegacyImportError'
    this.error = error
  }
}
