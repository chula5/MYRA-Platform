// The structured No-reason taxonomy is the shared schema every surface uses:
// the review form, the server validator, and (downstream) learning projection
// mapping. A `No` needs exactly one approved reason; a note never substitutes;
// item-specific variants need exactly one item from the reviewed version.

import { describe, it, expect } from 'vitest'
import {
  REVIEW_REASONS,
  REVIEW_REASON_CODES,
  isReviewReasonCode,
  reasonRequiresItem,
  reasonCategory,
  validateNoReason,
} from '@/lib/outfit-quality/review-reasons'

describe('review reason taxonomy', () => {
  it('contains exactly the four global categories and their item-specific variants', () => {
    expect(REVIEW_REASON_CODES).toEqual([
      'global_composition',
      'wrong_for_stylist',
      'wrong_for_member',
      'operational_data',
      'item_global_composition',
      'item_wrong_for_stylist',
      'item_wrong_for_member',
      'item_operational_data',
    ])
  })

  it('every reason has a visible label and a stable code', () => {
    for (const r of REVIEW_REASONS) {
      expect(r.code).toBeTruthy()
      expect(r.label.length).toBeGreaterThan(3)
    }
  })

  it('recognises valid codes and rejects arbitrary strings', () => {
    expect(isReviewReasonCode('global_composition')).toBe(true)
    expect(isReviewReasonCode('item_wrong_for_member')).toBe(true)
    expect(isReviewReasonCode('not_a_reason')).toBe(false)
    expect(isReviewReasonCode('')).toBe(false)
    expect(isReviewReasonCode('GLOBAL_COMPOSITION')).toBe(false)
  })

  it('marks item-specific variants as requiring an affected item', () => {
    expect(reasonRequiresItem('global_composition')).toBe(false)
    expect(reasonRequiresItem('operational_data')).toBe(false)
    expect(reasonRequiresItem('item_global_composition')).toBe(true)
    expect(reasonRequiresItem('item_operational_data')).toBe(true)
  })

  it('maps every item-specific variant back to its base category for learning scope', () => {
    expect(reasonCategory('item_global_composition')).toBe('global_composition')
    expect(reasonCategory('item_wrong_for_stylist')).toBe('wrong_for_stylist')
    expect(reasonCategory('item_wrong_for_member')).toBe('wrong_for_member')
    expect(reasonCategory('item_operational_data')).toBe('operational_data')
    expect(reasonCategory('wrong_for_stylist')).toBe('wrong_for_stylist')
  })
})

describe('validateNoReason', () => {
  const items = ['ci-1', 'ci-2']

  it('accepts a global reason with no item', () => {
    expect(validateNoReason({ reasonCode: 'global_composition', candidateItemId: null, versionItemIds: items })).toEqual({ ok: true })
  })

  it('rejects a missing reason even when a note could be present', () => {
    const r = validateNoReason({ reasonCode: null, candidateItemId: null, versionItemIds: items })
    expect(r).toMatchObject({ ok: false, code: 'missing_reason' })
  })

  it('rejects an unknown reason code', () => {
    const r = validateNoReason({ reasonCode: 'vibes', candidateItemId: null, versionItemIds: items })
    expect(r).toMatchObject({ ok: false, code: 'unknown_reason' })
  })

  it('rejects an item-specific reason without an affected item', () => {
    const r = validateNoReason({ reasonCode: 'item_wrong_for_stylist', candidateItemId: null, versionItemIds: items })
    expect(r).toMatchObject({ ok: false, code: 'missing_item' })
  })

  it('rejects an affected item that does not belong to the reviewed version', () => {
    const r = validateNoReason({ reasonCode: 'item_global_composition', candidateItemId: 'ci-foreign', versionItemIds: items })
    expect(r).toMatchObject({ ok: false, code: 'foreign_item' })
  })

  it('accepts an item-specific reason with exactly one item of the version', () => {
    expect(validateNoReason({ reasonCode: 'item_wrong_for_member', candidateItemId: 'ci-2', versionItemIds: items })).toEqual({ ok: true })
  })

  it('rejects an affected item attached to a global (non-item) reason', () => {
    const r = validateNoReason({ reasonCode: 'operational_data', candidateItemId: 'ci-1', versionItemIds: items })
    expect(r).toMatchObject({ ok: false, code: 'unexpected_item' })
  })
})
