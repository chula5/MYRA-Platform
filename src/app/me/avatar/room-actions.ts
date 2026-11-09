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
