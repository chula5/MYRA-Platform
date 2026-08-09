'use server'

// The self-critiquing pipeline queue: batch-compose outfits, gate them by
// confidence, and split them into a FAST lane (one-tap batch approval, image
// pre-rendered) and a STANDARD lane (full review with the reasons they scored
// low). Nothing here reaches the front end — approvals land as draft outfits
// in the Composer drafts project exactly like a manual YES.

import { createAdminClient } from '@/lib/supabase-server'
import { getItem, type ItemWithBrand } from '@/lib/admin-queries'
import { revalidatePath } from 'next/cache'
import { getReviewQueue } from '@/app/admin/outfit-review/actions'
import { approveCandidate } from '@/app/admin/composer/actions'
import { recordStyleDecision } from '@/lib/style-brain-store'
import {
  loadPipelineQueue,
  loadPipelineConfig,
  stageComposedOutfit,
  markComposedOutfit,
  applyFastLaneEvent,
  ensureItemsScored,
  vectorForCandidate,
  backfillEjectionsFromHistory,
  type StagedOutfit,
  type PipelineConfig,
} from '@/lib/pipeline-store'
import { deriveSlotScores, deriveOutfitLevelScores, slotForItemType, type Slot } from '@/lib/composer'
import { composeStylingSet, refreshSetStatus, regenerateSetVariants } from './set-actions'
import { resolveStylistId, loadAutonomy, foldAutonomyReview } from '@/lib/stylist-store'
import { generateHiggsfieldShootForOutfit } from '@/app/admin/projects/higgsfield-actions'

function toFeature(it: ItemWithBrand) {
  return {
    item_type: it.item_type,
    colour_family: (it as any).colour_family ?? null,
    pattern: (it as any).pattern ?? null,
    material_formality: (it as any).material_formality ?? null,
    brand_name: it.brand?.name ?? null,
    price_tier: (it.brand as any)?.price_tier ?? null,
  }
}

// ── Batch compose ────────────────────────────────────────────────────────────

export async function runPipelineBatch(maxAnchors = 4, stylistId?: string | null): Promise<{
  staged: number
  sets: number
  fast: number
  autoPublished: number
  visionScored: number
  error?: string
}> {
  try {
    const sid = await resolveStylistId(stylistId)
    const { anchors } = await getReviewQueue(60, true, 'needs-more', null)
    const pending = await loadPipelineQueue()
    const alreadyStaged = new Set(pending.map((p) => p.anchor_item_id))
    const todo = anchors.filter((a) => !alreadyStaged.has(a.item_id)).slice(0, maxAnchors)
    const autonomy = sid ? await loadAutonomy(sid) : null

    let staged = 0
    let sets = 0
    let fast = 0
    let autoPublished = 0
    let visionScored = 0
    for (const a of todo) {
      // SCORE AT COMPOSITION TIME: vision-score the hero before composing.
      const anchorItem = await getItem(a.item_id)
      if (!anchorItem) continue
      const scoredRes = await ensureItemsScored([anchorItem])
      visionScored += scoredRes.scored.length

      // THE UNIT OF WORK IS A STYLING SET: 3-4 distinct variants per hero.
      const setRes = await composeStylingSet(a.item_id, { stylistId: sid })
      if (!setRes.staged) continue
      sets++
      staged += setRes.staged

      // Fast-lane variants: pre-render (Stage 1) or auto-publish (Stage 2/3).
      const stagedRows = (await loadPipelineQueue()).filter((p) => p.styling_set_id === setRes.stylingSetId)
      for (const row of stagedRows) {
        if (row.lane !== 'fast') continue
        fast++
        if (autonomy && autonomy.stage >= 2) {
          // STAGE 2+: skip the review queue — straight through render +
          // fidelity to published. The fidelity check is never bypassed.
          const ok = await autoPublishStaged(row, autonomy.stage)
          if (ok) autoPublished++
        } else {
          // STAGE 1: pre-create the draft (no decision recorded) so the
          // Higgsfield image renders ahead of review — approval = one tap.
          const created = await approveCandidate(
            row.anchor_item_id,
            row.item_ids,
            row.slots as Slot[],
            {
              autoShoot: true, source: 'review', score: row.base_score ?? undefined, recordDecision: false,
              stylingSetId: row.styling_set_id, stylistId: sid, variantDirection: row.variant_direction,
            },
          )
          if (created.outfitId) {
            await markComposedOutfit(row.id, { outfit_id: created.outfitId, prerender_status: 'queued' })
          }
        }
      }
    }
    revalidatePath('/admin/pipeline')
    return { staged, sets, fast, autoPublished, visionScored }
  } catch (err) {
    console.error('[runPipelineBatch]', err)
    return { staged: 0, sets: 0, fast: 0, autoPublished: 0, visionScored: 0, error: err instanceof Error ? err.message : 'Batch failed' }
  }
}

