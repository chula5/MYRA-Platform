'use server'

// STYLE INFLUENCES — admin. Every export starts with assertAdmin(): a
// 'use server' export is callable by anyone from the browser.

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { assertAdmin } from '@/lib/admin-audit'
import { picturesFromForm, intakePictures } from '@/lib/picture-intake'
import { forgetMemberMemory } from '@/lib/member-memory'
import { scorePendingInfluenceImages, recomputeInfluenceEnvelope } from '@/lib/style-influence-store'
import { parseInfluenceBrief, slugify, type InfluenceBrief, type InfluenceKind, type InfluenceStatus } from '@/lib/style-influence'

const PATH = '/admin/influences'

export interface InfluenceImageView {
  image_id: string
  image_url: string
  status: 'pending_scoring' | 'scored' | 'rejected'
  formality: number | null
  item_types: string[]
  scoring_error: string | null
}

export async function createInfluence(name: string, kind: InfluenceKind = 'celebrity'): Promise<{ id?: string; error?: string }> {
  await assertAdmin()
  const clean = name.trim()
  if (!clean) return { error: 'Type a name first' }
  const admin = createAdminClient() as any
  const slug = slugify(clean)
  const { data: existing } = await admin.from('style_influence').select('influence_id').eq('slug', slug).maybeSingle()
  if (existing) return { id: existing.influence_id }
  const { data, error } = await admin.from('style_influence')
    .insert({ name: clean, slug, kind }).select('influence_id').single()
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return { id: data.influence_id }
}

export async function updateInfluence(id: string, patch: {
  name?: string
  kind?: InfluenceKind
  handle?: string | null
  status?: InfluenceStatus
  image_url?: string | null
  brief?: InfluenceBrief
}): Promise<{ ok?: true; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) row.name = patch.name.trim()
  if (patch.kind) row.kind = patch.kind
  if (patch.handle !== undefined) row.handle = patch.handle?.trim() || null
  if (patch.status) row.status = patch.status
  if (patch.image_url !== undefined) row.image_url = patch.image_url
  if (patch.brief) row.brief = parseInfluenceBrief(patch.brief)
  const { error } = await admin.from('style_influence').update(row).eq('influence_id', id)
  if (error) return { error: error.message }
  await forgetLinkedMembers(admin, id)
  revalidatePath(PATH)
  return { ok: true }
}

export async function deleteInfluence(id: string): Promise<{ ok?: true; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  await forgetLinkedMembers(admin, id)
  const { error } = await admin.from('style_influence').delete().eq('influence_id', id)
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return { ok: true }
}

export async function loadInfluenceImages(id: string): Promise<InfluenceImageView[]> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data } = await admin.from('style_influence_image')
    .select('image_id, image_url, status, scores, scoring_error')
    .eq('influence_id', id).neq('status', 'rejected')
    .order('created_at', { ascending: true })
  return ((data ?? []) as any[]).map((r) => ({
    image_id: r.image_id,
    image_url: r.image_url,
    status: r.status,
    formality: r.scores?.formality ?? null,
    item_types: r.scores?.item_types ?? [],
    scoring_error: r.scoring_error ?? null,
  }))
}

/** Pasted screenshots, dropped files and links — hosted, then scored at once. */
export async function addInfluencePictures(formData: FormData): Promise<{ added?: number; failed?: number; error?: string }> {
  await assertAdmin()
  try {
    const id = String(formData.get('influenceId') ?? '')
    if (!id) return { error: 'No person chosen' }
    const folder = `influences/${id}`
    const { inputs, failed: unread } = await picturesFromForm(formData, folder)
    if (!inputs.length) return { added: 0, failed: unread, error: unread ? 'Could not save those pictures' : 'Paste, drop or link some pictures' }
    const { rows, failed: unsaved } = await intakePictures(inputs, folder)
    if (!rows.length) return { added: 0, failed: unread + unsaved, error: 'Could not save those pictures' }

    const admin = createAdminClient() as any
    const { error } = await admin.from('style_influence_image').insert(rows.map((r) => ({
      influence_id: id, image_url: r.image_url, source_url: r.source_url, status: 'pending_scoring',
    })))
    if (error) return { error: error.message }
    // The first picture becomes the portrait until Chloe picks another.
    const { data: person } = await admin.from('style_influence').select('image_url').eq('influence_id', id).maybeSingle()
    if (person && !person.image_url) await admin.from('style_influence').update({ image_url: rows[0].image_url }).eq('influence_id', id)
    await scorePendingInfluenceImages(admin, id, Math.max(40, rows.length))
    await forgetLinkedMembers(admin, id)
    revalidatePath(PATH)
    return { added: rows.length, failed: unread + unsaved }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not add those pictures' }
  }
}

export async function removeInfluenceImage(imageId: string): Promise<{ ok?: true; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data: row } = await admin.from('style_influence_image').select('influence_id').eq('image_id', imageId).maybeSingle()
  if (!row) return { error: 'Picture not found' }
  await admin.from('style_influence_image').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('image_id', imageId)
  await recomputeInfluenceEnvelope(admin, row.influence_id)
  await forgetLinkedMembers(admin, row.influence_id)
  revalidatePath(PATH)
  return { ok: true }
}

export async function linkInfluenceMember(influenceId: string, memberId: string): Promise<{ ok?: true; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { error } = await admin.from('member_style_influence')
    .upsert({ influence_id: influenceId, member_id: memberId, source: 'chloe' }, { onConflict: 'member_id,influence_id', ignoreDuplicates: true })
  if (error) return { error: error.message }
  forgetMemberMemory(memberId)
  revalidatePath(PATH)
  return { ok: true }
}

export async function unlinkInfluenceMember(influenceId: string, memberId: string): Promise<{ ok?: true; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { error } = await admin.from('member_style_influence').delete().eq('influence_id', influenceId).eq('member_id', memberId)
  if (error) return { error: error.message }
  forgetMemberMemory(memberId)
  revalidatePath(PATH)
  return { ok: true }
}

async function forgetLinkedMembers(admin: any, influenceId: string) {
  const { data } = await admin.from('member_style_influence').select('member_id').eq('influence_id', influenceId)
  for (const r of (data ?? []) as any[]) forgetMemberMemory(r.member_id)
}
