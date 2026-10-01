// Required objective checks for a Quality Lab candidate — fail-closed.
//
// Objective checks run first, before any subjective check, and before a
// candidate can enter the normal human-review queue. They are deterministic
// structural and operational gates:
//
//   * valid outfit structure and required slots
//   * no duplicate item membership and valid slot cardinality
//   * required source images and usable source references
//   * real-member / evaluation-profile size possibility
//   * current sellable stock
//   * required item data
//
// Every check is append-only evidence. The whole point is that a FAILED,
// UNAVAILABLE, ERRORED, missing, or unparseable required check is NOT a pass:
// the candidate moves to `objective_failed`, the subjective checker is never
// invoked, and it never enters the normal queue — but it stays fully auditable.
// A score is never manufactured and an exception is never read as success.

export type CheckStatus = 'passed' | 'failed' | 'unavailable' | 'error'

export interface RuleOutcome {
  check_name: string
  status: CheckStatus
  detail?: unknown
}

/** The single-item slots. Jewellery and accessory are the only multi-item slots. */
export const MULTI_ITEM_SLOTS = new Set(['jewellery', 'accessory'])

export interface ObjectiveItem {
  item_id: string
  slot: string
  source_image_url?: string | null
  source_image_asset_version?: string | null
  source_image_hash?: string | null
  item_snapshot?: Record<string, unknown> | null
}

export interface ObjectiveManifest {
  /** The slots a complete outfit must include, derived from the anchor. */
  requiredSlots: string[]
  items: ObjectiveItem[]
}

/**
 * Evidence for the operational rules, supplied by injected adapters. Each entry
 * is keyed by item_id. A `null`/missing entry is treated as unavailable (fail
 * closed), never as a pass.
 */
export interface ObjectiveEvidence {
  /** 'in_size' passes; 'not_in_size' fails; 'unconfirmed'/missing is unavailable. */
  size?: Record<string, 'in_size' | 'not_in_size' | 'unconfirmed'> | { error: true } | null
  /** true sellable; false not sellable; 'unknown'/missing is unavailable. */
  stock?: Record<string, boolean | 'unknown'> | { error: true } | null
}

/** The fields an item must carry to be usable at all. */
export const REQUIRED_ITEM_FIELDS = ['item_type', 'brand'] as const

function worst(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes('error')) return 'error'
  if (statuses.includes('unavailable')) return 'unavailable'
  if (statuses.includes('failed')) return 'failed'
  return 'passed'
}

// ── Individual rules ───────────────────────────────────────────────────────────

export function checkStructure(manifest: ObjectiveManifest): RuleOutcome {
  const present = new Set(manifest.items.map((i) => i.slot))
  if (manifest.items.length === 0) {
    return { check_name: 'valid_structure', status: 'failed', detail: { reason: 'empty_outfit' } }
  }
  const missing = manifest.requiredSlots.filter((s) => !present.has(s))
  if (missing.length > 0) {
    return { check_name: 'valid_structure', status: 'failed', detail: { missing_slots: missing } }
  }
  return { check_name: 'valid_structure', status: 'passed' }
}

export function checkMembership(manifest: ObjectiveManifest): RuleOutcome {
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const it of manifest.items) {
    if (seen.has(it.item_id)) dupes.push(it.item_id)
    seen.add(it.item_id)
  }
  if (dupes.length > 0) {
    return { check_name: 'no_duplicate_membership', status: 'failed', detail: { duplicate_item_ids: dupes } }
  }
  // Slot cardinality: single-item slots carry exactly one item.
  const perSlot = new Map<string, number>()
  for (const it of manifest.items) perSlot.set(it.slot, (perSlot.get(it.slot) ?? 0) + 1)
  const overfull = Array.from(perSlot.entries()).filter(([slot, n]) => n > 1 && !MULTI_ITEM_SLOTS.has(slot))
  if (overfull.length > 0) {
    return { check_name: 'no_duplicate_membership', status: 'failed', detail: { overfull_slots: overfull.map(([s]) => s) } }
  }
  return { check_name: 'no_duplicate_membership', status: 'passed' }
}