// STAGE 2/3 auto-publish: create the outfit, AWAIT the render + fidelity check,
// and only publish when the render passed. A fidelity failure leaves the
// variant in the review queue instead — never a bypass.
export async function autoPublishStaged(row: StagedOutfit, stage: number): Promise<boolean> {
  try {
    const created = await approveCandidate(
      row.anchor_item_id,
      row.item_ids,
      row.slots as Slot[],
      {
        autoShoot: false, source: 'review', score: row.base_score ?? undefined, recordDecision: false,
        stylingSetId: row.styling_set_id, stylistId: row.stylist_id, variantDirection: row.variant_direction,
      },
    )
    if (!created.outfitId) return false
    await markComposedOutfit(row.id, { outfit_id: created.outfitId })

    // Render + fidelity, awaited. On failure the outfit stays draft and the
    // staged row stays pending — it falls back into the review queue.
    const shot = await generateHiggsfieldShootForOutfit(created.outfitId, 'F6')
    if (!shot.imageUrl) {
      console.error('[autoPublishStaged] render/fidelity failed — variant left for review:', shot.error)
      return false
    }

    const admin = createAdminClient()
    await (admin.from('outfit') as any)
      .update({ status: 'live', published_at: new Date().toISOString() })
      .eq('outfit_id', created.outfitId)
    await (admin.from('auto_publish_log') as any).insert({
      stylist_id: row.stylist_id,
      outfit_id: created.outfitId,
      styling_set_id: row.styling_set_id,
      stage,
    })
    await markComposedOutfit(row.id, { status: 'approved', outfit_id: created.outfitId })
    if (row.styling_set_id) await refreshSetStatus(row.styling_set_id)
    return true
  } catch (err) {
    console.error('[autoPublishStaged]', err)
    return false
  }
}

// Fold one reviewed variant into the stylist's autonomy state (streak,
// trailing swap rate, promotions/demotions). Fire-and-forget safe.
async function recordAutonomyReview(
  stylistId: string | null,
  entry: { lane: 'fast' | 'standard'; swapped: boolean; approved: boolean },
): Promise<void> {
  await foldAutonomyReview(stylistId, entry)
}

// ── Queue loading (hydrated for display) ─────────────────────────────────────

export interface PipelineCard extends StagedOutfit {
  anchor: { product_name: string; brand_name: string | null; image_url: string; item_type: string } | null
  items: { item_id: string; product_name: string; brand_name: string | null; image_url: string; slot: string }[]
  outfit_image: string | null
  project_id: string | null
}

