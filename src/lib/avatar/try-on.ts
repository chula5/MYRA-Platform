// MEMBER AVATAR — try on a piece she does not own.
//
// Her wardrobe room dresses the avatar in what she owns. This is the same
// machinery pointed at a piece she is only looking at: a shop's product in the
// Mirror, a piece in a look MYRA has just built, anything in the app. One
// piece = one layer shot on her base (the picture shown is that shot: her, in
// the piece). A whole look = a layer per piece, then the finish pass, exactly
// as the room's Finish button does it.
//
// Nothing is made until she asks (a tap, never a hover): a layer is a paid
// picture. Asking twice is free, since the layer and the look are kept.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { liveAvatarFor, type MemberAvatar } from './store'
import { listWays, wayFamily, type AvatarWay, type LookItem } from './layers'
import { enqueueAvatarJob, kickAvatarDrain } from './jobs'

const admin = () => createAdminClient() as any

export type TryOnState =
  | 'no_avatar'     // she has not made (or finished) her avatar
  | 'unwearable'    // nothing here the avatar can put on (a bag, jewellery)
  | 'idle'          // not asked for yet
  | 'making'
  | 'ready'
  | 'failed'

export interface TryOn {
  state: TryOnState
  image_url?: string | null
  /** Steps finished and steps in all, while it is being made. */
  done?: number
  total?: number
  message?: string
}

const NO_AVATAR: TryOn = { state: 'no_avatar', message: 'Make your avatar in MYRA first' }
const BOTTOMS_THAT_TUCK = new Set(['trousers', 'jeans', 'shorts', 'culottes'])

async function readyAvatar(memberId: string): Promise<MemberAvatar | null> {
  const avatar = await liveAvatarFor(memberId)
  return avatar && avatar.status === 'ready' && avatar.base_url ? avatar : null
}

/** The way a piece is worn when nobody has said: the type's default, else its first. */
function defaultWay(ways: AvatarWay[], itemType: string | null | undefined): AvatarWay | null {
  if (!itemType) return null
  const fits = ways.filter((w) => w.item_types.includes(itemType) && !w.needs_way)
  return fits.find((w) => w.is_default) ?? fits[0] ?? null
}

interface LayerRow { layer_id: string; item_id: string; way_key: string; status: string; shot_url: string | null; error: string | null }

/** The layer row for a piece worn one way: made and queued at the front when `start`, read otherwise. */
async function layerFor(avatar: MemberAvatar, itemId: string, wayKey: string, start: boolean): Promise<LayerRow | null> {
  const a = admin()
  const cols = 'layer_id, item_id, way_key, status, shot_url, error'
  const { data: existing } = await a.from('avatar_layer').select(cols).eq('avatar_id', avatar.avatar_id).eq('item_id', itemId).eq('way_key', wayKey).maybeSingle()
  if (!start) return (existing as LayerRow) ?? null
  let layer = existing as LayerRow | null
  if (!layer) {
    const { data: made, error } = await a.from('avatar_layer')
      .upsert({ avatar_id: avatar.avatar_id, item_id: itemId, way_key: wayKey }, { onConflict: 'avatar_id,item_id,way_key' }).select(cols).maybeSingle()
    if (error || !made) throw new Error(error?.message ?? 'Could not queue it')
    layer = made as LayerRow
  }
  if (layer.status === 'ready') return layer
  if (layer.status === 'failed') {
    await a.from('avatar_layer').update({ status: 'queued', attempts: 0, error: null, updated_at: new Date().toISOString() }).eq('layer_id', layer.layer_id)
    layer = { ...layer, status: 'queued', error: null }
  }
  // She is waiting: an open job jumps the queue, otherwise a new one at the front.
  const { data: bumped } = await a.from('avatar_job').update({ priority: 1 }).eq('kind', 'layer').eq('ref_id', layer.layer_id).in('status', ['queued', 'running']).select('job_id')
  if (!bumped?.length) await enqueueAvatarJob('layer', layer.layer_id, avatar.member_id, 1)
  return layer
}

