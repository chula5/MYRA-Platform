// MEMBER AVATAR — her pieces on her avatar.
//
//   layer   one piece, one way: shot on her base with Nano Banana, the garment painted
//           magenta in a second pass, the dressed pixels under the magenta kept as a
//           see-through webp. Outerwear also gets an opening mask (where a top underneath
//           may show). Every layer shares the base picture's size, so they stack by CSS.
//   finish  the stacked layers of a look, re-rendered as one real photograph.
//
// Both run from the job drainer (jobs.ts) and record what they cost.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { AVATAR_CONFIG } from './config'
import { generateGoogleImage, googleCostGbp, GoogleImageError, type ImageRef, type GenResult } from './google'
import { dressPrompt, magentaPrompt, finishPrompt } from './prompts'
import { toJpeg, toRaw, cutLayer, openingMask } from './image-ops'
import { getAvatar, keepPicture, addCost } from './store'

const admin = () => createAdminClient() as any
const png = (bytes: Buffer): ImageRef => ({ bytes, mime: 'image/png' })
const jpg = (bytes: Buffer): ImageRef => ({ bytes, mime: 'image/jpeg' })

/**
 * Nano Banana first; when Google's shared capacity for it is saturated (429 with the project's
 * own quota untouched, seen 2026-11-09) the Pro model takes the shot at about three times the
 * price rather than leaving her waiting. Returns the result and the model that made it.
 */
async function dressCall(prompt: string, images: ImageRef[]): Promise<{ r: GenResult; model: string }> {
  const first = AVATAR_CONFIG.dressModel
  try {
    return { r: await generateGoogleImage({ model: first, prompt, images }), model: first }
  } catch (e) {
    if (!(e instanceof GoogleImageError) || e.status !== 429 || !AVATAR_CONFIG.fallbackToPro) throw e
    const second = AVATAR_CONFIG.bodyModel
    return { r: await generateGoogleImage({ model: second, prompt, images }), model: second }
  }
}

export interface AvatarWay {
  way_key: string
  item_types: string[]
  label: string
  shoot_prompt: string
  mask_prompt: string
  z: number
  needs_way: string | null
  cinches: string | null
  is_default: boolean
  default_rule: Record<string, unknown> | null
  active: boolean
  sort: number
}

export interface AvatarLayer {
  layer_id: string
  avatar_id: string
  item_id: string
  way_key: string
  base_way_key: string | null
  status: 'queued' | 'shooting' | 'masking' | 'ready' | 'failed'
  shot_url: string | null
  mask_url: string | null
  layer_url: string | null
  clip_url: string | null
  width: number | null
  height: number | null
  attempts: number
  error: string | null
  cost_gbp: number
}

export async function listWays(): Promise<AvatarWay[]> {
  const { data } = await admin().from('avatar_way').select('*').eq('active', true).order('sort', { ascending: true })
  return (data ?? []) as AvatarWay[]
}

/** The family a way belongs to: 'top', 'outer', 'scarf'… (the part before the dot). */
export const wayFamily = (wayKey: string) => wayKey.split('.')[0]
export const OUTER_FAMILY = 'outer'

/** How the piece is named inside a prompt: "the navy floral wide-leg trousers (trousers)". */
export function pieceDescription(item: { product_name: string | null; item_type: string | null; colour_family?: string | null }): string {
  const name = (item.product_name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const type = (item.item_type ?? 'piece').replace(/_/g, ' ')
  if (!name) return `${item.colour_family ?? ''} ${type}`.trim()
  return name.includes(type.split(' ').pop() ?? '') ? name : `${name} (${type})`
}

async function fetchBytes(url: string): Promise<Buffer> {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`fetch ${r.status} ${url}`)
  return Buffer.from(await r.arrayBuffer())
}

async function setLayer(layerId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin().from('avatar_layer').update({ ...patch, updated_at: new Date().toISOString() }).eq('layer_id', layerId)
  if (error) throw new Error(`avatar_layer update: ${error.message}`)
}

