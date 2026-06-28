'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { getItem, getReadyAndLiveItems, type ItemWithBrand } from '@/lib/admin-queries'
import {
  generateCandidates,
  deriveSlotScores,
  deriveOutfitLevelScores,
  slotForItemType,
  slotPlanForAnchor,
  pairCompat,
  type Slot,
} from '@/lib/composer'
import { revalidatePath } from 'next/cache'
import { generateHiggsfieldShootForOutfit } from '@/app/admin/projects/higgsfield-actions'
import { generateOccasionTags } from '@/app/admin/ai/occasion-tags'

// ── Compose ──────────────────────────────────────────────────────────────────

export interface ComposedCandidatePayload {
  candidateIndex: number
  score: number
  items: Array<{
    slot: Slot
    item_id: string
    product_name: string
    brand_name: string | null
    image_url: string
    compat: number
  }>
}

export interface SlotPlanPayload {
  anchorSlot: Slot
  required: Slot[]
  optional: Slot[]
}

export async function composeForAnchor(
  anchorItemId: string,
): Promise<{
  anchor?: ItemWithBrand
  candidates?: ComposedCandidatePayload[]
  slotPlan?: SlotPlanPayload
  error?: string
}> {
  try {
    const anchor = await getItem(anchorItemId)
    if (!anchor) return { error: 'Anchor item not found' }

    const library = await getReadyAndLiveItems()
    if (library.length < 3) {
      return { error: 'Library needs at least three ready/live items to compose against' }
    }

    const raw = generateCandidates({ anchor, library })

    const candidates: ComposedCandidatePayload[] = raw.map((c, idx) => ({
      candidateIndex: idx,
      score: Number(c.score.toFixed(3)),
      items: c.items.map(({ item, slot }) => ({
        slot,
        item_id: item.item_id,
        product_name: item.product_name,
        brand_name: item.brand?.name ?? null,
        image_url: item.image_url,
        compat: Number((c.breakdown.find(b => b.itemId === item.item_id)?.compatWithAnchor ?? 0).toFixed(3)),
      })),
    }))

    const anchorSlot = slotForItemType(anchor.item_type)
    const plan = slotPlanForAnchor(anchorSlot)
    const slotPlan: SlotPlanPayload = {
      anchorSlot,
      required: plan.required,
      optional: plan.optional,
    }

    return { anchor, candidates, slotPlan }
  } catch (err: unknown) {
    console.error('[composeForAnchor]', err)
    return { error: err instanceof Error ? err.message : 'Compose failed' }
  }
}

// ── Swap options ─────────────────────────────────────────────────────────────
// Powers the per-item SWAP / ADD picker on candidate cards.
//
//  - No query  → "most relevant": items in the requested slot, ranked by
//                 compatibility with the anchor (the default suggestions).
//  - A query   → searches the WHOLE library (every slot) by product name or
//                 brand, so you can pick literally any item. Same-slot matches
//                 still float to the top, but nothing is filtered out by slot.
//
// Either way the anchor and items already in the candidate are excluded, and the
// item's true slot is returned so a cross-slot pick lands in the right place.

export interface SwapOption {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  item_type: string
  slot: Slot
  sameSlot: boolean
  compat: number
}

export async function getSwapOptions(
  anchorItemId: string,
  slot: Slot,
  excludeItemIds: string[],
  query = '',
  limit = 60,
): Promise<{ options?: SwapOption[]; error?: string }> {
  try {
    const anchor = await getItem(anchorItemId)
    if (!anchor) return { error: 'Anchor not found' }

    const library = await getReadyAndLiveItems()
    const excluded = new Set([anchor.item_id, ...excludeItemIds])
    const q = query.trim().toLowerCase()

    let pool = library.filter((i) => !excluded.has(i.item_id))

    if (q) {
      // Search the entire library across every slot.
      pool = pool.filter(
        (i) =>
          i.product_name?.toLowerCase().includes(q) ||
          (i.brand?.name?.toLowerCase().includes(q) ?? false) ||
          i.item_type?.toLowerCase().includes(q),
      )
    } else {
      // Default suggestions: only items in the requested slot.
      pool = pool.filter((i) => slotForItemType(i.item_type) === slot)
    }

    const options: SwapOption[] = pool
      .map((item) => {
        const itemSlot = slotForItemType(item.item_type)
        return {
          item_id: item.item_id,
          product_name: item.product_name,
          brand_name: item.brand?.name ?? null,
          image_url: item.image_url,
          item_type: item.item_type,
          slot: itemSlot,
          sameSlot: itemSlot === slot,
          compat: Number(pairCompat(anchor, item).total.toFixed(3)),
        }
      })
      // Most relevant first: matching slot before others, then by compatibility.
      .sort((a, b) => Number(b.sameSlot) - Number(a.sameSlot) || b.compat - a.compat)
      .slice(0, limit)

    return { options }
  } catch (err: unknown) {
    console.error('[getSwapOptions]', err)
    return { error: err instanceof Error ? err.message : 'Swap lookup failed' }
  }
}