export async function loadPipelineCards(): Promise<{ fast: PipelineCard[]; standard: PipelineCard[]; config: PipelineConfig }> {
  const [queue, config] = await Promise.all([loadPipelineQueue(), loadPipelineConfig()])
  const admin = createAdminClient()
  const itemIds = new Set<string>()
  for (const q of queue) {
    itemIds.add(q.anchor_item_id)
    q.item_ids.forEach((id) => itemIds.add(id))
  }
  const { data: items } = itemIds.size
    ? await admin.from('item' as any).select('item_id, product_name, image_url, item_type, brand:brand_id(name)').in('item_id', [...Array.from(itemIds)])
    : { data: [] }
  const byId = new Map(((items ?? []) as any[]).map((it) => [it.item_id, it]))

  const outfitIds = queue.map((q) => q.outfit_id).filter((x): x is string => !!x)
  const { data: outfits } = outfitIds.length
    ? await admin.from('outfit' as any).select('outfit_id, image_url, additional_images, project_id').in('outfit_id', outfitIds)
    : { data: [] }
  const outfitById = new Map(((outfits ?? []) as any[]).map((o) => [o.outfit_id, o]))

  const cards: PipelineCard[] = queue.map((q) => {
    const anchor = byId.get(q.anchor_item_id)
    const o = q.outfit_id ? outfitById.get(q.outfit_id) : null
    const extra = Array.isArray(o?.additional_images) ? o.additional_images : []
    return {
      ...q,
      anchor: anchor
        ? { product_name: anchor.product_name, brand_name: anchor.brand?.name ?? null, image_url: anchor.image_url, item_type: String(anchor.item_type) }
        : null,
      items: q.item_ids.map((id, i) => {
        const it = byId.get(id)
        return {
          item_id: id,
          product_name: it?.product_name ?? '—',
          brand_name: it?.brand?.name ?? null,
          image_url: it?.image_url ?? '',
          slot: q.slots[i] ?? 'accessory',
        }
      }),
      // Pre-rendered Higgsfield image if it has landed, else the outfit/anchor image.
      outfit_image: extra[extra.length - 1] ?? o?.image_url ?? null,
      project_id: o?.project_id ?? null,
    }
  })

  return {
    fast: cards.filter((c) => c.lane === 'fast'),
    standard: cards.filter((c) => c.lane === 'standard'),
    config,
  }
}

// ── Decisions ────────────────────────────────────────────────────────────────

async function recordDecisionForStaged(staged: StagedOutfit, decision: 'approve' | 'skip'): Promise<void> {
  const anchor = await getItem(staged.anchor_item_id)
  const items = (await Promise.all(staged.item_ids.map((id) => getItem(id)))).filter(Boolean) as ItemWithBrand[]
  const all = [anchor, ...items].filter(Boolean) as ItemWithBrand[]
  if (all.length < 2) return
  await recordStyleDecision({
    items: all.map(toFeature),
    decision,
    source: 'review',
    anchorItemId: staged.anchor_item_id,
    itemIds: all.map((i) => i.item_id),
    baseScore: staged.base_score,
    stylistId: staged.stylist_id,
  })
}

async function getStaged(id: string): Promise<StagedOutfit | null> {
  const admin = createAdminClient()
  const { data } = await admin.from('composed_outfit' as any).select('*').eq('id', id).maybeSingle()
  if (!data) return null
  const r = data as any
  return { ...r, reasons: Array.isArray(r.reasons) ? r.reasons : [], occasion_scores: r.occasion_scores ?? {} }
}

// One-tap fast-lane approve: outfit already exists (pre-rendered) — just log
// the decision, feed the adaptive threshold + autonomy tracker, and mark the row.
export async function fastLaneApprove(id: string): Promise<{ ok?: true; error?: string }> {
  const staged = await getStaged(id)
  if (!staged) return { error: 'Not found' }
  let outfitId = staged.outfit_id
  if (!outfitId) {
    const created = await approveCandidate(
      staged.anchor_item_id, staged.item_ids, staged.slots as Slot[],
      {
        autoShoot: true, source: 'review', score: staged.base_score ?? undefined, recordDecision: false,
        stylingSetId: staged.styling_set_id, stylistId: staged.stylist_id, variantDirection: staged.variant_direction,
      },
    )
    if (created.error || !created.outfitId) return { error: created.error ?? 'Could not create outfit' }
    outfitId = created.outfitId
  }
  await recordDecisionForStaged(staged, 'approve')
  await applyFastLaneEvent('clean_approve')
  void recordAutonomyReview(staged.stylist_id, { lane: 'fast', swapped: false, approved: true })
  await markComposedOutfit(id, { status: 'approved', outfit_id: outfitId })
  if (staged.styling_set_id) await refreshSetStatus(staged.styling_set_id)
  revalidatePath('/admin/pipeline')
  return { ok: true }
}