/** Shoot one piece one way on her base and cut it into a layer. Idempotent on the layer row. */
export async function runLayerStep(layerId: string, heartbeat?: () => void): Promise<void> {
  const a = admin()
  const { data: layer } = await a.from('avatar_layer').select('*').eq('layer_id', layerId).maybeSingle()
  if (!layer) throw new Error('layer gone')
  if (layer.status === 'ready') return
  const [avatar, { data: item }, { data: way }] = await Promise.all([
    getAvatar(layer.avatar_id),
    a.from('item').select('item_id, product_name, item_type, colour_family, image_url').eq('item_id', layer.item_id).maybeSingle(),
    a.from('avatar_way').select('*').eq('way_key', layer.way_key).maybeSingle(),
  ])
  if (!avatar?.base_url) throw new Error('avatar has no base picture')
  if (!item?.image_url) throw new Error('piece has no picture')
  if (!way) throw new Error(`way ${layer.way_key} missing`)
  const piece = pieceDescription(item)
  let cost = 0

  // 1. dress her
  await setLayer(layerId, { status: 'shooting', error: null })
  heartbeat?.()
  const [base, product] = await Promise.all([fetchBytes(avatar.base_url), fetchBytes(item.image_url).then((b) => toJpeg(b, 1024, 90))])
  const shotCall = await dressCall(dressPrompt((way as AvatarWay).shoot_prompt.replace(/\{piece\}/g, piece)), [png(base), jpg(product)])
  const shot = shotCall.r
  cost += googleCostGbp(shot, shotCall.model)

  // 2. mark the garment
  await setLayer(layerId, { status: 'masking' })
  heartbeat?.()
  const maskCall = await dressCall(magentaPrompt((way as AvatarWay).mask_prompt.replace(/\{piece\}/g, piece)), [png(shot.png)])
  const mask = maskCall.r
  cost += googleCostGbp(mask, maskCall.model)

  // 3. cut, and check the model actually dressed her
  heartbeat?.()
  const cut = await cutLayer(shot.png, mask.png)
  await addCost(avatar.avatar_id, cost)
  await a.from('avatar_layer').update({ cost_gbp: Number(layer.cost_gbp ?? 0) + cost }).eq('layer_id', layerId)
  if (cut.coverage < 0.004) throw new Error('the piece did not appear on the avatar')
  if (cut.coverage > 0.6) throw new Error('the mask covered the whole picture')

  // 4. outerwear: where a top underneath may show
  let clipUrl: string | null = null
  if (wayFamily(layer.way_key) === OUTER_FAMILY) {
    const clip = await openingMask(cut.webp)
    clipUrl = await keepPicture(avatar.member_id, `clip-${layer.item_id.slice(0, 8)}-${layer.way_key}`, clip, 'image/webp')
  }
  const [shotUrl, layerUrl] = await Promise.all([
    keepPicture(avatar.member_id, `shot-${layer.item_id.slice(0, 8)}-${layer.way_key}`, await toJpeg(shot.png, 1200, 88), 'image/jpeg'),
    keepPicture(avatar.member_id, `layer-${layer.item_id.slice(0, 8)}-${layer.way_key}`, cut.webp, 'image/webp'),
  ])
  await setLayer(layerId, { status: 'ready', shot_url: shotUrl, layer_url: layerUrl, clip_url: clipUrl, width: cut.width, height: cut.height, error: null })
}

// ── Finish ──────────────────────────────────────────────────────────────────

export interface LookItem { item_id: string; way_key: string }

/**
 * Stack layers onto the base the way the room does: by z, a top or scarf under a worn
 * jacket trimmed to the jacket's opening mask. Returns a PNG at the base's size.
 */
