'use server'

// Mobile review queue actions. Admin-only (same gate as /admin).
//
// CORE RENDERING RULE enforced here:
//   · approve  → status approved_rendering + render job (priority 1). The
//     outfit publishes only when its render lands (render-queue.ts).
//   · reject   → NO render, ever. -2 taste signal into the Style Brain.
//   · swap on an UNAPPROVED outfit → no render; if approved afterwards the
//     single render fires with the post-swap item set.
//   · swap on an APPROVED outfit (live / paused restock card) → mandatory
//     re-render queued; the outfit is unpublished until it lands.

import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { getOutfit, getItem, type ItemWithBrand } from '@/lib/admin-queries'
import { recordStyleDecision } from '@/lib/style-brain-store'
import { getSwapCandidates } from '@/lib/studio/swap-candidates'
import { enqueueRender, processRenderQueue } from '@/lib/studio/render-queue'
import { recomputeOutfit, outfitEntries } from '@/lib/studio/outfit-recompute'
import { writeAudit } from '@/lib/studio/audit'
import { runStockSentinel } from '@/lib/studio/stock-sentinel'
import { sendStockEmail } from '@/lib/studio/stock-email'
import { revalidatePath } from 'next/cache'

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

async function requireAdmin(): Promise<{ ok: boolean }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { ok: !!user && user.id === process.env.ADMIN_USER_ID }
}

// ── Approve (swipe right / ✓) ─────────────────────────────────────────────────
export async function approveOutfitAction(outfitId: string): Promise<{ ok?: true; error?: string }> {
  if (!(await requireAdmin()).ok) return { error: 'Not authorised' }
  try {
    const outfit = await getOutfit(outfitId)
    if (!outfit) return { error: 'Outfit not found' }
    const entries = outfitEntries(outfit)

    const admin = createAdminClient()
    const prevStatus = (outfit as any).status
    await (admin.from('outfit') as any)
      .update({ status: 'approved_rendering' })
      .eq('outfit_id', outfitId)
      .in('status', ['draft', 'in_review'])

    await writeAudit({
      action: 'approve', entity: 'outfit', entityId: outfitId,
      trigger: 'mobile_review', before: { status: prevStatus }, after: { status: 'approved_rendering' },
    })

    // Positive training signal (same pipeline as composer approvals).
    await recordStyleDecision({
      items: entries.map((e) => toFeature(e.item)),
      decision: 'approve',
      source: 'review',
      anchorItemId: entries[0]?.item.item_id ?? null,
      itemIds: entries.map((e) => e.item.item_id),
      baseScore: (outfit as any).review_confidence ?? null,
    })

    // The render is triggered BY the approval — with the final (post-swap)
    // item set — and publishes on completion.
    await enqueueRender(outfitId, 'approval')
    void processRenderQueue().catch((err) => console.error('[approve→renderQueue]', err))

    revalidatePath('/studio/review')
    return { ok: true }
  } catch (err) {
    console.error('[approveOutfitAction]', err)
    return { error: err instanceof Error ? err.message : 'Approve failed' }
  }
}

// ── Reject (swipe left / ✕) — no render ever fires ───────────────────────────
export async function rejectOutfitAction(outfitId: string): Promise<{ ok?: true; error?: string }> {
  if (!(await requireAdmin()).ok) return { error: 'Not authorised' }
  try {
    const outfit = await getOutfit(outfitId)
    if (!outfit) return { error: 'Outfit not found' }
    const entries = outfitEntries(outfit)

    const admin = createAdminClient()
    const prevStatus = (outfit as any).status
    await (admin.from('outfit') as any)
      .update({ status: 'archived', admin_notes: 'Rejected in mobile review.' })
      .eq('outfit_id', outfitId)

    await writeAudit({
      action: 'reject', entity: 'outfit', entityId: outfitId,
      trigger: 'mobile_review', before: { status: prevStatus }, after: { status: 'archived' },
    })

    // -2 taste signal against the outfit vector → house-style stats.
    await recordStyleDecision({
      items: entries.map((e) => toFeature(e.item)),
      decision: 'skip',
      source: 'review',
      anchorItemId: entries[0]?.item.item_id ?? null,
      itemIds: entries.map((e) => e.item.item_id),
      baseScore: (outfit as any).review_confidence ?? null,
      weight: 2, // dislike weighs -2 in the signal hierarchy
    })

    revalidatePath('/studio/review')
    return { ok: true }
  } catch (err) {
    console.error('[rejectOutfitAction]', err)
    return { error: err instanceof Error ? err.message : 'Reject failed' }
  }
}