// ── Rescore ──────────────────────────────────────────────────────────────────
// Recompute a candidate's coherence + per-item compat after the user edits its
// items via swap/remove. Mirrors the aggregation in generateCandidates so the
// displayed score stays accurate.

export async function rescoreCandidate(
  anchorItemId: string,
  additions: Array<{ itemId: string; slot: Slot }>,
): Promise<{ score?: number; itemCompat?: Record<string, number>; error?: string }> {
  try {
    const anchor = await getItem(anchorItemId)
    if (!anchor) return { error: 'Anchor not found' }

    if (additions.length === 0) return { score: 0, itemCompat: {} }

    const items = await Promise.all(additions.map((a) => getItem(a.itemId)))
    if (items.some((i) => !i)) return { error: 'One or more items missing' }
    const entries = (items as ItemWithBrand[]).map((item, i) => ({ item, slot: additions[i].slot }))

    const itemCompat: Record<string, number> = {}
    let sum = 0
    let weight = 0
    for (const { item } of entries) {
      const c = pairCompat(anchor, item).total
      itemCompat[item.item_id] = Number(c.toFixed(3))
      sum += c * 2
      weight += 2
    }
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        sum += pairCompat(entries[i].item, entries[j].item).total
        weight += 1
      }
    }
    const score = weight > 0 ? sum / weight : 0
    return { score: Number(score.toFixed(3)), itemCompat }
  } catch (err: unknown) {
    console.error('[rescoreCandidate]', err)
    return { error: err instanceof Error ? err.message : 'Rescore failed' }
  }
}

// ── Anchor search ────────────────────────────────────────────────────────────

export async function searchAnchorItems(query: string, brandId?: string): Promise<{
  data?: Array<{ item_id: string; product_name: string; image_url: string; brand_name: string | null; item_type: string }>
  error?: string
}> {
  const supabase = createAdminClient()
  try {
    let req = supabase
      .from('item')
      .select('item_id, product_name, image_url, item_type, brand:brand_id(name)')
      .in('status', ['draft', 'ready', 'live'])
      .order('created_at', { ascending: false })
      .limit(60)

    const q = query.trim()
    if (q) req = req.ilike('product_name', `%${q}%`)
    if (brandId) req = req.eq('brand_id', brandId)

    const { data, error } = await req
    if (error) throw error

    return {
      data: (data ?? []).map((r: any) => ({
        item_id: r.item_id,
        product_name: r.product_name,
        image_url: r.image_url,
        item_type: r.item_type,
        brand_name: r.brand?.name ?? null,
      })),
    }
  } catch (err: unknown) {
    console.error('[searchAnchorItems]', err)
    return { error: err instanceof Error ? err.message : 'Search failed' }
  }
}

// ── Approve candidate → draft Outfit ─────────────────────────────────────────

const COMPOSER_PROJECT_TITLE = 'Composer drafts'

async function ensureComposerProject(): Promise<{ projectId?: string; error?: string }> {
  const supabase = createAdminClient()
  try {
    const { data: existing } = await supabase
      .from('admin_project')
      .select('project_id')
      .eq('title', COMPOSER_PROJECT_TITLE)
      .eq('status', 'draft')
      .limit(1)

    const row = (existing ?? [])[0] as { project_id: string } | undefined
    if (row) return { projectId: row.project_id }

    const { data: created, error } = await supabase
      .from('admin_project')
      .insert([{
        title: COMPOSER_PROJECT_TITLE,
        status: 'draft',
        outfit_ids: [],
        notes: 'Auto-created bucket for outfits approved from the Composer. Move outfits into a named project before publishing.',
      }])
      .select('project_id')
      .single()
    if (error) throw error
    return { projectId: (created as { project_id: string }).project_id }
  } catch (err: unknown) {
    console.error('[ensureComposerProject]', err)
    return { error: err instanceof Error ? err.message : 'Could not create composer project' }
  }
}

