// Canonical promotion of an approved Quality Lab candidate version.
//
// One approved version becomes exactly ONE outfit in the existing
// `outfit` / `outfit_item` graph:
//   · status 'draft' and published_at NULL — internal/non-live, always;
//   · the selected stylist on the outfit row;
//   · Quality Lab provenance in admin_notes (the candidate version id);
//   · exactly one ordered outfit_item membership per frozen candidate item —
//     never one outfit per item;
//   · one outfit_quality_promotion mapping whose unique constraints
//     (candidate_version_id, outfit_id) make every retry return the same row.
//
// Promotion never publishes, never notifies, and never touches customer
// surfaces. A fidelity-passed render may later ATTACH its durable image to
// the outfit; the outfit remains internal until a separate future publish
// flow (out of scope for the Quality Lab).

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { boundError } from '@/lib/outfit-quality/render-domain'

type Db = ReturnType<typeof createAdminClient>

export type PromotionResult =
  | { ok: true; reused: boolean; promotionId: string; outfitId: string }
  | { ok: false; code: string; message: string }

function failure(code: string, message: string): { ok: false; code: string; message: string } {
  return { ok: false, code, message }
}

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === '23505' || /duplicate key/i.test(err.message ?? ''))
}

async function existingPromotion(db: any, candidateVersionId: string): Promise<any | null> {
  const { data } = await db
    .from('outfit_quality_promotion')
    .select('*')
    .eq('candidate_version_id', candidateVersionId)
    .maybeSingle()
  return data ?? null
}

export async function promoteApprovedVersion(
  admin: Db,
  candidateVersionId: string,
): Promise<PromotionResult> {
  const db = admin as any

  // Idempotent replay / lost-race convergence: one promotion per version ever.
  const existing = await existingPromotion(db, candidateVersionId)
  if (existing) {
    if (existing.status === 'withdrawn') {
      // Re-approval after an undo/withdrawal reactivates the SAME outfit.
      await db
        .from('outfit_quality_promotion')
        .update({ status: 'active', withdrawn_at: null })
        .eq('promotion_id', existing.promotion_id)
    }
    return { ok: true, reused: true, promotionId: existing.promotion_id, outfitId: existing.outfit_id }
  }

  const [{ data: version, error: vErr }, { data: items, error: iErr }] = await Promise.all([
    db.from('outfit_quality_candidate_version').select('candidate_version_id, case_id').eq('candidate_version_id', candidateVersionId).maybeSingle(),
    db
      .from('outfit_quality_candidate_item')
      .select('candidate_item_id, item_id, slot, sort_order, source_image_url')
      .eq('candidate_version_id', candidateVersionId)
      .order('sort_order', { ascending: true }),
  ])
  if (vErr) return failure('read_failed', boundError(vErr.message))
  if (iErr) return failure('read_failed', boundError(iErr.message))
  if (!version) return failure('not_found', 'candidate version not found')
  if (!items || items.length === 0) return failure('empty_manifest', 'the frozen manifest has no items')

  const { data: kase, error: cErr } = await db
    .from('outfit_quality_case')
    .select('case_id, selected_stylist_id')
    .eq('case_id', version.case_id)
    .maybeSingle()
  if (cErr) return failure('read_failed', boundError(cErr.message))
  if (!kase) return failure('not_found', 'candidate case not found')

  // The canonical outfit: internal/non-live by construction.
  const { data: outfit, error: oErr } = await db
    .from('outfit')
    .insert({
      image_url: items[0].source_image_url, // first frozen source image until a fidelity-passed render lands
      status: 'draft',
      stylist_id: kase.selected_stylist_id,
      admin_notes: `quality-lab promotion candidate_version=${candidateVersionId}`,
      occasion_tags: [],
      source_brand_ids: [],
    })
    .select('outfit_id')
    .maybeSingle()
  if (oErr || !outfit) return failure('outfit_insert_failed', boundError(oErr?.message ?? 'no row returned'))

  const { error: oiErr } = await db.from('outfit_item').insert(
    items.map((it: any) => ({
      outfit_id: outfit.outfit_id,
      item_id: it.item_id,
      slot: it.slot,
      sort_order: it.sort_order,
      size_override: false,
    })),
  )
  if (oiErr) {
    // Best-effort compensation so a failed promotion never leaves a half graph.
    await db.from('outfit_item').delete().eq('outfit_id', outfit.outfit_id)
    await db.from('outfit').delete().eq('outfit_id', outfit.outfit_id)
    return failure('membership_insert_failed', boundError(oiErr.message))
  }

  const { data: promotion, error: pErr } = await db
    .from('outfit_quality_promotion')
    .insert({ candidate_version_id: candidateVersionId, outfit_id: outfit.outfit_id, status: 'active' })
    .select('promotion_id, outfit_id')
    .maybeSingle()
  if (pErr || !promotion) {
    if (isUniqueViolation(pErr)) {
      // A concurrent promoter won. Remove OUR orphan graph and return theirs.
      await db.from('outfit_item').delete().eq('outfit_id', outfit.outfit_id)
      await db.from('outfit').delete().eq('outfit_id', outfit.outfit_id)
      const winner = await existingPromotion(db, candidateVersionId)
      if (winner) return { ok: true, reused: true, promotionId: winner.promotion_id, outfitId: winner.outfit_id }
    }
    return failure('promotion_insert_failed', boundError(pErr?.message ?? 'no row returned'))
  }

  return { ok: true, reused: false, promotionId: promotion.promotion_id, outfitId: promotion.outfit_id }
}

/**
 * Append-only-preserving withdrawal: the promotion row is marked withdrawn,
 * never deleted. The outfit and its memberships remain for audit.
 */
export async function markPromotionWithdrawn(admin: Db, candidateVersionId: string): Promise<void> {
  const db = admin as any
  await db
    .from('outfit_quality_promotion')
    .update({ status: 'withdrawn', withdrawn_at: new Date().toISOString() })
    .eq('candidate_version_id', candidateVersionId)
    .eq('status', 'active')
}

/**
 * Attach a fidelity-passed durable render image to the promoted outfit. Never
 * changes status or published_at — the outfit stays internal/non-live.
 */
export async function attachPromotedImage(admin: Db, candidateVersionId: string, imageUrl: string): Promise<void> {
  const db = admin as any
  const promotion = await existingPromotion(db, candidateVersionId)
  if (!promotion) return
  await db.from('outfit').update({ image_url: imageUrl }).eq('outfit_id', promotion.outfit_id)
}
