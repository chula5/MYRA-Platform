// MYRA Mirror — SEE ON A MODEL.
//
// She is looking at a piece on a brand's site and wants to see it worn. The
// card asks here; the answer is one Higgsfield shoot of a fictional model in
// the piece (the same recipe as the studio's REFINED pose — lib/higgsfield-shoot),
// kept per item in mirror_model_shot (migration 0113) so the second person to
// ask, or the same person tomorrow, gets it at once.
//
// The renderer is the Higgsfield cloud API where HF_API_KEY_ID/SECRET are set
// (Vercel), else the Higgsfield CLI on Chloe's Mac (render-queue's
// rendererAvailable). Where either is present the shoot is made in the request
// (a minute or two); where neither is, the ask is queued and
// /api/cron/mirror-model-render, opened on a machine that has one, makes the
// picture. The extension polls until it is there.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { ensureMirrorItem, type SiteProduct } from '@/lib/mirror/style'
import type { MirrorMember } from '@/lib/mirror/auth'
import { rendererAvailable as cliAvailable } from '@/lib/studio/render-queue'
import { cloudRendererAvailable, runHiggsfieldCloudGeneration } from '@/lib/higgsfield-cloud'

/**
 * Which renderer this process has: the cloud API (works on Vercel, set by
 * HF_API_KEY_ID/SECRET), the CLI on the Mac, or neither. The CLI is preferred
 * where both exist — it is the studio's Seedream recipe — unless
 * HIGGSFIELD_PREFER_CLOUD=1.
 */
export function modelRenderer(): 'cli' | 'cloud' | null {
  const cli = cliAvailable()
  const cloud = cloudRendererAvailable()
  if (cli && cloud) return process.env.HIGGSFIELD_PREFER_CLOUD === '1' ? 'cloud' : 'cli'
  return cli ? 'cli' : cloud ? 'cloud' : null
}
const rendererAvailable = () => modelRenderer() !== null
import { HIGGSFIELD_COMBOS, buildGenerationPrompt, buildReferenceUrls, type ShootItem } from '@/lib/higgsfield-shoot'
import { persistImageToCloudinary, isCloudinaryUrl } from '@/lib/cloudinary-persist'

export type ModelShotStatus = 'queued' | 'rendering' | 'done' | 'failed'
export interface ModelShot {
  itemId: string
  status: ModelShotStatus
  imageUrl: string | null
  error: string | null
  /** Where the picture will come from: here, or a renderer that is not on this machine. */
  renderer: 'here' | 'queued'
}

/** A shoot that has sat in 'rendering' this long died with its process; take it again. */
const STALE_RENDERING_MS = 15 * 60_000
const MAX_ATTEMPTS = 2
const POSE = 'E5'

function shotOf(row: any, renderer: ModelShot['renderer']): ModelShot {
  return { itemId: row.item_id, status: row.status, imageUrl: row.image_url ?? null, error: row.error ?? null, renderer }
}

/**
 * The card's ask: the piece's shot if it exists, else make it (here) or queue
 * it (for the Mac). Returns the row's state either way.
 */
export async function requestModelShot(product: SiteProduct, member: MirrorMember): Promise<ModelShot | { error: string }> {
  const admin = createAdminClient() as any
  const ensured = await ensureMirrorItem(product, member, admin)
  if (!ensured.item) return { error: ensured.error ?? 'Could not read this piece' }
  const itemId: string = ensured.item.item_id
  const here = rendererAvailable()
  const renderer: ModelShot['renderer'] = here ? 'here' : 'queued'

  const { data: existing } = await admin.from('mirror_model_shot').select('*').eq('item_id', itemId).maybeSingle()
  if (existing?.status === 'done' && existing.image_url) return shotOf(existing, renderer)
  if (existing?.status === 'rendering' && Date.now() - Date.parse(existing.asked_at) < STALE_RENDERING_MS) return shotOf(existing, renderer)
  if (existing?.status === 'failed' && existing.attempts >= MAX_ATTEMPTS) return shotOf(existing, renderer)

  const source = product.image ?? ensured.item.image_url ?? null
  const { data: row, error: upsertErr } = await admin.from('mirror_model_shot').upsert({
    item_id: itemId,
    member_id: member.member_id,
    status: 'queued',
    source_image: source,
    error: null,
    asked_at: new Date().toISOString(),
    attempts: existing?.attempts ?? 0,
  }, { onConflict: 'item_id' }).select('*').single()
  if (upsertErr && /mirror_model_shot/.test(upsertErr.message ?? '')) return { error: 'MYRA needs migration 0113 (mirror_model_shot) first' }
  if (!row) return { error: upsertErr?.message ?? 'Could not keep the ask' }

  if (!here) return shotOf(row, 'queued')
  return renderModelShot(itemId, admin)
}

