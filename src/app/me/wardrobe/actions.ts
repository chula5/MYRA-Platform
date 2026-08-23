'use server'

// CLIENT AREA — her own wardrobe. She photographs what she owns, we extract
// each piece, she approves what we found, and her stylist can style new pieces
// with hers. Everything here is scoped to the signed-in user: her photos are
// private (signed URLs), her pieces are hers alone, and deleting a photo takes
// its pieces out of any look that used them.

import { revalidatePath } from 'next/cache'
import { waitUntil } from '@vercel/functions'
import { createServerClient } from '@/lib/supabase-server'
import { slotForItemType } from '@/lib/composer'
import { openAiConfigured } from '@/lib/wardrobe/config'
import { processWardrobeQueue } from '@/lib/wardrobe/queue'
import {
  addPhotoToBatch, approveExtraction, createBatch, deleteOwnedItem, deletePhoto, discardExtraction,
  listOwnedItems, listPhotos, listReviewQueue, queueSummary, requestRegenerate, updateOwnedItem,
} from '@/lib/wardrobe/store'
import { styledInCounts } from '@/lib/wardrobe/owned-items'
import type { ExtractionEdits, OwnerRef, WardrobeExtraction, WardrobePhoto } from '@/lib/wardrobe/types'
import { rebuildLooksWithoutItems } from '@/app/admin/private-stylist/actions'
import { createAdminClient } from '@/lib/supabase-server'

const PATH = '/me/wardrobe'

async function requireClient(): Promise<{ owner?: OwnerRef; error?: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' }
  return { owner: { kind: 'auth_user', id: user.id } }
}

export interface MyOwnedItem {
  item_id: string
  product_name: string
  brand_name: string | null
  slot: string
  colour_family: string | null
  image_url: string | null
  estimated_value: number | null
  styled_in: number
}

export interface MyWardrobe {
  ready: boolean
  processing: boolean
  queued: number
  items: MyOwnedItem[]
  queue: WardrobeExtraction[]
  photos: WardrobePhoto[]
  linkedToStylist: boolean
}