// ── Swap sheet: exactly 3 pre-ranked candidates ──────────────────────────────
export interface SwapSheetCandidate {
  itemId: string
  name: string
  brand: string | null
  price: string | null
  image: string | null
  similarity: number
}

export async function getSwapSheetAction(
  outfitId: string,
  outfitItemId: string,
): Promise<{ candidates?: SwapSheetCandidate[]; error?: string }> {
  if (!(await requireAdmin()).ok) return { error: 'Not authorised' }
  try {
    const outfit = await getOutfit(outfitId)
    if (!outfit) return { error: 'Outfit not found' }
    const entries = outfitEntries(outfit)
    const target = entries.find((e) => e.outfit_item_id === outfitItemId)
    if (!target) return { error: 'Item not on this outfit' }

    const candidates = await getSwapCandidates({
      outgoing: target.item,
      remaining: entries.filter((e) => e.outfit_item_id !== outfitItemId).map((e) => e.item),
      anchorItemId: entries[0]?.item.item_id ?? null,
      limit: 3,
    })

    const fmt = (p: unknown) => {
      const n = parseFloat(String(p ?? '').replace(/[^0-9.]/g, ''))
      return isNaN(n) ? null : `£${Math.round(n)}`
    }
    return {
      candidates: candidates.map((c) => ({
        itemId: c.item.item_id,
        name: c.item.product_name,
        brand: c.item.brand?.name ?? null,
        price: fmt((c.item as any).price),
        image: c.item.image_url ?? null,
        similarity: c.similarity,
      })),
    }
  } catch (err) {
    console.error('[getSwapSheetAction]', err)
    return { error: err instanceof Error ? err.message : 'Could not load candidates' }
  }
}