/** The row as it stands — the extension polls this while the Mac renders. */
export async function readModelShot(itemId: string): Promise<ModelShot | null> {
  const admin = createAdminClient() as any
  const { data } = await admin.from('mirror_model_shot').select('*').eq('item_id', itemId).maybeSingle()
  return data ? shotOf(data, rendererAvailable() ? 'here' : 'queued') : null
}

/** Make the picture for one queued piece. Needs the CLI on this machine. */
export async function renderModelShot(itemId: string, adminIn?: any): Promise<ModelShot | { error: string }> {
  const admin = adminIn ?? (createAdminClient() as any)
  const which = modelRenderer()
  if (!which) return { error: 'No Higgsfield renderer here: set HF_API_KEY_ID/HF_API_KEY_SECRET, or run on the Mac with the CLI' }
  const { data: row } = await admin.from('mirror_model_shot').select('*').eq('item_id', itemId).maybeSingle()
  if (!row) return { error: 'No ask for this piece' }
  const { data: item } = await admin.from('item').select('item_id, product_name, item_type, material_primary, image_url, brand:brand_id(name)').eq('item_id', itemId).maybeSingle()
  if (!item) return { error: 'Piece is gone' }

  await admin.from('mirror_model_shot').update({ status: 'rendering', attempts: (row.attempts ?? 0) + 1, asked_at: new Date().toISOString() }).eq('item_id', itemId)

  const fail = async (error: string) => {
    await admin.from('mirror_model_shot').update({ status: 'failed', error: error.slice(0, 400) }).eq('item_id', itemId)
    return { itemId, status: 'failed' as const, imageUrl: null, error, renderer: 'here' as const }
  }

  try {
    // The reference must be a Cloudinary URL so the shoot can pixelate any face
    // on the retailer's model (toHiggsfieldJpg) — the generator then has to
    // invent its own person rather than copy theirs.
    let ref: string | null = row.source_image || item.image_url || null
    if (ref && !isCloudinaryUrl(ref)) {
      ref = (await persistImageToCloudinary(ref, { folder: 'mirror-pieces', publicId: `piece-${itemId}` })) ?? ref
    }
    if (!ref) return fail('No picture of this piece to work from')

    const shootItem: ShootItem = {
      product_name: item.product_name,
      item_type: item.item_type,
      material_primary: item.material_primary,
      image_url: ref,
      brand_name: item.brand?.name ?? null,
    }
    const combo = HIGGSFIELD_COMBOS[POSE]
    const prompt = buildGenerationPrompt(combo, [shootItem])
    const refs = buildReferenceUrls(combo, [shootItem])
    const publicId = `mirror-model-${itemId}-${Date.now()}`
    const gen = which === 'cloud'
      ? await runHiggsfieldCloudGeneration(prompt, refs, publicId)
      : await (await import('@/app/admin/projects/higgsfield-actions')).runHiggsfieldGeneration(prompt, refs, publicId)
    if (!gen.imageUrl) return fail(gen.error ?? 'Higgsfield made no picture')

    const { data: done } = await admin.from('mirror_model_shot').update({
      status: 'done', image_url: gen.imageUrl, error: null, rendered_at: new Date().toISOString(),
    }).eq('item_id', itemId).select('*').single()
    return shotOf(done, 'here')
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

/** The drain for queued asks: oldest first, one at a time, within a time budget. */
export async function drainModelShots(opts: { limit?: number; budgetMs?: number } = {}) {
  const admin = createAdminClient() as any
  if (!rendererAvailable()) return { skipped: 'No Higgsfield renderer here (no CLI, no HF_API_KEY_ID/SECRET)', made: 0, failed: 0, results: [] as any[] }
  const limit = opts.limit ?? 6
  const budgetMs = opts.budgetMs ?? 280_000
  const t0 = Date.now()
  const staleBefore = new Date(Date.now() - STALE_RENDERING_MS).toISOString()
  const { data: rows } = await admin.from('mirror_model_shot').select('item_id, status, asked_at, attempts')
    .or(`status.eq.queued,and(status.eq.rendering,asked_at.lt.${staleBefore})`)
    .lt('attempts', MAX_ATTEMPTS)
    .order('asked_at', { ascending: true }).limit(limit)
  const results: { itemId: string; ok: boolean; note: string; ms: number }[] = []
  let made = 0, failed = 0
  for (const r of (rows ?? []) as any[]) {
    if (Date.now() - t0 > budgetMs) break
    const s = Date.now()
    const res = await renderModelShot(r.item_id, admin)
    const ok = 'imageUrl' in res && !!res.imageUrl
    if (ok) made++; else failed++
    results.push({ itemId: r.item_id, ok, note: ok ? 'shot' : ('error' in res ? res.error ?? '' : (res as ModelShot).error ?? ''), ms: Date.now() - s })
  }
  return { made, failed, results }
}