export async function approveCandidate(
  anchorItemId: string,
  itemIds: string[],
  slots: Slot[],
  opts?: { autoShoot?: boolean },
): Promise<{ outfitId?: string; projectId?: string; error?: string }> {
  if (itemIds.length !== slots.length) return { error: 'itemIds and slots length mismatch' }

  const supabase = createAdminClient()
  try {
    const anchor = await getItem(anchorItemId)
    if (!anchor) return { error: 'Anchor item not found' }

    const additionItems = await Promise.all(itemIds.map(id => getItem(id)))
    if (additionItems.some(i => !i)) return { error: 'One or more candidate items not found' }

    const additions = (additionItems as ItemWithBrand[]).map((item, i) => ({ item, slot: slots[i] }))

    const projRes = await ensureComposerProject()
    if (projRes.error || !projRes.projectId) return { error: projRes.error ?? 'No project' }
    const projectId = projRes.projectId

    const anchorSlot = slotForItemType(anchor.item_type)
    const allEntries = [{ item: anchor, slot: anchorSlot }, ...additions]

    const slotScores = deriveSlotScores(allEntries)
    const outfitLevel = deriveOutfitLevelScores(anchor, additions)

    const allBrandIds = Array.from(new Set(
      allEntries.map(e => e.item.brand_id).filter((id): id is string => !!id),
    ))

    const aestheticLabel = `COMPOSED · ${anchor.product_name.toUpperCase()}`

    const { data: outfit, error: outfitErr } = await supabase
      .from('outfit')
      .insert([{
        image_url: anchor.image_url,
        aesthetic_label: aestheticLabel,
        occasion_tags: [],
        source_brand_ids: allBrandIds,
        status: 'draft',
        project_id: projectId,
        admin_notes: 'Generated by Outfit Composer. Review and refine before publishing.',
        formality: 3, planning: 3, wearer_priority: 3, time_of_day: 3,
        ...outfitLevel,
        ...slotScores,
      }])
      .select('outfit_id')
      .single()

    if (outfitErr) throw outfitErr
    const outfitId = (outfit as { outfit_id: string }).outfit_id

    // Link outfit_item rows for anchor + every addition
    const outfitItemRows = allEntries.map((entry, idx) => ({
      outfit_id: outfitId,
      item_id: entry.item.item_id,
      slot: entry.slot,
      sort_order: idx,
    }))
    const { error: linkErr } = await supabase.from('outfit_item').insert(outfitItemRows)
    if (linkErr) throw linkErr

    // Append outfit_id to project.outfit_ids
    const { data: project } = await supabase
      .from('admin_project')
      .select('outfit_ids')
      .eq('project_id', projectId)
      .single()
    const newIds = [...((project as { outfit_ids: string[] } | null)?.outfit_ids ?? []), outfitId]
    await supabase.from('admin_project').update({ outfit_ids: newIds }).eq('project_id', projectId)

    revalidatePath('/admin/composer')
    revalidatePath(`/admin/projects/${projectId}`)

    // Auto-generate a Refined Higgsfield shoot in the background. Fire-and-forget
    // so Approve to Draft returns instantly; the image attaches to the outfit's
    // additional_images (~30–60s, ~1 credit) and shows when the draft is opened.
    // Never let a shoot failure break approval. Callers that drive the shoot
    // themselves (e.g. Outfit Review, which awaits it for live status) pass
    // autoShoot:false so it isn't generated twice.
    if (opts?.autoShoot !== false) {
      void generateHiggsfieldShootForOutfit(outfitId, 'E5').catch((err) =>
        console.error('[approveCandidate→higgsfield]', err),
      )
    }

    // Auto-generate occasion tags from the outfit's items (fast; fire-and-forget).
    void generateOccasionTags(outfitId, { skipIfTagged: true }).catch((err) =>
      console.error('[approveCandidate→occasionTags]', err),
    )

    return { outfitId, projectId }
  } catch (err: unknown) {
    console.error('[approveCandidate]', err)
    return { error: err instanceof Error ? err.message : 'Approve failed' }
  }
}
