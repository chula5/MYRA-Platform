'use server'

// MEMBER AVATAR — the room's actions. Every export is public (server-action-gating): each
// resolves the member first and touches only her avatar's rows.

import { revalidatePath } from 'next/cache'
import { resolveClientMember } from '@/lib/client-member'
import { liveAvatarFor } from '@/lib/avatar/store'
import { enqueueAvatarJob, kickAvatarDrain } from '@/lib/avatar/jobs'
import { loadRoom, queueWardrobeLayers, retryFailedLayers, type RoomView } from '@/lib/avatar/wardrobe'
import { createAdminClient } from '@/lib/supabase-server'

const PATH = '/me/avatar'

type Ready = { error: string } | { error?: undefined; m: NonNullable<Awaited<ReturnType<typeof resolveClientMember>>>; avatar: NonNullable<Awaited<ReturnType<typeof liveAvatarFor>>> }

async function myReadyAvatar(): Promise<Ready> {
  const m = await resolveClientMember()
  if (!m) return { error: 'Not signed in' }
  const avatar = await liveAvatarFor(m.memberId)
  if (!avatar || avatar.status !== 'ready' || !avatar.base_url) return { error: 'Your avatar is not ready yet' }
  return { m, avatar }
}

export async function loadMyRoom(): Promise<RoomView | { error: string }> {
  const r = await myReadyAvatar()
  if (r.error !== undefined) return { error: r.error }
  return loadRoom(r.avatar)
}

/** New pieces in her wardrobe join the queue; anything queued gets a drain started. */
export async function nudgeMyWardrobe(): Promise<{ added: number; error?: string }> {
  const r = await myReadyAvatar()
  if (r.error !== undefined) return { added: 0, error: r.error }
  const added = await queueWardrobeLayers(r.avatar)
  const { count } = await (createAdminClient() as any).from('avatar_job').select('job_id', { count: 'exact', head: true }).eq('member_id', r.m.memberId).eq('status', 'queued')
  if (added || (count ?? 0) > 0) kickAvatarDrain()
  return { added }
}

export async function retryMyLayers(): Promise<{ retried: number; error?: string }> {
  const r = await myReadyAvatar()
  if (r.error !== undefined) return { retried: 0, error: r.error }
  const retried = await retryFailedLayers(r.avatar)
  if (retried) kickAvatarDrain()
  return { retried }
}

/** She pressed Finish: keep the look and render it as one photograph. */
export async function finishMyLook(items: { item_id: string; way_key: string }[], name?: string): Promise<{ lookId?: string; error?: string }> {
  const r = await myReadyAvatar()
  if (r.error !== undefined) return { error: r.error }
  const clean = items.filter((i) => typeof i.item_id === 'string' && typeof i.way_key === 'string').slice(0, 8)
  if (!clean.length) return { error: 'Put something on first' }
  const a = createAdminClient() as any
  const row: Record<string, unknown> = { avatar_id: r.avatar.avatar_id, member_id: r.m.memberId, items: clean, finish_status: 'queued', source: 'built' }
  if (name) row.name = name.slice(0, 80)   // column arrives with 0121; only sent when there is one
  const { data, error } = await a.from('avatar_look').insert(row).select('look_id').single()
  if (error || !data) return { error: error?.message ?? 'Could not keep the look' }
  await enqueueAvatarJob('finish', data.look_id, r.m.memberId, 1)
  kickAvatarDrain()
  revalidatePath(PATH)
  return { lookId: data.look_id }
}

export async function deleteMyLook(lookId: string): Promise<{ error?: string }> {
  const r = await myReadyAvatar()
  if (r.error !== undefined) return { error: r.error }
  await (createAdminClient() as any).from('avatar_look').delete().eq('look_id', lookId).eq('member_id', r.m.memberId)
  revalidatePath(PATH)
  return {}
}

/** She tapped a way that has not been shot yet: shoot it now, ahead of the warm-up queue. */
export async function shootMyWay(itemId: string, wayKey: string): Promise<{ error?: string }> {
  const r = await myReadyAvatar()
  if (r.error !== undefined) return { error: r.error }
  const a = createAdminClient() as any
  const { data: way } = await a.from('avatar_way').select('way_key, item_types').eq('way_key', wayKey).eq('active', true).maybeSingle()
  const { data: item } = await a.from('item').select('item_id, item_type').eq('item_id', itemId).maybeSingle()
  if (!way || !item || !way.item_types.includes(item.item_type)) return { error: 'That way does not fit this piece' }
  const { data: layer, error } = await a.from('avatar_layer').upsert({ avatar_id: r.avatar.avatar_id, item_id: itemId, way_key: wayKey }, { onConflict: 'avatar_id,item_id,way_key' }).select('layer_id, status').single()
  if (error || !layer) return { error: error?.message ?? 'Could not queue it' }
  if (layer.status === 'ready') return {}
  if (layer.status === 'failed') await a.from('avatar_layer').update({ status: 'queued', attempts: 0, error: null, updated_at: new Date().toISOString() }).eq('layer_id', layer.layer_id)
  // an open job jumps the queue; otherwise a new one at the front
  const { data: bumped } = await a.from('avatar_job').update({ priority: 1 }).eq('kind', 'layer').eq('ref_id', layer.layer_id).in('status', ['queued', 'running']).select('job_id')
  if (!bumped?.length) await enqueueAvatarJob('layer', layer.layer_id, r.m.memberId, 1)
  kickAvatarDrain()
  return {}
}

/** A piece came out wrong: shoot every one of its ways again, ahead of the queue. */
export async function reshootMyPiece(itemId: string): Promise<{ error?: string }> {
  const r = await myReadyAvatar()
  if (r.error !== undefined) return { error: r.error }
  const a = createAdminClient() as any
  const { data: layers } = await a.from('avatar_layer').select('layer_id').eq('avatar_id', r.avatar.avatar_id).eq('item_id', itemId)
  if (!layers?.length) return { error: 'Nothing shot for this piece yet' }
  const ids = layers.map((l: any) => l.layer_id)
  await a.from('avatar_layer').update({ status: 'queued', attempts: 0, error: null, updated_at: new Date().toISOString() }).in('layer_id', ids)
  // the stored fit note is read again too
  const { data: it } = await a.from('item').select('owned_metadata').eq('item_id', itemId).maybeSingle()
  if (it?.owned_metadata?.avatar_fit_note) { const md = { ...it.owned_metadata }; delete md.avatar_fit_note; await a.from('item').update({ owned_metadata: md }).eq('item_id', itemId) }
  for (const id of ids) {
    const { data: bumped } = await a.from('avatar_job').update({ priority: 1 }).eq('kind', 'layer').eq('ref_id', id).in('status', ['queued', 'running']).select('job_id')
    if (!bumped?.length) await enqueueAvatarJob('layer', id, r.m.memberId, 1)
  }
  kickAvatarDrain()
  return {}
}