export async function loadMyWardrobe(): Promise<MyWardrobe | { error: string }> {
  const c = await requireClient()
  if (!c.owner) return { error: c.error! }
  const owners = [c.owner]
  try {
    const admin = createAdminClient() as any
    const [items, queue, photos, jobs, { data: member }] = await Promise.all([
      listOwnedItems(owners),
      listReviewQueue(owners),
      listPhotos(owners, { withUrls: true }),
      queueSummary(owners),
      admin.from('pilot_member').select('member_id').eq('auth_user_id', c.owner.id).maybeSingle(),
    ])
    let styled = new Map<string, number>()
    if (member?.member_id) {
      const { data: looks } = await admin.from('pilot_look').select('items, delivery:delivery_id!inner(member_id)').eq('delivery.member_id', member.member_id).limit(5000)
      styled = styledInCounts((looks ?? []) as any[])
    }
    return {
      ready: openAiConfigured(),
      processing: jobs.queued + jobs.running > 0,
      queued: jobs.queued + jobs.running,
      items: items.map((it: any) => ({
        item_id: it.item_id,
        product_name: it.product_name,
        brand_name: it.brand?.name ?? it.owned_metadata?.brand_label ?? null,
        slot: slotForItemType(it.item_type),
        colour_family: it.colour_family ?? null,
        image_url: it.image_url ?? null,
        estimated_value: it.estimated_value != null ? Number(it.estimated_value) : null,
        styled_in: styled.get(it.item_id) ?? 0,
      })),
      queue,
      photos,
      linkedToStylist: Boolean(member?.member_id),
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not load your wardrobe' }
  }
}

export async function uploadMyPhoto(formData: FormData): Promise<{ photoId?: string; error?: string }> {
  const c = await requireClient()
  if (!c.owner) return { error: c.error! }
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Empty file' }
  if (!file.type.startsWith('image/')) return { error: 'That is not an image' }
  const bytes = Buffer.from(await file.arrayBuffer())
  let batchId: string | null = String(formData.get('batch_id') ?? '') || null
  if (!batchId) {
    try { batchId = (await createBatch(c.owner, 'client', null)).batch_id } catch { batchId = null }
  }
  const r = await addPhotoToBatch(batchId, c.owner, { bytes, name: file.name, mime: file.type })
  if (r.error || !r.photo) return { error: r.error ?? 'Upload failed' }
  try { waitUntil(processWardrobeQueue(45_000).catch(() => undefined)) } catch { /* local */ }
  revalidatePath(PATH)
  return { photoId: r.photo.photo_id }
}

export async function startMyBatch(): Promise<{ batchId?: string; error?: string }> {
  const c = await requireClient()
  if (!c.owner) return { error: c.error! }
  try { return { batchId: (await createBatch(c.owner, 'client', null)).batch_id } } catch (err) { return { error: err instanceof Error ? err.message : 'Could not start' } }
}

/** The page polls this while her photos are being worked through. */
export async function nudgeMyQueue(): Promise<{ remaining: number }> {
  const c = await requireClient()
  if (!c.owner) return { remaining: 0 }
  const r = await processWardrobeQueue(40_000)
  revalidatePath(PATH)
  return { remaining: r.remaining }
}

export async function approveMine(extractionId: string, edits: ExtractionEdits): Promise<{ itemId?: string; error?: string }> {
  const c = await requireClient()
  if (!c.owner) return { error: c.error! }
  const r = await approveExtraction(extractionId, edits, { allowedOwners: [c.owner] })
  revalidatePath(PATH)
  return r
}

export async function discardMine(extractionId: string): Promise<{ error?: string }> {
  const c = await requireClient()
  if (!c.owner) return { error: c.error! }
  const admin = createAdminClient() as any
  const { data: x } = await admin.from('wardrobe_extraction').select('owner_user_id, owner_kind').eq('extraction_id', extractionId).single()
  if (!x || x.owner_user_id !== c.owner.id || x.owner_kind !== 'auth_user') return { error: 'Not yours' }
  const r = await discardExtraction(extractionId)
  revalidatePath(PATH)
  return r
}

export async function regenerateMine(extractionId: string, direction: string | null): Promise<{ error?: string }> {
  const c = await requireClient()
  if (!c.owner) return { error: c.error! }
  const admin = createAdminClient() as any
  const { data: x } = await admin.from('wardrobe_extraction').select('owner_user_id, owner_kind').eq('extraction_id', extractionId).single()
  if (!x || x.owner_user_id !== c.owner.id || x.owner_kind !== 'auth_user') return { error: 'Not yours' }
  const r = await requestRegenerate(extractionId, direction)
  if (!r.error) { try { waitUntil(processWardrobeQueue(45_000).catch(() => undefined)) } catch { /* local */ } }
  revalidatePath(PATH)
  return r
}

export async function updateMine(itemId: string, patch: { estimated_value?: number | null; brand_name?: string | null }): Promise<{ error?: string }> {
  const c = await requireClient()
  if (!c.owner) return { error: c.error! }
  const r = await updateOwnedItem(itemId, patch, [c.owner])
  revalidatePath(PATH)
  return r
}

export async function deleteMyItem(itemId: string): Promise<{ error?: string }> {
  const c = await requireClient()
  if (!c.owner) return { error: c.error! }
  const r = await deleteOwnedItem(itemId, [c.owner])
  if (r.error) return r
  await rebuildLooksWithoutItems([itemId])
  revalidatePath(PATH)
  return {}
}

/** Her photo, her call: the original goes, so do its pieces, and looks that used them are rebuilt. */
export async function deleteMyPhoto(photoId: string): Promise<{ error?: string; removed?: number }> {
  const c = await requireClient()
  if (!c.owner) return { error: c.error! }
  const r = await deletePhoto(photoId, [c.owner])
  if (r.error) return { error: r.error }
  await rebuildLooksWithoutItems(r.removedItemIds ?? [])
  revalidatePath(PATH)
  return { removed: r.removedItemIds?.length ?? 0 }
}
