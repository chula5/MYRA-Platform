'use server'

// WARDROBE IMPORT — admin side. Chloe uploads a client's photos (a folder at a
// time), the queue detects → cuts out → scores, she reviews every extracted
// piece, and approved pieces become owned items the private-stylist composer
// styles retail pieces WITH. Also: the per-client wardrobe grid, spend per
// batch, photo deletion (with look rebuild) and "what should she buy".

import { revalidatePath } from 'next/cache'
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase-server'
import { requireAdminUser, writeAudit } from '@/lib/admin-audit'
import { slotForItemType } from '@/lib/composer'
import { openAiConfigured, WARDROBE_CONFIG } from '@/lib/wardrobe/config'
import { processWardrobeQueue } from '@/lib/wardrobe/queue'
import {
  addPhotoToBatch, approveExtraction, createBatch, deleteOwnedItem, deletePhoto, discardExtraction,
  findAuthUserIdByEmail, listBatches, listBrandNames, listOwnedItems, listPhotos, listReviewQueue,
  queueSummary, requestRegenerate, requestRescore, requeueFailedJobs, saveExtractionEdits, updateOwnedItem,
} from '@/lib/wardrobe/store'
import { ownerRefsForMember, styledInCounts, isOwnedItem } from '@/lib/wardrobe/owned-items'
import { rankUnlockPurchases } from '@/lib/wardrobe/unlock'
import { memberGate, memberItemScore, occasionItemScore, personaFitScore, type OccasionContext } from '@/lib/pilot-composer'
import { lookTasteVector, normalise, effectiveWeights, type OccasionId } from '@/lib/pilot-stylist'
import type { ExtractionEdits, WardrobeBatch, BatchCost, WardrobeExtraction, WardrobePhoto } from '@/lib/wardrobe/types'
import { loadMemberLibrary, loadMemberPersonaLens, loadMemberTasteFor, rebuildLooksWithoutItems } from '@/app/admin/private-stylist/actions'

const PATH = '/admin/wardrobe'

async function gate(): Promise<{ error?: string; userId?: string }> {
  const { ok, userId } = await requireAdminUser()
  return ok ? { userId: userId ?? 'admin' } : { error: 'Not authorised' }
}

// ── Types shared with the client ────────────────────────────────────────────

export interface WardrobeMemberSummary {
  member_id: string
  name: string
  auth_user_id: string | null
  owned_count: number
  pending_review: number
}

export interface OwnedItemView {
  item_id: string
  product_name: string
  brand_name: string | null
  item_type: string
  slot: string
  colour_family: string | null
  colour_hex: string | null
  image_url: string | null
  estimated_value: number | null
  owned_metadata: Record<string, any>
  material_primary: string | null
  styled_in: number
  created_at: string
  source_photo_id: string | null
}

export interface MemberWardrobe {
  member: { member_id: string; name: string; auth_user_id: string | null }
  items: OwnedItemView[]
  queue: WardrobeExtraction[]
  photos: WardrobePhoto[]
  batches: (WardrobeBatch & { cost: BatchCost | null })[]
  jobs: { queued: number; running: number; failed: number; byKind: Record<string, number> }
  lookCount: number
}

export interface WardrobeData {
  ready: boolean
  openAiConfigured: boolean
  models: { vision: string; image: string; quality: string }
  members: WardrobeMemberSummary[]
  selected: MemberWardrobe | null
  brandNames: string[]
}

// ── Load ────────────────────────────────────────────────────────────────────

