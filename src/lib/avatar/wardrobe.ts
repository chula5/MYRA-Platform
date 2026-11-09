// MEMBER AVATAR — her wardrobe, queued onto her avatar, and what the room needs to draw.
//
// Every owned piece whose type has a way gets a layer row per active way; defaults first
// (priority 2), the other ways after (priority 3). Rows already there are left alone, so this
// is safe to run on every room load: new pieces simply join the queue.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { listOwnedItems } from '@/lib/wardrobe/store'
import { ownerRefsForMember } from '@/lib/wardrobe/owned-items'
import { enqueueAvatarJob } from './jobs'
import { listWays, wayFamily, type AvatarWay, type AvatarLayer } from './layers'
import { updateAvatar, type MemberAvatar } from './store'

const admin = () => createAdminClient() as any

export interface RoomPiece {
  item_id: string
  name: string
  brand: string | null
  item_type: string
  family: string            // which shelf: top, bottom, dress, outer, scarf, belt, shoes
  image_url: string | null
  layers: { way_key: string; status: AvatarLayer['status']; layer_url: string | null; clip_url: string | null; error: string | null }[]
}

export interface RoomLook {
  look_id: string
  name: string | null
  items: { item_id: string; way_key: string }[]
  finish_url: string | null
  finish_status: string | null
  source: string
  created_at: string
}

export interface RoomView {
  avatar: { avatar_id: string; base_url: string; width: number | null; height: number | null }
  ways: AvatarWay[]
  pieces: RoomPiece[]
  looks: RoomLook[]
  progress: { ready: number; total: number; failed: number }
}

function waysForType(ways: AvatarWay[], itemType: string): AvatarWay[] {
  return ways.filter((w) => w.item_types.includes(itemType))
}

/** Her owned pieces that the avatar can wear (a way exists for their type). */
async function wearablePieces(member: { member_id: string; auth_user_id: string | null }, ways: AvatarWay[]) {
  const items = await listOwnedItems(ownerRefsForMember(member))
  return items.filter((it: any) => it.item_type && waysForType(ways, it.item_type).length > 0)
}

/** Make sure every wearable piece has a layer row per way, and a job for each new row. Returns how many were added. */
export async function queueWardrobeLayers(avatar: MemberAvatar): Promise<number> {
  const a = admin()
  const { data: member } = await a.from('pilot_member').select('member_id, auth_user_id').eq('member_id', avatar.member_id).maybeSingle()
  if (!member) return 0
  const ways = await listWays()
  const pieces = await wearablePieces(member, ways)
  const { data: existing } = await a.from('avatar_layer').select('item_id, way_key').eq('avatar_id', avatar.avatar_id)
  const have = new Set((existing ?? []).map((r: any) => `${r.item_id}|${r.way_key}`))
  const rows: { avatar_id: string; item_id: string; way_key: string }[] = []
  const prio: Record<string, 2 | 3> = {}
  for (const p of pieces) {
    for (const w of waysForType(ways, p.item_type)) {
      if (have.has(`${p.item_id}|${w.way_key}`)) continue
      rows.push({ avatar_id: avatar.avatar_id, item_id: p.item_id, way_key: w.way_key })
      prio[`${p.item_id}|${w.way_key}`] = w.is_default ? 2 : 3
    }
  }
  if (!rows.length) return 0
  const { data: inserted, error } = await a.from('avatar_layer').upsert(rows, { onConflict: 'avatar_id,item_id,way_key', ignoreDuplicates: true }).select('layer_id, item_id, way_key')
  if (error) throw new Error(`avatar_layer insert: ${error.message}`)
  for (const r of inserted ?? []) await enqueueAvatarJob('layer', r.layer_id, avatar.member_id, prio[`${r.item_id}|${r.way_key}`] ?? 3)
  // a bookkeeping stamp: never let it fail the queueing (0121 adds the column)
  await updateAvatar(avatar.avatar_id, { wardrobe_queued_at: new Date().toISOString() }).catch(() => undefined)
  return (inserted ?? []).length
}

/** A failed layer gets one more go. */
export async function retryFailedLayers(avatar: MemberAvatar): Promise<number> {
  const a = admin()
  const { data: failed } = await a.from('avatar_layer').select('layer_id').eq('avatar_id', avatar.avatar_id).eq('status', 'failed').lt('attempts', 4)
  for (const r of failed ?? []) {
    await a.from('avatar_layer').update({ status: 'queued', attempts: 0, error: null }).eq('layer_id', r.layer_id)
    await enqueueAvatarJob('layer', r.layer_id, avatar.member_id, 2)
  }
  return (failed ?? []).length
}

/** Everything the room draws. */
export async function loadRoom(avatar: MemberAvatar): Promise<RoomView> {
  const a = admin()
  const { data: member } = await a.from('pilot_member').select('member_id, auth_user_id').eq('member_id', avatar.member_id).maybeSingle()
  const ways = await listWays()
  const [items, { data: layers }, { data: looks }] = await Promise.all([
    member ? wearablePieces(member, ways) : Promise.resolve([]),
    a.from('avatar_layer').select('item_id, way_key, status, layer_url, clip_url, error').eq('avatar_id', avatar.avatar_id),
    a.from('avatar_look').select('*').eq('avatar_id', avatar.avatar_id).order('created_at', { ascending: false }).limit(30),
  ])
  const byItem = new Map<string, RoomPiece['layers']>()
  let ready = 0, failed = 0
  for (const l of layers ?? []) {
    const list = byItem.get(l.item_id) ?? []
    list.push({ way_key: l.way_key, status: l.status, layer_url: l.layer_url, clip_url: l.clip_url, error: l.error })
    byItem.set(l.item_id, list)
    if (l.status === 'ready') ready++; else if (l.status === 'failed') failed++
  }
  const pieces: RoomPiece[] = items.map((it: any) => ({
    item_id: it.item_id,
    name: it.product_name ?? 'Piece',
    brand: it.brand?.name ?? it.owned_metadata?.brand_label ?? null,
    item_type: it.item_type,
    family: wayFamily(waysForType(ways, it.item_type)[0].way_key),
    image_url: it.image_url ?? null,
    layers: byItem.get(it.item_id) ?? [],
  }))
  return {
    avatar: { avatar_id: avatar.avatar_id, base_url: avatar.base_url!, width: avatar.width, height: avatar.height },
    ways,
    pieces,
    looks: (looks ?? []) as RoomLook[],
    progress: { ready, total: (layers ?? []).length, failed },
  }
}
