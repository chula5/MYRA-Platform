// Pure helpers for the scope-level dedupe key on a candidate version
// (migration 0091). Kept free of 'server-only' so composers and tests can use
// them directly.

import type { GeneratedItem } from '@/lib/outfit-quality/candidate-generation'

/** Sorted item ids joined with '|' — the scope-level dedupe key. */
export function itemsSignature(itemIds: readonly string[]): string {
  return [...itemIds].sort().join('|')
}

/** The lead garment of a manifest: a dress, else a top, else a bottom. */
export function anchorOf(items: readonly Pick<GeneratedItem, 'item_id' | 'slot' | 'sort_order'>[]): string | null {
  const bySlot = (slot: string) =>
    items
      .filter((i) => i.slot === slot)
      .sort((a, b) => a.sort_order - b.sort_order)[0]?.item_id ?? null
  return bySlot('dress') ?? bySlot('top') ?? bySlot('bottom')
}