export async function composeStack(basePng: Buffer, layers: { webp: Buffer; z: number; family: string }[], clip?: Buffer): Promise<Buffer> {
  const m: any = await import('sharp'); const sharp = (m.default ?? m) as typeof import('sharp').default
  const baseDims = await sharp(basePng).metadata()
  const W = baseDims.width ?? 0, H = baseDims.height ?? 0
  let clipAlpha: Uint8Array | null = null
  if (clip) {
    const c = await sharp(clip).resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
    clipAlpha = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) clipAlpha[i] = c.data[i * c.info.channels + c.info.channels - 1]
  }
  const ops: { input: Buffer; left: number; top: number }[] = []
  for (const l of [...layers].sort((a, b) => a.z - b.z)) {
    let input = await sharp(l.webp).resize(W, H, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
    if (clipAlpha && (l.family === 'top' || l.family === 'scarf') && l.z < 8) {
      for (let i = 0; i < W * H; i++) input[i * 4 + 3] = Math.round((input[i * 4 + 3] * clipAlpha[i]) / 255)
    }
    ops.push({ input: await sharp(input, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer(), left: 0, top: 0 })
  }
  return sharp(basePng).composite(ops).png().toBuffer()
}

/** One real photograph of a look from its layers. Idempotent on the look row. */
export async function runFinishStep(lookId: string, heartbeat?: () => void): Promise<void> {
  const a = admin()
  const { data: look } = await a.from('avatar_look').select('*').eq('look_id', lookId).maybeSingle()
  if (!look) throw new Error('look gone')
  if (look.finish_status === 'done' && look.finish_url) return
  const avatar = await getAvatar(look.avatar_id)
  if (!avatar?.base_url) throw new Error('avatar has no base picture')
  const items = (look.items ?? []) as LookItem[]
  if (!items.length) throw new Error('empty look')
  await a.from('avatar_look').update({ finish_status: 'rendering' }).eq('look_id', lookId)

  const [{ data: layers }, { data: ways }, { data: pieces }] = await Promise.all([
    a.from('avatar_layer').select('item_id, way_key, layer_url, clip_url').eq('avatar_id', avatar.avatar_id).eq('status', 'ready').in('item_id', items.map((i) => i.item_id)),
    a.from('avatar_way').select('way_key, z, label'),
    a.from('item').select('item_id, product_name, item_type, colour_family, image_url').in('item_id', items.map((i) => i.item_id)),
  ])
  const wayZ = new Map<string, { z: number; label: string }>((ways ?? []).map((w: any) => [w.way_key, { z: w.z, label: w.label }]))
  const pieceById = new Map<string, any>((pieces ?? []).map((p: any) => [p.item_id, p]))
  heartbeat?.()
  const base = await fetchBytes(avatar.base_url)
  const stack: { webp: Buffer; z: number; family: string }[] = []
  let clip: Buffer | undefined
  const arrangement: string[] = []
  const productRefs: ImageRef[] = []
  for (const it of items) {
    const row = (layers ?? []).find((l: any) => l.item_id === it.item_id && l.way_key === it.way_key)
    if (!row?.layer_url) throw new Error(`layer not ready: ${it.way_key}`)
    const w = wayZ.get(it.way_key)
    stack.push({ webp: await fetchBytes(row.layer_url), z: w?.z ?? 5, family: wayFamily(it.way_key) })
    if (wayFamily(it.way_key) === OUTER_FAMILY && row.clip_url) clip = await fetchBytes(row.clip_url)
    const p = pieceById.get(it.item_id)
    if (p) {
      arrangement.push(`${pieceDescription(p)} worn ${(w?.label ?? 'as shown').toLowerCase()}`)
      if (p.image_url && productRefs.length < 5) productRefs.push(jpg(await toJpeg(await fetchBytes(p.image_url), 768, 85)))
    }
  }
  heartbeat?.()
  const stacked = await composeStack(base, stack, clip)
  heartbeat?.()
  const outCall = await dressCall(finishPrompt(`The arrangement: ${arrangement.join('; ')}.`), [png(stacked), ...productRefs])
  const out = outCall.r
  const cost = googleCostGbp(out, outCall.model)
  await addCost(avatar.avatar_id, cost)
  const url = await keepPicture(avatar.member_id, `finish-${lookId.slice(0, 8)}`, await toJpeg(out.png, 1600, 90), 'image/jpeg')
  await a.from('avatar_look').update({ finish_status: 'done', finish_url: url }).eq('look_id', lookId)
  await a.from('avatar_look').update({ cost_gbp: Number(look.cost_gbp ?? 0) + cost }).eq('look_id', lookId).then(() => undefined, () => undefined)   // column arrives with 0121
}
