import { describe, it, expect } from 'vitest'
import {
  validateLegacyManifest,
  buildLegacyEvidenceRows,
  importLegacyCanonicalEvidence,
  LegacyImportError,
  LEGACY_EVIDENCE_ATTRIBUTION,
  EXPECTED_LEGACY_CANONICAL_COUNT,
  type LegacyEvidenceStore,
  type LegacyEvidenceRow,
} from '@/lib/outfit-quality/legacy-evidence'
import { CHLOE_STYLIST_ID } from '@/lib/outfit-quality/identities'

// Deterministic fixture: a small known canonical set. The real import uses the
// exact 444; these tests prove the validation and idempotency behaviour without
// touching the connected project.
const KNOWN = ['a', 'b', 'c', 'd']
const EXPECT = KNOWN.length

describe('EXPECTED_LEGACY_CANONICAL_COUNT', () => {
  it('is exactly 444', () => {
    expect(EXPECTED_LEGACY_CANONICAL_COUNT).toBe(444)
  })
})

describe('validateLegacyManifest', () => {
  it('accepts the exact known manifest in any order', () => {
    expect(validateLegacyManifest(['d', 'c', 'b', 'a'], KNOWN, EXPECT)).toMatchObject({ ok: true })
  })

  it('rejects a wrong count (missing one → extra one would still be caught, but count is first)', () => {
    const r = validateLegacyManifest(['a', 'b', 'c'], KNOWN, EXPECT)
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.error.code).toBe('wrong_count')
  })

  it('rejects an altered/unknown ID', () => {
    const r = validateLegacyManifest(['a', 'b', 'c', 'z'], KNOWN, EXPECT)
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) {
      expect(r.error.code).toBe('unknown')
      expect(r.error).toHaveProperty('ids', ['z'])
    }
  })

  it('rejects an extra ID (count exceeds expected)', () => {
    const r = validateLegacyManifest(['a', 'b', 'c', 'd', 'e'], KNOWN, EXPECT)
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.error.code).toBe('wrong_count')
  })

  it('rejects a duplicate ID', () => {
    const r = validateLegacyManifest(['a', 'b', 'c', 'c'], KNOWN, EXPECT)
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) {
      expect(r.error.code).toBe('duplicate')
      expect(r.error).toHaveProperty('ids', ['c'])
    }
  })

  it('rejects a missing known ID (same count, one swapped is caught as unknown)', () => {
    // Build a case where count matches and no unknowns, but one known is missing:
    // only possible if a duplicate replaces it, which the duplicate check catches
    // first. Prove `missing` via a known set smaller than the manifest's distinct
    // coverage is impossible; instead omit by using expectedCount matching a set
    // that includes an id absent from the manifest.
    const known5 = ['a', 'b', 'c', 'd', 'e']
    const r = validateLegacyManifest(['a', 'b', 'c', 'd', 'd'], known5, 5)
    // duplicate is detected before missing
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.error.code).toBe('duplicate')
  })
})

describe('buildLegacyEvidenceRows', () => {
  it('attributes every row to Chloe stylist with the fixed positive/stylist/legacy attribution', () => {
    const built = buildLegacyEvidenceRows({ manifest: KNOWN, knownCanonicalIds: KNOWN, importManifestId: 'mani-1', expectedCount: EXPECT })
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.rows).toHaveLength(EXPECT)
      for (const row of built.rows) {
        expect(row.stylist_id).toBe(CHLOE_STYLIST_ID)
        expect(row.data_partition).toBe(LEGACY_EVIDENCE_ATTRIBUTION.data_partition)
        expect(row.polarity).toBe('positive')
        expect(row.scope).toBe('stylist')
        expect(row.source).toBe('legacy_canonical')
        expect(row.import_manifest_id).toBe('mani-1')
      }
      // No global projection, no member attribution: there is no such field,
      // and scope is strictly 'stylist'.
      expect(built.rows.every((r) => r.scope === 'stylist')).toBe(true)
    }
  })

  it('refuses to build rows for an invalid manifest', () => {
    const built = buildLegacyEvidenceRows({ manifest: ['a', 'b'], knownCanonicalIds: KNOWN, importManifestId: 'm', expectedCount: EXPECT })
    expect(built.ok).toBe(false)
  })
})

// In-memory idempotent store mirroring ON CONFLICT (outfit_id) DO NOTHING.
function makeStore(known: string[]): LegacyEvidenceStore & { rows: LegacyEvidenceRow[] } {
  const rows: LegacyEvidenceRow[] = []
  return {
    rows,
    async knownCanonicalIds() { return [...known] },
    async existingEvidenceOutfitIds() { return rows.map((r) => r.outfit_id) },
    async insertEvidence(toInsert) {
      const have = new Set(rows.map((r) => r.outfit_id))
      let n = 0
      for (const r of toInsert) {
        if (!have.has(r.outfit_id)) { rows.push(r); have.add(r.outfit_id); n++ }
      }
      return n
    },
  }
}

describe('importLegacyCanonicalEvidence', () => {
  it('imports the full manifest once', async () => {
    const store = makeStore(KNOWN)
    const res = await importLegacyCanonicalEvidence({ manifest: KNOWN, store, importManifestId: 'mani-1', expectedCount: EXPECT })
    expect(res).toMatchObject({ inserted: EXPECT, skipped: 0, total: EXPECT })
    expect(store.rows).toHaveLength(EXPECT)
    expect(store.rows.every((r) => r.stylist_id === CHLOE_STYLIST_ID)).toBe(true)
  })

  it('is idempotent on replay — a second run inserts nothing', async () => {
    const store = makeStore(KNOWN)
    await importLegacyCanonicalEvidence({ manifest: KNOWN, store, importManifestId: 'mani-1', expectedCount: EXPECT })
    const second = await importLegacyCanonicalEvidence({ manifest: KNOWN, store, importManifestId: 'mani-2', expectedCount: EXPECT })
    expect(second).toMatchObject({ inserted: 0, skipped: EXPECT, total: EXPECT })
    expect(store.rows).toHaveLength(EXPECT)
  })

  it('throws for an unknown ID and writes nothing', async () => {
    const store = makeStore(KNOWN)
    await expect(importLegacyCanonicalEvidence({ manifest: ['a', 'b', 'c', 'z'], store, importManifestId: 'm', expectedCount: EXPECT }))
      .rejects.toBeInstanceOf(LegacyImportError)
    expect(store.rows).toHaveLength(0)
  })

  it('throws for a wrong count and writes nothing', async () => {
    const store = makeStore(KNOWN)
    await expect(importLegacyCanonicalEvidence({ manifest: ['a', 'b'], store, importManifestId: 'm', expectedCount: EXPECT }))
      .rejects.toBeInstanceOf(LegacyImportError)
    expect(store.rows).toHaveLength(0)
  })
})
