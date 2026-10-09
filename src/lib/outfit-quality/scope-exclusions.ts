// What has already been composed for a batch's (stylist, member|profile)
// scope — across EVERY batch, decided or not — so GENERATE NEXT CHUNK never
// re-serves a look Chloe has already seen. Signatures are the sorted item ids
// of a version; anchors are the lead garment each look was built around.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import type { GenerationExclusions } from '@/lib/outfit-quality/candidate-generation'

type Admin = ReturnType<typeof createAdminClient>

export function emptyExclusions(): GenerationExclusions {
  return { signatures: new Set(), anchorItemIds: new Set(), itemUses: new Map() }
}

/** Per-item appearance counts, read straight off the scope's signatures. */
export function itemUsesFromSignatures(signatures: Set<string> | readonly string[]): Map<string, number> {
  const uses = new Map<string, number>()
  for (const sig of Array.from(signatures)) {
    for (const id of sig.split('|')) {
      if (!id) continue
      uses.set(id, (uses.get(id) ?? 0) + 1)
    }
  }
  return uses
}

/**
 * Load everything already cased for this scope through one RPC (no `.in()`
 * id list, so it never hits URL limits). A missing RPC (migration 0091 not
 * yet applied) degrades to "exclude nothing" and is reported in the result so
 * the batch can surface it.
 */
export async function loadScopeExclusions(
  admin: Admin,
  batch: { selected_stylist_id: string; real_member_id: string | null; evaluation_profile_id: string | null },
): Promise<{ exclusions: GenerationExclusions; warning: string | null }> {
  const db = admin as any
  const { data, error } = await db.rpc('oq_scope_signatures', {
    p_stylist_id: batch.selected_stylist_id,
    p_real_member_id: batch.real_member_id,
    p_evaluation_profile_id: batch.evaluation_profile_id,
  })
  if (error) return { exclusions: emptyExclusions(), warning: `scope exclusions unavailable: ${error.message}` }
  const out = emptyExclusions()
  for (const r of (data ?? []) as { items_signature: string | null; anchor_item_id: string | null }[]) {
    if (r.items_signature) out.signatures.add(r.items_signature)
    if (r.anchor_item_id) out.anchorItemIds.add(r.anchor_item_id)
  }
  out.itemUses = itemUsesFromSignatures(out.signatures)
  return { exclusions: out, warning: null }
}