// Fast-lane override: she needed to edit something the gate called safe. Count
// the override (tightens the threshold) and demote to the standard lane.
export async function fastLaneOverride(id: string): Promise<{ ok?: true; error?: string }> {
  const staged = await getStaged(id)
  if (!staged) return { error: 'Not found' }
  await applyFastLaneEvent('override')
  void recordAutonomyReview(staged.stylist_id, { lane: 'fast', swapped: true, approved: true })
  const admin = createAdminClient()
  await (admin.from('composed_outfit') as any)
    .update({
      lane: 'standard',
      overridden: true,
      reasons: [...staged.reasons, 'fast-lane override — you flagged this for edits'],
    })
    .eq('id', id)
  revalidatePath('/admin/pipeline')
  return { ok: true }
}

export async function pipelineReject(id: string): Promise<{ ok?: true; underStyled?: boolean; error?: string }> {
  const staged = await getStaged(id)
  if (!staged) return { error: 'Not found' }
  await recordDecisionForStaged(staged, 'skip')
  if (staged.lane === 'fast') await applyFastLaneEvent('override')
  void recordAutonomyReview(staged.stylist_id, { lane: staged.lane, swapped: false, approved: false })
  // A pre-created draft outfit is retired, never published.
  if (staged.outfit_id) {
    const admin = createAdminClient()
    await (admin.from('outfit') as any).update({ status: 'archived' }).eq('outfit_id', staged.outfit_id)
  }
  await markComposedOutfit(id, { status: 'rejected' })
  // Under-styled check: if rejections drop the set below 2 approved variants,
  // the composer generates replacements (respecting the rejection signals) and
  // returns them to the queue.
  let underStyled = false
  if (staged.styling_set_id) {
    const { status } = await refreshSetStatus(staged.styling_set_id)
    if (status === 'under_styled') {
      underStyled = true
      void regenerateSetVariants(staged.styling_set_id)
    }
  }
  revalidatePath('/admin/pipeline')
  return { ok: true, underStyled }
}

// Standard-lane approve — creates the draft outfit (with decision) if the fast
// lane hadn't already pre-created it.
export async function standardApprove(id: string): Promise<{ ok?: true; outfitId?: string; error?: string }> {
  const staged = await getStaged(id)
  if (!staged) return { error: 'Not found' }
  void recordAutonomyReview(staged.stylist_id, { lane: 'standard', swapped: false, approved: true })
  if (staged.outfit_id) {
    await recordDecisionForStaged(staged, 'approve')
    await markComposedOutfit(id, { status: 'approved' })
    if (staged.styling_set_id) await refreshSetStatus(staged.styling_set_id)
    revalidatePath('/admin/pipeline')
    return { ok: true, outfitId: staged.outfit_id }
  }
  const created = await approveCandidate(
    staged.anchor_item_id, staged.item_ids, staged.slots as Slot[],
    {
      autoShoot: true, source: 'review', score: staged.base_score ?? undefined,
      stylingSetId: staged.styling_set_id, stylistId: staged.stylist_id, variantDirection: staged.variant_direction,
    },
  )
  if (created.error || !created.outfitId) return { error: created.error ?? 'Approve failed' }
  await markComposedOutfit(id, { status: 'approved', outfit_id: created.outfitId })
  if (staged.styling_set_id) await refreshSetStatus(staged.styling_set_id)
  revalidatePath('/admin/pipeline')
  return { ok: true, outfitId: created.outfitId }
}

// One-off backfill of the ejection table from historical swap decisions.
export async function runEjectionBackfill(): Promise<{ inserted: number; error?: string }> {
  const res = await backfillEjectionsFromHistory()
  revalidatePath('/admin/pipeline')
  return res
}