// ── Apply a swap ──────────────────────────────────────────────────────────────
export async function applySwapAction(
  outfitId: string,
  outfitItemId: string,
  newItemId: string,
): Promise<{ ok?: true; composedGroupUrl?: string | null; error?: string }> {
  if (!(await requireAdmin()).ok) return { error: 'Not authorised' }
  try {
    const outfit = await getOutfit(outfitId)
    if (!outfit) return { error: 'Outfit not found' }
    const entries = outfitEntries(outfit)
    const target = entries.find((e) => e.outfit_item_id === outfitItemId)
    if (!target) return { error: 'Item not on this outfit' }
    const incoming = await getItem(newItemId)
    if (!incoming) return { error: 'Replacement not found' }

    const admin = createAdminClient()
    await (admin.from('outfit_item') as any)
      .update({ item_id: newItemId })
      .eq('outfit_item_id', outfitItemId)

    // Swap learning — full dimension delta, same schema as composer swaps.
    const from = target.item as any
    const to = incoming as any
    const changed: string[] = []
    if (String(from.item_type) !== String(to.item_type)) changed.push('type')
    if (from.colour_family !== to.colour_family) changed.push('colour')
    if ((from.brand?.name ?? '') !== (to.brand?.name ?? '')) changed.push('brand')
    const label = (it: any) => [it.brand?.name, it.product_name].filter(Boolean).join(' — ') || String(it.item_type)
    await recordStyleDecision({
      items: [toFeature(entries[0].item), toFeature(target.item)],
      decision: 'skip',
      source: 'swap',
      anchorItemId: entries[0]?.item.item_id ?? null,
      itemIds: [entries[0]?.item.item_id, target.item.item_id].filter(Boolean) as string[],
      extraFeatures: {
        swap: {
          action: 'swap',
          from: label(from), to: label(to),
          fromType: from.item_type, toType: to.item_type,
          changed,
          different: changed.includes('type') || changed.length >= 2,
        },
      },
    })

    const status = String((outfit as any).status)
    const wasApproved = ['live', 'paused', 'approved_rendering', 'render_failed'].includes(status)
    const wasRestockPick = status === 'paused'

    if (wasRestockPick) {
      // Restock pick — record it in stock_swap so UNDO/restore work from email.
      await (admin.from('stock_swap') as any).insert({
        outfit_id: outfitId, slot: target.slot,
        out_item_id: target.item.item_id, in_item_id: newItemId,
        mode: 'manual',
      })
    }

    // Rebuild scores + vector + composed group with the new item set.
    await recomputeOutfit(outfitId)
    const { data: after } = await admin
      .from('outfit' as any).select('composed_group_url').eq('outfit_id', outfitId).maybeSingle()

    await writeAudit({
      action: 'swap', entity: 'outfit', entityId: outfitId,
      trigger: 'mobile_review',
      before: { item: target.item.item_id }, after: { item: newItemId, slot: target.slot },
    })

    if (wasApproved) {
      // Swap on an approved outfit → mandatory re-render before republish.
      // A LIVE outfit comes off publish until the fresh render lands — the
      // public hero must always show the actual items.
      if (status === 'live') {
        await (admin.from('outfit') as any)
          .update({ status: 'approved_rendering' })
          .eq('outfit_id', outfitId)
          .eq('status', 'live')
      }
      await enqueueRender(outfitId, wasRestockPick ? 'stock_swap' : 'manual')
      void processRenderQueue().catch((err) => console.error('[swap→renderQueue]', err))
    }
    // Unapproved outfit: NO render — it fires once, on approval.

    revalidatePath('/studio/review')
    return { ok: true, composedGroupUrl: (after as any)?.composed_group_url ?? null }
  } catch (err) {
    console.error('[applySwapAction]', err)
    return { error: err instanceof Error ? err.message : 'Swap failed' }
  }
}

// ── "None of these" → desktop studio ─────────────────────────────────────────
export async function needsDesktopAction(outfitId: string): Promise<{ ok?: true; error?: string }> {
  if (!(await requireAdmin()).ok) return { error: 'Not authorised' }
  try {
    const admin = createAdminClient()
    const { data: cur } = await admin.from('outfit' as any).select('status').eq('outfit_id', outfitId).maybeSingle()
    await (admin.from('outfit') as any).update({ status: 'needs_desktop' }).eq('outfit_id', outfitId)
    await writeAudit({
      action: 'needs_desktop', entity: 'outfit', entityId: outfitId,
      trigger: 'mobile_review', before: { status: (cur as any)?.status }, after: { status: 'needs_desktop' },
    })
    revalidatePath('/studio/review')
    revalidatePath('/admin')
    return { ok: true }
  } catch (err) {
    console.error('[needsDesktopAction]', err)
    return { error: err instanceof Error ? err.message : 'Failed' }
  }
}

// ── Manual sentinel run (header button — batch, click again to continue) ─────
export async function runSentinelNowAction(): Promise<{
  summary?: string
  error?: string
}> {
  if (!(await requireAdmin()).ok) return { error: 'Not authorised' }
  try {
    const report = await runStockSentinel({ maxItems: 15, budgetMs: 45_000 })
    await sendStockEmail(report)
    void processRenderQueue().catch(() => {})
    revalidatePath('/studio/review')
    return {
      summary:
        `${report.itemsChecked} checked · ${report.itemsDown.length} down · ` +
        `${report.autoSwapped.length} auto-swapped · ${report.needsPick.length} need you` +
        (report.deferred ? ` · ${report.deferred} held for next run` : ''),
    }
  } catch (err) {
    console.error('[runSentinelNowAction]', err)
    return { error: err instanceof Error ? err.message : 'Sentinel failed' }
  }
}
