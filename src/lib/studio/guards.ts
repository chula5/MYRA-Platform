// Style guards — the ejection rules and skip-combination filters, derived from
// the Style Brain (the composer pipeline's learned model). Used by the mobile
// swap sheet and the stock sentinel so neither ever offers:
//   · a QUARANTINED item — one Chloe has repeatedly swapped OUT (globally, or
//     specifically in outfits anchored on a given piece), read from the
//     style_decision swap log the composer already writes; or
//   · an item creating a SKIP-COMBINATION — a colour/type pairing whose
//     learned affinity is firmly negative (the same pairs buildHouseStyle
//     lists under "Combinations you tend to skip").

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { loadStyleModel } from '@/lib/style-brain-store'
import type { ItemWithBrand } from '@/lib/admin-queries'

// Mirror style-brain's smoothed affinity + house-style skip threshold.
const K_SMOOTH = 2
const SKIP_AFFINITY = -0.15
const SKIP_MIN_OBS = 2

// Quarantine thresholds from the swap log.
const QUARANTINE_CONTEXT_SWAPS = 2 // swapped out ≥2× under the same anchor
const QUARANTINE_GLOBAL_SWAPS = 4  // swapped out ≥4× anywhere

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ') || '∅'

export interface StyleGuards {
  /** Unordered "kind:a|b" keys with firmly negative learned affinity. */
  skipPairs: Set<string>
  /** item_id → anchor_item_ids it has been repeatedly swapped out under. */
  quarantinedByAnchor: Map<string, Set<string>>
  /** item_ids swapped out so often they're quarantined everywhere. */
  quarantinedGlobal: Set<string>
}

export async function loadStyleGuards(): Promise<StyleGuards> {
  const guards: StyleGuards = {
    skipPairs: new Set(),
    quarantinedByAnchor: new Map(),
    quarantinedGlobal: new Set(),
  }

  // 1. Skip-combinations from the learned model's pair table.
  try {
    const model = await loadStyleModel()
    for (const [key, [a, s]] of Object.entries(model.pairs)) {
      if (!/^(colour|type|brand):/.test(key)) continue
      if (a + s < SKIP_MIN_OBS) continue
      const affinity = (a - s) / (a + s + K_SMOOTH)
      if (affinity < SKIP_AFFINITY) guards.skipPairs.add(key)
    }
  } catch { /* cold start — no guards */ }

  // 2. Quarantine from the swap decision log (source='swap' rows record the
  //    anchor and the piece swapped out as item_ids[1]).
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('style_decision' as any)
      .select('anchor_item_id, item_ids, features')
      .eq('source', 'swap')
      .order('created_at', { ascending: false })
      .limit(5000)
    const counts = new Map<string, number>()
    for (const row of (data ?? []) as any[]) {
      const swappedOut: string | undefined = row.item_ids?.[1]
      if (!swappedOut) continue
      counts.set(swappedOut, (counts.get(swappedOut) ?? 0) + 1)
      const anchor: string | null = row.anchor_item_id
      if (anchor) {
        const key = `${anchor}|${swappedOut}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
        if ((counts.get(key) ?? 0) >= QUARANTINE_CONTEXT_SWAPS) {
          const set = guards.quarantinedByAnchor.get(swappedOut) ?? new Set()
          set.add(anchor)
          guards.quarantinedByAnchor.set(swappedOut, set)
        }
      }
    }
    for (const [key, n] of Array.from(counts.entries())) {
      if (!key.includes('|') && n >= QUARANTINE_GLOBAL_SWAPS) guards.quarantinedGlobal.add(key)
    }
  } catch { /* table absent — no quarantine */ }

  return guards
}

/** Is `candidate` quarantined for an outfit anchored on `anchorItemId`? */
export function isQuarantined(guards: StyleGuards, candidateId: string, anchorItemId: string | null): boolean {
  if (guards.quarantinedGlobal.has(candidateId)) return true
  if (!anchorItemId) return false
  return guards.quarantinedByAnchor.get(candidateId)?.has(anchorItemId) ?? false
}

/** Would adding `candidate` next to `others` create a learned skip-combination? */
export function createsSkipCombination(
  guards: StyleGuards,
  candidate: ItemWithBrand,
  others: ItemWithBrand[],
): boolean {
  if (guards.skipPairs.size === 0) return false
  const pairKey = (kind: string, a: string, b: string) => {
    const [x, y] = [a, b].sort()
    return `${kind}:${x}|${y}`
  }
  const c = candidate as any
  for (const other of others) {
    const o = other as any
    if (c.colour_family && o.colour_family &&
        guards.skipPairs.has(pairKey('colour', norm(c.colour_family), norm(o.colour_family)))) return true
    if (c.item_type && o.item_type &&
        guards.skipPairs.has(pairKey('type', norm(c.item_type), norm(o.item_type)))) return true
    const cb = c.brand?.name, ob = o.brand?.name
    if (cb && ob && norm(cb) !== norm(ob) &&
        guards.skipPairs.has(pairKey('brand', norm(cb), norm(ob)))) return true
  }
  return false
}
