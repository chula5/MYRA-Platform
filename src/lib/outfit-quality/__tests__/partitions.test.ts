import { describe, it, expect } from 'vitest'
import {
  DATA_PARTITIONS,
  isDataPartition,
  validateContext,
  validateBatchAttribution,
  validateCaseMatchesBatch,
  assertPartitionChangeAllowed,
} from '@/lib/outfit-quality/partitions'

const MEMBER = '9593c768-cd52-4bf2-99bc-5a44ae2bc8e2'
const PROFILE = '11111111-1111-1111-1111-111111111111'
const STYLIST = '0d535772-8a4f-440f-9e46-f8d637bed0d3'
const SNAPSHOT = '22222222-2222-2222-2222-222222222222'

describe('data partitions', () => {
  it('accepts exactly the five approved partitions', () => {
    expect([...DATA_PARTITIONS]).toEqual(['training', 'validation', 'holdout', 'synthetic', 'test'])
    for (const p of DATA_PARTITIONS) expect(isDataPartition(p)).toBe(true)
  })

  it('rejects any unknown partition value', () => {
    for (const bad of ['prod', 'TRAINING', 'Test', '', 'live', null, undefined, 7]) {
      expect(isDataPartition(bad as unknown)).toBe(false)
    }
  })

  it('validateBatchAttribution accepts each of the five partitions with one context + stylist', () => {
    for (const p of DATA_PARTITIONS) {
      expect(validateBatchAttribution({ dataPartition: p, realMemberId: MEMBER, selectedStylistId: STYLIST }))
        .toEqual({ ok: true })
    }
  })

  it('validateBatchAttribution rejects an unknown partition', () => {
    const r = validateBatchAttribution({ dataPartition: 'production', realMemberId: MEMBER, selectedStylistId: STYLIST })
    expect(r).toMatchObject({ ok: false, code: 'unknown_partition' })
  })
})

describe('exactly-one-context', () => {
  it('accepts a lone real member', () => {
    expect(validateContext({ realMemberId: MEMBER })).toEqual({ ok: true })
  })
  it('accepts a lone evaluation profile', () => {
    expect(validateContext({ evaluationProfileId: PROFILE })).toEqual({ ok: true })
  })
  it('rejects both contexts at once', () => {
    expect(validateContext({ realMemberId: MEMBER, evaluationProfileId: PROFILE }))
      .toMatchObject({ ok: false, code: 'both_contexts' })
  })
  it('rejects neither context', () => {
    expect(validateContext({})).toMatchObject({ ok: false, code: 'no_context' })
  })
  it('rejects a batch with no stylist', () => {
    expect(validateBatchAttribution({ dataPartition: 'test', realMemberId: MEMBER }))
      .toMatchObject({ ok: false, code: 'missing_stylist' })
  })
})

describe('case attribution must equal its batch', () => {
  const batch = { dataPartition: 'test', realMemberId: MEMBER, selectedStylistId: STYLIST, stylistSnapshotId: SNAPSHOT }

  it('accepts a matching case', () => {
    expect(validateCaseMatchesBatch(batch, { ...batch })).toEqual({ ok: true })
  })
  it('rejects a drifted partition', () => {
    expect(validateCaseMatchesBatch(batch, { ...batch, dataPartition: 'training' }))
      .toMatchObject({ ok: false, code: 'partition_mismatch' })
  })
  it('rejects a drifted context', () => {
    expect(validateCaseMatchesBatch(batch, { dataPartition: 'test', evaluationProfileId: PROFILE, selectedStylistId: STYLIST, stylistSnapshotId: SNAPSHOT }))
      .toMatchObject({ ok: false, code: 'context_mismatch' })
  })
  it('rejects a drifted stylist', () => {
    expect(validateCaseMatchesBatch(batch, { ...batch, selectedStylistId: PROFILE }))
      .toMatchObject({ ok: false, code: 'stylist_mismatch' })
  })
  it('rejects a drifted snapshot', () => {
    expect(validateCaseMatchesBatch(batch, { ...batch, stylistSnapshotId: 'different' }))
      .toMatchObject({ ok: false, code: 'snapshot_mismatch' })
  })
})

describe('partition immutability after cases exist', () => {
  it('allows a change while the batch has no cases', () => {
    expect(assertPartitionChangeAllowed({ currentPartition: 'test', nextPartition: 'training', hasCases: false }))
      .toEqual({ ok: true })
  })
  it('is a no-op when the partition is unchanged', () => {
    expect(assertPartitionChangeAllowed({ currentPartition: 'test', nextPartition: 'test', hasCases: true }))
      .toEqual({ ok: true })
  })
  it('rejects a change once a case exists', () => {
    expect(assertPartitionChangeAllowed({ currentPartition: 'test', nextPartition: 'training', hasCases: true }))
      .toMatchObject({ ok: false, code: 'partition_locked' })
  })
  it('rejects a change to an unknown partition even with no cases', () => {
    expect(assertPartitionChangeAllowed({ currentPartition: 'test', nextPartition: 'bogus', hasCases: false }))
      .toMatchObject({ ok: false, code: 'unknown_partition' })
  })
})