export async function loadWardrobeData(memberId?: string | null): Promise<WardrobeData> {
  const admin = createAdminClient() as any
  const base: WardrobeData = {
    ready: true,
    openAiConfigured: openAiConfigured(),
    models: { vision: WARDROBE_CONFIG.visionModel, image: WARDROBE_CONFIG.imageModel, quality: WARDROBE_CONFIG.imageQuality },
    members: [],
    selected: null,
    brandNames: [],
  }
  const { data: members, error } = await admin.from('pilot_member').select('member_id, name, auth_user_id, is_synthetic').order('created_at')
  if (error) {
    // auth_user_id missing → 0046 not run
    const retry = await admin.from('pilot_member').select('member_id, name').order('created_at')
    return { ...base, ready: false, members: ((retry.data ?? []) as any[]).map((m) => ({ member_id: m.member_id, name: m.name, auth_user_id: null, owned_count: 0, pending_review: 0 })) }
  }
  const { data: xs, error: xerr } = await admin.from('wardrobe_extraction').select('owner_user_id, status').in('status', ['review', 'failed']).limit(5000)
  if (xerr) return { ...base, ready: false, members: ((members ?? []) as any[]).map((m) => ({ member_id: m.member_id, name: m.name, auth_user_id: m.auth_user_id ?? null, owned_count: 0, pending_review: 0 })) }
  const { data: owned } = await admin.from('item').select('owner_user_id').eq('ownership', 'owned').neq('status', 'archived').limit(10000)
  const ownedBy = new Map<string, number>()
  for (const r of (owned ?? []) as any[]) ownedBy.set(r.owner_user_id, (ownedBy.get(r.owner_user_id) ?? 0) + 1)
  const pendingBy = new Map<string, number>()
  for (const r of (xs ?? []) as any[]) pendingBy.set(r.owner_user_id, (pendingBy.get(r.owner_user_id) ?? 0) + 1)

  const summaries: WardrobeMemberSummary[] = ((members ?? []) as any[])
    .filter((m) => !m.is_synthetic)
    .map((m) => ({
      member_id: m.member_id,
      name: m.name,
      auth_user_id: m.auth_user_id ?? null,
      owned_count: (ownedBy.get(m.member_id) ?? 0) + (m.auth_user_id ? ownedBy.get(m.auth_user_id) ?? 0 : 0),
      pending_review: (pendingBy.get(m.member_id) ?? 0) + (m.auth_user_id ? pendingBy.get(m.auth_user_id) ?? 0 : 0),
    }))

  const pick = summaries.find((m) => m.member_id === memberId) ?? null
  const selected = pick ? await loadMemberWardrobe(pick) : null
  const brandNames = pick ? await listBrandNames() : []
  return { ...base, members: summaries, selected, brandNames }
}

async function loadMemberWardrobe(m: WardrobeMemberSummary): Promise<MemberWardrobe> {
  const admin = createAdminClient() as any
  const owners = ownerRefsForMember(m)
  const [items, queue, photos, batches, jobs, looksRes] = await Promise.all([
    listOwnedItems(owners),
    listReviewQueue(owners),
    listPhotos(owners, { withUrls: true }),
    listBatches(owners),
    queueSummary(owners),
    admin.from('pilot_look').select('items, delivery:delivery_id!inner(member_id)').eq('delivery.member_id', m.member_id).limit(5000),
  ])
  const looks = ((looksRes?.data ?? []) as any[])
  const styled = styledInCounts(looks)
  return {
    member: { member_id: m.member_id, name: m.name, auth_user_id: m.auth_user_id },
    items: items.map((it: any) => ({
      item_id: it.item_id,
      product_name: it.product_name,
      brand_name: it.brand?.name ?? it.owned_metadata?.brand_label ?? null,
      item_type: it.item_type,
      slot: slotForItemType(it.item_type),
      colour_family: it.colour_family ?? null,
      colour_hex: it.colour_hex ?? null,
      image_url: it.image_url ?? null,
      estimated_value: it.estimated_value != null ? Number(it.estimated_value) : null,
      owned_metadata: it.owned_metadata ?? {},
      material_primary: it.material_primary ?? null,
      styled_in: styled.get(it.item_id) ?? 0,
      created_at: it.created_at,
      source_photo_id: it.source_photo_id ?? null,
    })),
    queue,
    photos,
    batches,
    jobs,
    lookCount: looks.length,
  }
}

// ── Upload ──────────────────────────────────────────────────────────────────