export function checkSourceImages(manifest: ObjectiveManifest): RuleOutcome {
  const missing = manifest.items.filter((i) => !i.source_image_url || i.source_image_url.trim() === '')
  if (missing.length > 0) {
    return { check_name: 'source_images', status: 'failed', detail: { missing_image_item_ids: missing.map((i) => i.item_id) } }
  }
  return { check_name: 'source_images', status: 'passed' }
}

export function checkRequiredItemData(manifest: ObjectiveManifest): RuleOutcome {
  const bad: { item_id: string; missing: string[] }[] = []
  for (const it of manifest.items) {
    const snap = it.item_snapshot ?? {}
    const missing = REQUIRED_ITEM_FIELDS.filter((f) => {
      const v = (snap as Record<string, unknown>)[f]
      return v === undefined || v === null || v === ''
    })
    if (missing.length > 0) bad.push({ item_id: it.item_id, missing: [...missing] })
  }
  if (bad.length > 0) {
    return { check_name: 'required_item_data', status: 'failed', detail: { items: bad } }
  }
  return { check_name: 'required_item_data', status: 'passed' }
}

export function checkSize(manifest: ObjectiveManifest, evidence: ObjectiveEvidence): RuleOutcome {
  const size = evidence.size
  if (!size || (size as { error?: true }).error) {
    return { check_name: 'size_possibility', status: size && (size as { error?: true }).error ? 'error' : 'unavailable', detail: { reason: 'no_size_evidence' } }
  }
  const map = size as Record<string, 'in_size' | 'not_in_size' | 'unconfirmed'>
  const notInSize: string[] = []
  const unconfirmed: string[] = []
  for (const it of manifest.items) {
    const v = map[it.item_id]
    if (v === 'not_in_size') notInSize.push(it.item_id)
    else if (v === undefined || v === 'unconfirmed') unconfirmed.push(it.item_id)
  }
  if (notInSize.length > 0) return { check_name: 'size_possibility', status: 'failed', detail: { not_in_size: notInSize } }
  if (unconfirmed.length > 0) return { check_name: 'size_possibility', status: 'unavailable', detail: { unconfirmed } }
  return { check_name: 'size_possibility', status: 'passed' }
}

export function checkStock(manifest: ObjectiveManifest, evidence: ObjectiveEvidence): RuleOutcome {
  const stock = evidence.stock
  if (!stock || (stock as { error?: true }).error) {
    return { check_name: 'sellable_stock', status: stock && (stock as { error?: true }).error ? 'error' : 'unavailable', detail: { reason: 'no_stock_evidence' } }
  }
  const map = stock as Record<string, boolean | 'unknown'>
  const notSellable: string[] = []
  const unknown: string[] = []
  for (const it of manifest.items) {
    const v = map[it.item_id]
    if (v === false) notSellable.push(it.item_id)
    else if (v === undefined || v === 'unknown') unknown.push(it.item_id)
  }
  if (notSellable.length > 0) return { check_name: 'sellable_stock', status: 'failed', detail: { not_sellable: notSellable } }
  if (unknown.length > 0) return { check_name: 'sellable_stock', status: 'unavailable', detail: { unknown } }
  return { check_name: 'sellable_stock', status: 'passed' }
}

// ── Aggregate ──────────────────────────────────────────────────────────────────

export interface ObjectiveResult {
  status: CheckStatus
  passed: boolean
  outcomes: RuleOutcome[]
}

/**
 * Run every required objective rule and aggregate fail-closed. The overall
 * result is `passed` only when every rule passed; otherwise the worst status
 * (error > unavailable > failed) is reported. A non-pass means no subjective
 * check and no normal-queue entry, but all per-rule outcomes are retained.
 */
export function runObjectiveChecks(manifest: ObjectiveManifest, evidence: ObjectiveEvidence): ObjectiveResult {
  const outcomes: RuleOutcome[] = [
    checkStructure(manifest),
    checkMembership(manifest),
    checkSourceImages(manifest),
    checkRequiredItemData(manifest),
    checkSize(manifest, evidence),
    checkStock(manifest, evidence),
  ]
  const status = worst(outcomes.map((o) => o.status))
  return { status, passed: status === 'passed', outcomes }
}
