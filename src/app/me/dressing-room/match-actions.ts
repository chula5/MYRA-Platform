'use server'

// FIND PIECES LIKE THIS — from one of her pictures, or from a photograph she
// uploads. Reads only: matching shows her what the library holds nearest a
// look. Every action resolves the member on the server (her session, or the
// member Chloe names from HER VIEW, admin only).

import { resolveClientMember } from '@/lib/client-member'
import { createAdminClient } from '@/lib/supabase-server'
import { matchItems, matchOutfits, vectorForPicture, type MatchedItem, type MatchedOutfit } from '@/lib/look-match'
import { buildOutfitVector } from '@/lib/taste-vector'
import { analyseOutfit } from '@/app/admin/ai/analyse-outfit'
import { photoHasOutfit } from '@/lib/archival/outfit-gate'
import { addPhotoToBatch, createBatch, signedPhotoUrls } from '@/lib/wardrobe/store'
import type { OwnerRef } from '@/lib/wardrobe/types'

export interface MatchView {
  items: MatchedItem[]
  outfits: MatchedOutfit[]
  /** What MYRA saw in the picture, in a line — only for an uploaded photo. */
  read?: string | null
  error?: string
}

const EMPTY: MatchView = { items: [], outfits: [] }

/** Pieces and outfits closest to one of her own pictures. */
export async function matchMyPicture(
  kind: 'inspiration' | 'archival',
  id: string,
  opts: { types?: string[]; asMemberId?: string } = {},
): Promise<MatchView> {
  const me = await resolveClientMember(opts.asMemberId)
  if (!me) return { ...EMPTY, error: 'Not signed in' }
  const vector = await vectorForPicture(kind, id)
  if (!vector) return { ...EMPTY, error: 'MYRA has not read this picture yet — give it a minute and try again.' }
  const owners = [me.memberId, me.authUserId].filter(Boolean) as string[]
  const [items, outfits] = await Promise.all([
    matchItems(vector, { types: opts.types, owners, limit: 24 }),
    matchOutfits(vector, 6),
  ])
  return { items, outfits }
}

/**
 * She uploads a photograph — a shop window, a friend, a magazine page — and
 * MYRA finds what it holds that is closest. The photo is read once (one vision
 * call) and kept as her own, so the read is never paid for twice.
 */
export async function matchUploadedPhoto(formData: FormData): Promise<MatchView> {
  const me = await resolveClientMember(String(formData.get('member') ?? '') || undefined)
  if (!me) return { ...EMPTY, error: 'Not signed in' }
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { ...EMPTY, error: 'Choose a picture first' }
  if (!file.type.startsWith('image/')) return { ...EMPTY, error: 'That is not an image' }

  const bytes = Buffer.from(await file.arrayBuffer())
  if (!(await photoHasOutfit(bytes))) return { ...EMPTY, error: 'MYRA cannot see an outfit in that picture — try one showing the clothes.' }

  const owner: OwnerRef = { kind: 'pilot_member', id: me.memberId }
  const admin = createAdminClient() as any
  let batchId: string | null = null
  try {
    const { data } = await admin.from('wardrobe_batch').select('batch_id').eq('owner_user_id', me.memberId).eq('label', 'Match a picture').order('created_at', { ascending: false }).limit(1)
    batchId = data?.[0]?.batch_id ?? (await createBatch(owner, 'client', 'Match a picture')).batch_id
  } catch { batchId = null }

  // Kept, not searched for garments: this is a picture to match, not her wardrobe.
  const added = await addPhotoToBatch(batchId, owner, { bytes, name: file.name, mime: file.type }, { detect: false })
  if (!added.photo) return { ...EMPTY, error: added.error ?? 'Could not read that picture' }
  const urls = await signedPhotoUrls([added.photo.storage_path])
  const url = urls.get(added.photo.storage_path)
  if (!url) return { ...EMPTY, error: 'Could not read that picture' }

  const a = await analyseOutfit(url)
  if (!a.data) return { ...EMPTY, error: a.error ?? 'MYRA could not read that picture' }
  let vector: number[] | null = null
  try {
    vector = buildOutfitVector({ ...(a.data as any), occasion_tags: (a.data as any).occasion_tags ?? [], outfit_item: [] } as any)
  } catch { vector = null }
  if (!vector) return { ...EMPTY, error: 'MYRA could not place that picture' }

  const owners = [me.memberId, me.authUserId].filter(Boolean) as string[]
  const [items, outfits] = await Promise.all([
    matchItems(vector, { owners, limit: 24 }),
    matchOutfits(vector, 6),
  ])
  const d = a.data as any
  const pieces = ((d.detected_items ?? []) as any[]).map((p) => p?.description).filter(Boolean).slice(0, 3)
  return { items, outfits, read: [d.aesthetic_label, ...pieces].filter(Boolean).join(' · ') || null }
}