export async function startBatch(memberId: string, label?: string | null): Promise<{ batchId?: string; error?: string }> {
  const g = await gate()
  if (g.error) return { error: g.error }
  try {
    const b = await createBatch({ kind: 'pilot_member', id: memberId }, 'admin', label ?? null)
    await writeAudit({ actor: g.userId!, action: 'wardrobe_batch_started', entityType: 'wardrobe_batch', entityId: b.batch_id, detail: { memberId, label } })
    return { batchId: b.batch_id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not start batch' }
  }
}

/** One photo per call — the browser loops over the folder so progress is visible. */
export async function uploadWardrobePhoto(formData: FormData): Promise<{ photoId?: string; error?: string }> {
  const g = await gate()
  if (g.error) return { error: g.error }
  const memberId = String(formData.get('member_id') ?? '')
  const batchId = String(formData.get('batch_id') ?? '') || null
  const file = formData.get('file')
  if (!memberId) return { error: 'No member' }
  if (!(file instanceof File) || file.size === 0) return { error: 'Empty file' }
  if (!file.type.startsWith('image/')) return { error: `${file.name}: not an image` }
  const bytes = Buffer.from(await file.arrayBuffer())
  const r = await addPhotoToBatch(batchId, { kind: 'pilot_member', id: memberId }, { bytes, name: file.name, mime: file.type })
  if (r.error || !r.photo) return { error: r.error ?? 'Upload failed' }
  // Kick the queue without holding the upload response.
  try { waitUntil(processWardrobeQueue(45_000).catch(() => undefined)) } catch { /* not on Vercel */ }
  return { photoId: r.photo.photo_id }
}

/** Drain the queue for a while — the page calls this while anything is queued. */
export async function drainWardrobeQueue(budgetMs = 45_000): Promise<{ done: number; failed: number; remaining: number; skipped?: string; error?: string }> {
  const g = await gate()
  if (g.error) return { done: 0, failed: 0, remaining: 0, error: g.error }
  const r = await processWardrobeQueue(Math.min(240_000, Math.max(5_000, budgetMs)))
  revalidatePath(PATH)
  return r
}

export async function retryFailedJobs(memberId: string): Promise<{ requeued: number; error?: string }> {
  const g = await gate()
  if (g.error) return { requeued: 0, error: g.error }
  const { data: m } = await (createAdminClient() as any).from('pilot_member').select('member_id, auth_user_id').eq('member_id', memberId).single()
  const n = await requeueFailedJobs(ownerRefsForMember(m ?? { member_id: memberId }))
  revalidatePath(PATH)
  return { requeued: n }
}

// ── Review ──────────────────────────────────────────────────────────────────

export async function reviewApprove(extractionId: string, edits: ExtractionEdits): Promise<{ itemId?: string; error?: string }> {
  const g = await gate()
  if (g.error) return { error: g.error }
  const r = await approveExtraction(extractionId, edits)
  if (r.itemId) {
    await writeAudit({ actor: g.userId!, action: 'wardrobe_item_approved', entityType: 'item', entityId: r.itemId, detail: { extractionId } })
    revalidatePath(PATH)
    revalidatePath('/admin/private-stylist')
  }
  return r
}

export async function reviewSaveEdits(extractionId: string, edits: ExtractionEdits): Promise<{ error?: string }> {
  const g = await gate()
  if (g.error) return { error: g.error }
  return saveExtractionEdits(extractionId, edits)
}

export async function reviewDiscard(extractionId: string): Promise<{ error?: string }> {
  const g = await gate()
  if (g.error) return { error: g.error }
  const r = await discardExtraction(extractionId)
  revalidatePath(PATH)
  return r
}

export async function reviewRegenerate(extractionId: string, direction: string | null): Promise<{ error?: string }> {
  const g = await gate()
  if (g.error) return { error: g.error }
  const r = await requestRegenerate(extractionId, direction)
  if (!r.error) { try { waitUntil(processWardrobeQueue(45_000).catch(() => undefined)) } catch { /* local */ } }
  revalidatePath(PATH)
  return r
}

export async function reviewRescore(extractionId: string): Promise<{ error?: string }> {
  const g = await gate()
  if (g.error) return { error: g.error }
  const r = await requestRescore(extractionId)
  if (!r.error) { try { waitUntil(processWardrobeQueue(45_000).catch(() => undefined)) } catch { /* local */ } }
  revalidatePath(PATH)
  return r
}

// ── Wardrobe ────────────────────────────────────────────────────────────────

export async function updateOwned(itemId: string, patch: { estimated_value?: number | null; product_name?: string; brand_name?: string | null; owned_metadata?: Record<string, unknown> }): Promise<{ error?: string }> {
  const g = await gate()
  if (g.error) return { error: g.error }
  const r = await updateOwnedItem(itemId, patch)
  revalidatePath(PATH)
  return r
}

export async function removeOwnedItem(itemId: string): Promise<{ error?: string; rebuilt?: number }> {
  const g = await gate()
  if (g.error) return { error: g.error }
  const r = await deleteOwnedItem(itemId)
  if (r.error) return r
  const rb = await rebuildLooksWithoutItems([itemId])
  await writeAudit({ actor: g.userId!, action: 'wardrobe_item_removed', entityType: 'item', entityId: itemId, detail: { rebuilt: rb.rebuilt } })
  revalidatePath(PATH)
  return { rebuilt: rb.rebuilt }
}

/** Delete an original photo → its extractions and items go, looks that used them are rebuilt. */
export async function removePhoto(photoId: string): Promise<{ error?: string; removedItems?: number; rebuilt?: number }> {
  const g = await gate()
  if (g.error) return { error: g.error }
  const r = await deletePhoto(photoId)
  if (r.error) return { error: r.error }
  const rb = await rebuildLooksWithoutItems(r.removedItemIds ?? [])
  await writeAudit({ actor: g.userId!, action: 'wardrobe_photo_deleted', entityType: 'wardrobe_photo', entityId: photoId, detail: { removedItems: r.removedItemIds?.length ?? 0, rebuilt: rb.rebuilt } })
  revalidatePath(PATH)
  revalidatePath('/admin/private-stylist')
  return { removedItems: r.removedItemIds?.length ?? 0, rebuilt: rb.rebuilt }
}

// ── Link a member to her login (so /me/wardrobe uploads compose into her deliveries) ──

export async function linkMemberLogin(memberId: string, email: string): Promise<{ error?: string; authUserId?: string }> {
  const g = await gate()
  if (g.error) return { error: g.error }
  const id = await findAuthUserIdByEmail(email)
  if (!id) return { error: `No login found for ${email} — she needs to sign up first` }
  const { error } = await (createAdminClient() as any).from('pilot_member').update({ auth_user_id: id }).eq('member_id', memberId)
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return { authUserId: id }
}

export async function unlinkMemberLogin(memberId: string): Promise<{ error?: string }> {
  const g = await gate()
  if (g.error) return { error: g.error }
  const { error } = await (createAdminClient() as any).from('pilot_member').update({ auth_user_id: null }).eq('member_id', memberId)
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}

// ── "What should she buy?" ──────────────────────────────────────────────────

export interface UnlockRow {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string | null
  price_gbp: number | null
  retailer_url: string | null
  slot: string
  unlocked: number
  outfitsPer100: number | null
  avgCoherence: number
  examples: { items: { item_id: string; product_name: string; image_url: string | null; owned: boolean }[] }[]
}

export async function unlockPurchases(memberId: string, occasion?: OccasionId | null): Promise<{ rows?: UnlockRow[]; ownedCount?: number; error?: string }> {
  const g = await gate()
  if (g.error) return { error: g.error }
  const admin = createAdminClient() as any
  const [taste, library, { data: member }, lens] = await Promise.all([
    loadMemberTasteFor(memberId),
    loadMemberLibrary(memberId),
    admin.from('pilot_member').select('room_weights, work_dress_code').eq('member_id', memberId).single(),
    loadMemberPersonaLens(memberId),
  ])
  if (!taste) return { error: 'Member not found' }
  const owned = library.filter((i) => isOwnedItem(i as any) && i.image_url)
  if (!owned.length) return { rows: [], ownedCount: 0 }
  const retail = library.filter((i) => !isOwnedItem(i as any) && i.image_url && i.stock_status !== 'out_of_stock')
  const occ: OccasionContext | undefined = occasion && member
    ? { id: occasion, vector: lookTasteVector(normalise(effectiveWeights(member.room_weights, occasion, member.work_dress_code))) }
    : undefined
  // The same bar composition uses: her hard gate (input-only brands, excluded
  // brand pairs) — and ranking through HER stylist persona, so the order here
  // matches the order the composer would actually pick in.
  const results = rankUnlockPurchases(owned, retail, {
    maxCandidates: 160,
    gate: (items) => memberGate(taste, items[0], items.slice(1).map((i) => ({ item: i, slot: slotForItemType(i.item_type) }))),
    rank: (i) => memberItemScore(taste, i) + occasionItemScore(occ, i) + personaFitScore(lens, i),
  })
  const byId = new Map(library.map((i) => [i.item_id, i]))
  const rows: UnlockRow[] = results.map((r) => ({
    item_id: r.item.item_id,
    product_name: r.item.product_name,
    brand_name: r.item.brand?.name ?? null,
    image_url: r.item.image_url ?? null,
    price_gbp: (r.item as any).price_gbp != null ? Number((r.item as any).price_gbp) : r.item.price != null ? Number(r.item.price) : null,
    retailer_url: r.item.retailer_url ?? null,
    slot: r.slot,
    unlocked: r.unlocked,
    outfitsPer100: r.outfitsPer100 != null ? Math.round(r.outfitsPer100 * 10) / 10 : null,
    avgCoherence: Math.round(r.avgCoherence * 100) / 100,
    examples: r.examples.map((e) => ({
      items: e.itemIds.map((id) => {
        const it = byId.get(id)
        return { item_id: id, product_name: it?.product_name ?? '—', image_url: it?.image_url ?? null, owned: isOwnedItem(it as any) }
      }),
    })),
  }))
  return { rows, ownedCount: owned.length }
}
