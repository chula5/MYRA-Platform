// Canonical composition hash for an immutable candidate version.
//
// A candidate version's identity is derived from the exact lens and inputs that
// produced it: the frozen stylist snapshot hash, the frozen context, the
// relevant system versions, and the ordered (slot, item_id, source-image
// version/hash) tuples. Changing any item, slot, source reference, context, or
// system version produces a different hash — which is exactly what forces a new
// child version rather than a silent mutation of the parent.

import { canonicalize, sha256Hex } from '@/lib/outfit-quality/stylist-snapshot'

export interface CompositionItemRef {
  slot: string
  item_id: string
  /**
   * The item's position in the ordered manifest. Part of the version's
   * identity: a deliberate reorder of a multi-item slot (or a re-sequenced
   * outfit) is a DIFFERENT composition and must hash differently, so an edit
   * produces a fresh child version instead of colliding with its parent.
   */
  sort_order: number
  /** Source-image version or hash, whichever is available; null when neither is. */
  source_image_version?: string | null
  source_image_hash?: string | null
}

export interface CompositionHashInput {
  /** The frozen stylist snapshot's payload hash. */
  snapshotHash: string
  /** The frozen context (member/profile context snapshot used for generation). */
  context: unknown
  /** Relevant system versions frozen with the run. */
  systemVersions: unknown
  items: CompositionItemRef[]
}

/**
 * Deterministic composition hash. Tuples carry their `sort_order`, so a
 * deliberate reorder is a new composition. Tuples are then sorted by
 * (slot, sort_order, item_id) so the hash depends only on the ordered tuple
 * set itself — never on the order the caller happened to list them in — while
 * any change to membership, slot, sequence, or source reference flips it.
 */
export function compositionHash(input: CompositionHashInput): string {
  const items = [...input.items]
    .map((i) => ({
      slot: i.slot,
      item_id: i.item_id,
      sort_order: i.sort_order,
      source_image_version: i.source_image_version ?? null,
      source_image_hash: i.source_image_hash ?? null,
    }))
    .sort((a, b) =>
      a.slot === b.slot
        ? a.sort_order === b.sort_order
          ? a.item_id.localeCompare(b.item_id)
          : a.sort_order - b.sort_order
        : a.slot.localeCompare(b.slot),
    )

  return sha256Hex(
    canonicalize({
      snapshot_hash: input.snapshotHash,
      context: input.context,
      system_versions: input.systemVersions,
      items,
    }),
  )
}