/** One piece on her avatar. `start` false only reports what is already there. */
export async function tryOnPiece(memberId: string, itemId: string, opts: { start?: boolean } = {}): Promise<TryOn> {
  const avatar = await readyAvatar(memberId)
  if (!avatar) return NO_AVATAR
  const [{ data: item }, ways] = await Promise.all([
    admin().from('item').select('item_id, item_type, image_url').eq('item_id', itemId).maybeSingle(),
    listWays(),
  ])
  if (!item) return { state: 'failed', message: 'MYRA cannot find that piece' }
  const way = defaultWay(ways, item.item_type)
  if (!way) return { state: 'unwearable', message: 'The avatar cannot wear this kind of piece yet' }
  if (!item.image_url) return { state: 'failed', message: 'No picture of this piece to work from' }
  const layer = await layerFor(avatar, itemId, way.way_key, !!opts.start)
  if (!layer) return { state: 'idle' }
  if (layer.status === 'ready' && layer.shot_url) return { state: 'ready', image_url: layer.shot_url }
  if (layer.status === 'failed') return { state: 'failed', message: layer.error ?? 'That did not work — try again' }
  kickAvatarDrain()
  return { state: 'making', done: layer.status === 'masking' ? 1 : 0, total: 2 }
}

/**
 * A whole look on her avatar: each wearable piece as a layer, then one finished
 * photograph. Called again (start false) to poll; it moves the look on to its
 * finish pass the moment the last layer lands.
 */
export async function tryOnLook(memberId: string, itemIds: string[], opts: { start?: boolean } = {}): Promise<TryOn> {
  const avatar = await readyAvatar(memberId)
  if (!avatar) return NO_AVATAR
  const a = admin()
  const ids = Array.from(new Set(itemIds)).slice(0, 12)
  if (!ids.length) return { state: 'unwearable', message: 'Nothing in this look for the avatar to wear' }
  const [{ data: items }, ways] = await Promise.all([
    a.from('item').select('item_id, item_type, image_url').in('item_id', ids),
    listWays(),
  ])
  const byId = new Map<string, any>(((items ?? []) as any[]).map((i) => [i.item_id, i]))
  const tucks = ids.some((id) => BOTTOMS_THAT_TUCK.has(byId.get(id)?.item_type))
  // One piece per place on the body, in the look's own order: the stack has
  // one top, one bottom, one coat. A second knit over the shirt is left off
  // rather than drawn through it.
  const worn: LookItem[] = []
  const families = new Set<string>()
  for (const id of ids) {
    const it = byId.get(id)
    if (!it?.image_url) continue
    let way = defaultWay(ways, it.item_type)
    if (!way) continue
    // A top goes into trousers; over a skirt, or with nothing below, it hangs.
    if (wayFamily(way.way_key) === 'top' && tucks) way = ways.find((w) => w.way_key === 'top.tucked' && w.item_types.includes(it.item_type)) ?? way
    const family = wayFamily(way.way_key)
    if (families.has(family)) continue
    families.add(family)
    worn.push({ item_id: id, way_key: way.way_key })
  }
  if (!worn.length) return { state: 'unwearable', message: 'Nothing in this look for the avatar to wear' }

  const signature = worn.map((w) => `${w.item_id}:${w.way_key}`).sort().join('|')
  const { data: found } = await a.from('avatar_look').select('look_id, finish_url, finish_status')
    .eq('avatar_id', avatar.avatar_id).eq('source', 'styled_way').eq('source_id', signature).order('created_at', { ascending: true }).limit(1)
  let look = found?.[0] as { look_id: string; finish_url: string | null; finish_status: string | null } | undefined
  if (look?.finish_status === 'done' && look.finish_url) return { state: 'ready', image_url: look.finish_url }
  if (!look && !opts.start) return { state: 'idle' }
  const total = worn.length + 1

  const layers = await Promise.all(worn.map((w) => layerFor(avatar, w.item_id, w.way_key, !!opts.start)))
  if (!look) {
    const { data: made, error } = await a.from('avatar_look')
      .insert({ avatar_id: avatar.avatar_id, member_id: avatar.member_id, items: worn, source: 'styled_way', source_id: signature }).select('look_id, finish_url, finish_status').maybeSingle()
    if (error || !made) return { state: 'failed', message: error?.message ?? 'Could not start it' }
    look = made
  }
  const failed = layers.find((l) => l?.status === 'failed')
  if (failed) return { state: 'failed', message: failed.error ?? 'One of the pieces would not go on — try again' }
  const ready = layers.filter((l) => l?.status === 'ready').length
  if (ready < worn.length) {
    kickAvatarDrain()
    return { state: 'making', done: ready, total }
  }
  // Every piece is on: one real photograph of the lot.
  if (look!.finish_status === 'failed' && !opts.start) return { state: 'failed', message: 'The picture did not come out — try again' }
  if (!look!.finish_status || look!.finish_status === 'failed') {
    await a.from('avatar_look').update({ finish_status: 'queued' }).eq('look_id', look!.look_id)
    await enqueueAvatarJob('finish', look!.look_id, avatar.member_id, 1)
  }
  kickAvatarDrain()
  return { state: 'making', done: worn.length, total }
}
