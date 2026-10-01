// The shared structured-reason taxonomy for human `No` decisions.
//
// This module is the single source of truth for the review form, the server
// validator, and the downstream learning-projection mapping. A `No` requires
// exactly one of these codes; free text is optional supporting context and can
// never replace the code. Item-specific variants additionally require exactly
// one affected candidate item belonging to the exact reviewed version.

export interface ReviewReason {
  code: string
  label: string
  /** Item-specific variants retain the affected candidate_item_id. */
  itemSpecific: boolean
  /** The base category used by the learning scope mapping. */
  category: 'global_composition' | 'wrong_for_stylist' | 'wrong_for_member' | 'operational_data'
}

export const REVIEW_REASONS: readonly ReviewReason[] = [
  { code: 'global_composition', label: "THE OUTFIT DOESN'T WORK", itemSpecific: false, category: 'global_composition' },
  { code: 'wrong_for_stylist', label: 'WRONG FOR THIS STYLIST', itemSpecific: false, category: 'wrong_for_stylist' },
  { code: 'wrong_for_member', label: 'WRONG FOR THIS CONTEXT', itemSpecific: false, category: 'wrong_for_member' },
  { code: 'operational_data', label: 'BAD DATA / STOCK / IMAGE', itemSpecific: false, category: 'operational_data' },
  { code: 'item_global_composition', label: 'THIS ITEM BREAKS THE OUTFIT', itemSpecific: true, category: 'global_composition' },
  { code: 'item_wrong_for_stylist', label: 'THIS ITEM IS WRONG FOR THE STYLIST', itemSpecific: true, category: 'wrong_for_stylist' },
  { code: 'item_wrong_for_member', label: 'THIS ITEM IS WRONG FOR THIS CONTEXT', itemSpecific: true, category: 'wrong_for_member' },
  { code: 'item_operational_data', label: 'THIS ITEM HAS BAD DATA', itemSpecific: true, category: 'operational_data' },
] as const

export const REVIEW_REASON_CODES: readonly string[] = REVIEW_REASONS.map((r) => r.code)

const BY_CODE = new Map(REVIEW_REASONS.map((r) => [r.code, r]))

export function isReviewReasonCode(code: unknown): code is string {
  return typeof code === 'string' && BY_CODE.has(code)
}

export function reviewReason(code: string): ReviewReason | null {
  return BY_CODE.get(code) ?? null
}

export function reasonRequiresItem(code: string): boolean {
  return BY_CODE.get(code)?.itemSpecific ?? false
}

/** The base category a reason routes to for learning scope decisions. */
export function reasonCategory(code: string): ReviewReason['category'] | null {
  return BY_CODE.get(code)?.category ?? null
}

export type NoReasonValidation =
  | { ok: true }
  | { ok: false; code: 'missing_reason' | 'unknown_reason' | 'missing_item' | 'foreign_item' | 'unexpected_item'; message: string }

/**
 * Validate the structured payload of a `No` decision against the exact item
 * manifest of the version being reviewed. `versionItemIds` must be the
 * candidate_item_id values of that version — an item from any other version
 * (a parent, a child, another candidate) is foreign.
 */
export function validateNoReason(args: {
  reasonCode: string | null | undefined
  candidateItemId: string | null | undefined
  versionItemIds: string[]
}): NoReasonValidation {
  const { reasonCode, candidateItemId, versionItemIds } = args
  if (!reasonCode) {
    return { ok: false, code: 'missing_reason', message: 'a No decision requires one structured reason' }
  }
  if (!isReviewReasonCode(reasonCode)) {
    return { ok: false, code: 'unknown_reason', message: `unknown reason code: ${reasonCode}` }
  }
  const reason = BY_CODE.get(reasonCode) as ReviewReason
  if (reason.itemSpecific) {
    if (!candidateItemId) {
      return { ok: false, code: 'missing_item', message: 'an item-specific reason requires the affected item' }
    }
    if (!versionItemIds.includes(candidateItemId)) {
      return { ok: false, code: 'foreign_item', message: 'the affected item does not belong to this candidate version' }
    }
  } else if (candidateItemId) {
    return { ok: false, code: 'unexpected_item', message: 'a global reason cannot name an affected item' }
  }
  return { ok: true }
}
