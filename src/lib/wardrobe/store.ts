// Wardrobe Import — persistence. Every read/write for photos, extractions,
// batches, jobs, spend and the owned `item` rows. Server-only; callers (admin
// actions, the client's /me/wardrobe actions, the queue) scope by owner.
import 'server-only'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase-server'
import type { ItemWithBrand } from '@/lib/admin-queries'
import { WARDROBE_CONFIG } from './config'
import { normalisePhoto } from './cutout'
import { cloudinaryPublicId, destroyCloudinaryAsset } from './cloudinary'
import { buildOwnedItemRow, lowConfidenceDims } from './approve'
import type {
  ApiUsage, BatchCost, ExtractionEdits, OwnerRef, WardrobeBatch, WardrobeExtraction, WardrobePhoto,
} from './types'

type Admin = ReturnType<typeof createAdminClient> & any

const BUCKET = WARDROBE_CONFIG.storageBucket

export function admin(): Admin {
  return createAdminClient() as Admin
}

const ownerIds = (owners: OwnerRef[]) => Array.from(new Set(owners.map((o) => o.id)))
const ownerOk = (row: { owner_user_id: string; owner_kind: string }, owners: OwnerRef[]) =>
  owners.some((o) => o.id === row.owner_user_id && o.kind === row.owner_kind)

// ── Signed URLs for the private originals ───────────────────────────────────

export async function signedPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = Array.from(new Set(paths.filter(Boolean)))
  if (!unique.length) return out
  const { data } = await admin().storage.from(BUCKET).createSignedUrls(unique, WARDROBE_CONFIG.signedUrlSeconds)
  for (const r of (data ?? []) as any[]) if (r?.path && r?.signedUrl) out.set(r.path, r.signedUrl)
  return out
}

export async function downloadPhotoBytes(path: string): Promise<Buffer> {
  const { data, error } = await admin().storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(error?.message ?? 'Could not read photo from storage')
  return Buffer.from(await data.arrayBuffer())
}

// ── Batches & photos ────────────────────────────────────────────────────────

export async function createBatch(owner: OwnerRef, createdBy: 'admin' | 'client', label?: string | null): Promise<WardrobeBatch> {
  const { data, error } = await admin()
    .from('wardrobe_batch')
    .insert({ owner_user_id: owner.id, owner_kind: owner.kind, created_by: createdBy, label: label ?? null })
    .select('*')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Could not create batch')
  return data as WardrobeBatch
}

export async function addPhotoToBatch(
  batchId: string | null,
  owner: OwnerRef,
  file: { bytes: Buffer; name: string | null; mime: string | null },
): Promise<{ photo?: WardrobePhoto; error?: string }> {
  if (file.bytes.length > WARDROBE_CONFIG.maxPhotoBytes) return { error: `Photo is over ${Math.round(WARDROBE_CONFIG.maxPhotoBytes / 1024 / 1024)}MB` }
  let normalised: { png: Buffer; width: number; height: number }
  try {
    normalised = await normalisePhoto(file.bytes)
  } catch (err) {
    return { error: `Not a readable image${err instanceof Error ? ` (${err.message})` : ''}` }
  }
  const a = admin()
  const photoId = crypto.randomUUID()
  const path = `${owner.id}/${photoId}.png`
  const { error: upErr } = await a.storage.from(BUCKET).upload(path, normalised.png, { contentType: 'image/png', upsert: false })
  if (upErr) return { error: `Storage upload failed: ${upErr.message}` }

  const { data: photo, error } = await a
    .from('wardrobe_photo')
    .insert({
      photo_id: photoId,
      batch_id: batchId,
      owner_user_id: owner.id,
      owner_kind: owner.kind,
      storage_path: path,
      original_name: file.name,
      mime_type: file.mime,
      width: normalised.width,
      height: normalised.height,
      bytes: normalised.png.length,
      status: 'uploaded',
    })
    .select('*')
    .single()
  if (error || !photo) {
    await a.storage.from(BUCKET).remove([path])
    return { error: error?.message ?? 'Could not record photo' }
  }
  await a.from('wardrobe_job').insert({ kind: 'detect', batch_id: batchId, photo_id: photoId, owner_user_id: owner.id, priority: 1 })
  if (batchId) {
    const { data: b } = await a.from('wardrobe_batch').select('photo_count').eq('batch_id', batchId).single()
    await a.from('wardrobe_batch').update({ photo_count: (b?.photo_count ?? 0) + 1, status: 'processing' }).eq('batch_id', batchId)
  }
  return { photo: photo as WardrobePhoto }
}

export async function listPhotos(owners: OwnerRef[], opts: { withUrls?: boolean } = {}): Promise<WardrobePhoto[]> {
  if (!owners.length) return []
  const { data } = await admin()
    .from('wardrobe_photo')
    .select('*')
    .in('owner_user_id', ownerIds(owners))
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })
    .limit(2000)
  const rows = ((data ?? []) as WardrobePhoto[]).filter((r) => ownerOk(r, owners))
  if (opts.withUrls) {
    const urls = await signedPhotoUrls(rows.map((r) => r.storage_path))
    for (const r of rows) r.signed_url = urls.get(r.storage_path) ?? null
  }
  return rows
}

export async function listBatches(owners: OwnerRef[]): Promise<(WardrobeBatch & { cost: BatchCost | null })[]> {
  if (!owners.length) return []
  const { data } = await admin()
    .from('wardrobe_batch')
    .select('*')
    .in('owner_user_id', ownerIds(owners))
    .order('created_at', { ascending: false })
    .limit(200)
  const rows = ((data ?? []) as WardrobeBatch[]).filter((r) => ownerOk(r, owners))
  const costs = await batchCosts(rows.map((r) => r.batch_id))
  return rows.map((r) => ({ ...r, cost: costs.get(r.batch_id) ?? null }))
}

// ── Extractions (the review queue) ──────────────────────────────────────────

const ACTIVE_STATUSES = ['detected', 'cutout_queued', 'cutout_running', 'scoring', 'review', 'failed']

export async function listExtractions(
  owners: OwnerRef[],
  opts: { statuses?: string[]; withPhotoUrls?: boolean; limit?: number } = {},
): Promise<WardrobeExtraction[]> {
  if (!owners.length) return []
  let q = admin()
    .from('wardrobe_extraction')
    .select('*, photo:photo_id(storage_path, original_name, status)')
    .in('owner_user_id', ownerIds(owners))
    .order('created_at', { ascending: true })
    .order('position', { ascending: true })
    .limit(opts.limit ?? 500)
  if (opts.statuses) q = q.in('status', opts.statuses)
  const { data } = await q
  const rows = ((data ?? []) as any[])
    .filter((r) => ownerOk(r, owners) && r.photo?.status !== 'deleted')
    .map((r) => ({ ...r, photo_name: r.photo?.original_name ?? null, _path: r.photo?.storage_path ?? null }))
  if (opts.withPhotoUrls) {
    const urls = await signedPhotoUrls(rows.map((r) => r._path).filter(Boolean))
    for (const r of rows) r.photo_signed_url = r._path ? urls.get(r._path) ?? null : null
  }
  return rows.map(({ photo: _p, _path, ...rest }) => rest as WardrobeExtraction)
}

export async function listReviewQueue(owners: OwnerRef[]): Promise<WardrobeExtraction[]> {
  return listExtractions(owners, { statuses: ACTIVE_STATUSES, withPhotoUrls: true })
}

export async function getExtraction(extractionId: string): Promise<(WardrobeExtraction & { storage_path: string | null }) | null> {
  const { data } = await admin()
    .from('wardrobe_extraction')
    .select('*, photo:photo_id(storage_path)')
    .eq('extraction_id', extractionId)
    .maybeSingle()
  if (!data) return null
  const { photo, ...rest } = data as any
  return { ...rest, storage_path: photo?.storage_path ?? null }
}

export async function saveExtractionEdits(extractionId: string, edits: ExtractionEdits): Promise<{ error?: string }> {
  const a = admin()
  const { data } = await a.from('wardrobe_extraction').select('edits').eq('extraction_id', extractionId).single()
  const merged = { ...((data?.edits as any) ?? {}), ...edits, scores: { ...(((data?.edits as any) ?? {}).scores ?? {}), ...(edits.scores ?? {}) } }
  const { error } = await a.from('wardrobe_extraction').update({ edits: merged, updated_at: new Date().toISOString() }).eq('extraction_id', extractionId)
  return error ? { error: error.message } : {}
}

export async function discardExtraction(extractionId: string): Promise<{ error?: string }> {
  const { error } = await admin()
    .from('wardrobe_extraction')
    .update({ status: 'discarded', reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('extraction_id', extractionId)
  return error ? { error: error.message } : {}
}

export async function requestRegenerate(extractionId: string, direction: string | null): Promise<{ error?: string }> {
  const a = admin()
  const { data: x } = await a.from('wardrobe_extraction').select('extraction_id, photo_id, batch_id, owner_user_id, cutout_attempts').eq('extraction_id', extractionId).single()
  if (!x) return { error: 'Extraction not found' }
  if ((x.cutout_attempts ?? 0) >= WARDROBE_CONFIG.cutoutAttemptsCap) return { error: `Already regenerated ${x.cutout_attempts} times — edit the attributes or discard instead` }
  const { data: queued } = await a.from('wardrobe_job').select('job_id').eq('extraction_id', extractionId).in('status', ['queued', 'running']).limit(1)
  if ((queued ?? []).length) return { error: 'A regeneration is already queued for this piece' }
  await a.from('wardrobe_extraction').update({ status: 'cutout_queued', regen_direction: direction, error: null, updated_at: new Date().toISOString() }).eq('extraction_id', extractionId)
  const { error } = await a.from('wardrobe_job').insert({ kind: 'regenerate', photo_id: x.photo_id, extraction_id: extractionId, batch_id: x.batch_id, owner_user_id: x.owner_user_id, priority: 1 })
  return error ? { error: error.message } : {}
}

export async function requestRescore(extractionId: string): Promise<{ error?: string }> {
  const a = admin()
  const { data: x } = await a.from('wardrobe_extraction').select('extraction_id, photo_id, batch_id, owner_user_id, cutout_url').eq('extraction_id', extractionId).single()
  if (!x) return { error: 'Extraction not found' }
  if (!x.cutout_url) return { error: 'No cutout to score yet' }
  await a.from('wardrobe_extraction').update({ status: 'scoring', error: null, updated_at: new Date().toISOString() }).eq('extraction_id', extractionId)
  const { error } = await a.from('wardrobe_job').insert({ kind: 'rescore', photo_id: x.photo_id, extraction_id: extractionId, batch_id: x.batch_id, owner_user_id: x.owner_user_id, priority: 1 })
  return error ? { error: error.message } : {}
}

// ── Brands (manual brand entry at review) ───────────────────────────────────

const fold = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Match an existing brand by name (accent/case-insensitive), creating a minimal row if needed. */
export async function resolveBrandId(name: string | null | undefined, opts: { create?: boolean } = { create: true }): Promise<string | null> {
  const clean = (name ?? '').trim()
  if (!clean) return null
  const a = admin()
  const { data: rows } = await a.from('brand').select('brand_id, name')
  const hit = ((rows ?? []) as any[]).find((r) => fold(r.name) === fold(clean))
  if (hit) return hit.brand_id
  if (!opts.create) return null
  const { data: created } = await a
    .from('brand')
    .insert({ name: clean, price_tier: 3, era_orientation: 3, aesthetic_output: 3, cultural_legibility: 3, creative_behaviour: 3 })
    .select('brand_id')
    .single()
  return created?.brand_id ?? null
}

export async function listBrandNames(): Promise<string[]> {
  const { data } = await admin().from('brand').select('name').order('name').limit(3000)
  return ((data ?? []) as any[]).map((r) => r.name).filter(Boolean)
}

// ── Approval → item ─────────────────────────────────────────────────────────

export async function approveExtraction(
  extractionId: string,
  edits: ExtractionEdits,
  opts: { allowedOwners?: OwnerRef[] } = {},
): Promise<{ itemId?: string; error?: string }> {
  const a = admin()
  const x = await getExtraction(extractionId)
  if (!x) return { error: 'Extraction not found' }
  if (opts.allowedOwners && !ownerOk(x, opts.allowedOwners)) return { error: 'Not yours to approve' }
  if (x.status === 'approved' && x.item_id) return { error: 'Already approved' }
  if (!x.cutout_url) return { error: 'No cutout yet — wait for the queue or regenerate' }
  const mergedEdits: ExtractionEdits = { ...(x.edits ?? {}), ...edits, scores: { ...((x.edits ?? {}).scores ?? {}), ...(edits.scores ?? {}) } }
  const brandName = mergedEdits.brand_name ?? x.detected?.brand_hint ?? null
  const brandId = await resolveBrandId(brandName)
  const low = lowConfidenceDims(x.scores, { brandKnown: !!brandId, detected: x.detected })
  const row = buildOwnedItemRow({
    detected: x.detected,
    scores: x.scores,
    edits: mergedEdits,
    owner: { kind: x.owner_kind, id: x.owner_user_id },
    photoId: x.photo_id,
    extractionId,
    cutoutUrl: x.cutout_url,
    brandId,
    lowConfidence: low,
  })
  const { data: item, error } = await a.from('item').insert(row).select('item_id').single()
  if (error || !item) return { error: error?.message ?? 'Could not create item' }
  await a
    .from('wardrobe_extraction')
    .update({ status: 'approved', item_id: item.item_id, edits: mergedEdits, low_confidence_dims: low, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('extraction_id', extractionId)
  return { itemId: item.item_id }
}

// ── Owned items ─────────────────────────────────────────────────────────────

export async function listOwnedItems(owners: OwnerRef[]): Promise<ItemWithBrand[]> {
  if (!owners.length) return []
  const { data, error } = await admin()
    .from('item')
    .select('*, brand(*)')
    .eq('ownership', 'owned')
    .in('owner_user_id', ownerIds(owners))
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) {
    // Pre-migration (no ownership column): there are no owned items yet.
    return []
  }
  return ((data ?? []) as any[]).filter((r) => ownerOk(r, owners)) as ItemWithBrand[]
}

export async function updateOwnedItem(
  itemId: string,
  patch: { estimated_value?: number | null; owned_metadata?: Record<string, unknown>; product_name?: string; brand_name?: string | null },
  allowedOwners?: OwnerRef[],
): Promise<{ error?: string }> {
  const a = admin()
  const { data: it } = await a.from('item').select('item_id, ownership, owner_user_id, owner_kind, owned_metadata').eq('item_id', itemId).single()
  if (!it || it.ownership !== 'owned') return { error: 'Not an owned item' }
  if (allowedOwners && !ownerOk(it, allowedOwners)) return { error: 'Not yours' }
  const update: Record<string, unknown> = {}
  if (patch.estimated_value !== undefined) update.estimated_value = patch.estimated_value
  if (patch.product_name) update.product_name = patch.product_name
  if (patch.owned_metadata) update.owned_metadata = { ...((it.owned_metadata as any) ?? {}), ...patch.owned_metadata }
  if (patch.brand_name !== undefined) {
    const id = await resolveBrandId(patch.brand_name)
    update.brand_id = id
    if (!id && patch.brand_name) update.owned_metadata = { ...((update.owned_metadata as any) ?? (it.owned_metadata as any) ?? {}), brand_label: patch.brand_name }
  }
  const { error } = await a.from('item').update(update).eq('item_id', itemId)
  return error ? { error: error.message } : {}
}

/** Remove one owned item. Returns its id so the caller can rebuild looks that used it. */
export async function deleteOwnedItem(itemId: string, allowedOwners?: OwnerRef[]): Promise<{ error?: string; removed?: string }> {
  const a = admin()
  const { data: it } = await a.from('item').select('item_id, ownership, owner_user_id, owner_kind, extraction_id, image_url').eq('item_id', itemId).single()
  if (!it || it.ownership !== 'owned') return { error: 'Not an owned item' }
  if (allowedOwners && !ownerOk(it, allowedOwners)) return { error: 'Not yours' }
  const { error } = await a.from('item').delete().eq('item_id', itemId)
  if (error) return { error: error.message }
  if (it.extraction_id) await a.from('wardrobe_extraction').update({ status: 'discarded', item_id: null }).eq('extraction_id', it.extraction_id)
  return { removed: itemId }
}

/**
 * Delete an original photo: the file, its extractions, and every owned item
 * extracted from it (FK cascade). Returns the removed item ids so the caller
 * can rebuild any lookbook that used them.
 */
export async function deletePhoto(photoId: string, allowedOwners?: OwnerRef[]): Promise<{ error?: string; removedItemIds?: string[] }> {
  const a = admin()
  const { data: photo } = await a.from('wardrobe_photo').select('*').eq('photo_id', photoId).single()
  if (!photo) return { error: 'Photo not found' }
  if (allowedOwners && !ownerOk(photo, allowedOwners)) return { error: 'Not yours' }
  const [{ data: items }, { data: xs }] = await Promise.all([
    a.from('item').select('item_id, image_url').eq('source_photo_id', photoId),
    a.from('wardrobe_extraction').select('crop_url, cutout_url').eq('photo_id', photoId),
  ])
  const removedItemIds = ((items ?? []) as any[]).map((r) => r.item_id)
  const assets = new Set<string>()
  for (const r of (xs ?? []) as any[]) { const c = cloudinaryPublicId(r.crop_url); const k = cloudinaryPublicId(r.cutout_url); if (c) assets.add(c); if (k) assets.add(k) }
  for (const r of (items ?? []) as any[]) { const k = cloudinaryPublicId(r.image_url); if (k) assets.add(k) }

  // Cascade: wardrobe_extraction, wardrobe_job (photo FK) and item (source_photo_fk) go with the photo.
  const { error } = await a.from('wardrobe_photo').delete().eq('photo_id', photoId)
  if (error) return { error: error.message }
  await a.storage.from(BUCKET).remove([photo.storage_path])
  for (const id of Array.from(assets)) await destroyCloudinaryAsset(id)
  return { removedItemIds }
}

// ── Looks that reference items (for rebuild after deletion) ─────────────────

export async function looksUsingItems(itemIds: string[]): Promise<{ look_id: string; delivery_id: string; member_id: string; items: any[]; image_url: string | null; shoot_history: any[] }[]> {
  if (!itemIds.length) return []
  const want = new Set(itemIds)
  const { data } = await admin()
    .from('pilot_look')
    .select('look_id, delivery_id, items, image_url, shoot_history, delivery:delivery_id(member_id)')
    .limit(5000)
  return ((data ?? []) as any[])
    .filter((l) => (l.items ?? []).some((it: any) => it?.item_id && want.has(it.item_id)))
    .map((l) => ({ look_id: l.look_id, delivery_id: l.delivery_id, member_id: l.delivery?.member_id, items: l.items ?? [], image_url: l.image_url ?? null, shoot_history: l.shoot_history ?? [] }))
}

// ── Spend log ───────────────────────────────────────────────────────────────

export async function logApiCall(c: {
  batchId: string | null
  ownerId: string | null
  stage: 'detect' | 'cutout' | 'score'
  provider: 'openai' | 'anthropic'
  model: string
  usage?: ApiUsage | null
  imageCount?: number
  costUsd: number
  estimated: boolean
  durationMs?: number
  ok?: boolean
}): Promise<void> {
  try {
    await admin().from('wardrobe_api_call').insert({
      batch_id: c.batchId,
      owner_user_id: c.ownerId,
      stage: c.stage,
      provider: c.provider,
      model: c.model,
      input_tokens: c.usage?.input_tokens ?? null,
      output_tokens: c.usage?.output_tokens ?? null,
      image_count: c.imageCount ?? 0,
      cost_usd: Math.round(c.costUsd * 1_000_000) / 1_000_000,
      estimated: c.estimated,
      duration_ms: c.durationMs ?? null,
      ok: c.ok ?? true,
    })
  } catch (err) {
    console.error('[wardrobe] spend log failed', err instanceof Error ? err.message : err)
  }
}

export async function batchCosts(batchIds: string[]): Promise<Map<string, BatchCost>> {
  const out = new Map<string, BatchCost>()
  if (!batchIds.length) return out
  const { data } = await admin().from('wardrobe_api_call').select('batch_id, stage, cost_usd, estimated, image_count').in('batch_id', batchIds).limit(20000)
  for (const r of (data ?? []) as any[]) {
    const c = out.get(r.batch_id) ?? { batch_id: r.batch_id, calls: 0, detect_usd: 0, cutout_usd: 0, score_usd: 0, total_usd: 0, estimated_calls: 0, images_generated: 0 }
    const usd = Number(r.cost_usd) || 0
    c.calls++
    c.total_usd += usd
    if (r.stage === 'detect') c.detect_usd += usd
    else if (r.stage === 'cutout') { c.cutout_usd += usd; c.images_generated += Number(r.image_count) || 0 }
    else c.score_usd += usd
    if (r.estimated) c.estimated_calls++
    out.set(r.batch_id, c)
  }
  return out
}

// ── Queue status ────────────────────────────────────────────────────────────

export async function queueSummary(owners: OwnerRef[]): Promise<{ queued: number; running: number; failed: number; byKind: Record<string, number> }> {
  const empty = { queued: 0, running: 0, failed: 0, byKind: {} as Record<string, number> }
  if (!owners.length) return empty
  const { data } = await admin().from('wardrobe_job').select('kind, status').in('owner_user_id', ownerIds(owners)).in('status', ['queued', 'running', 'failed']).limit(5000)
  const s = { ...empty, byKind: {} as Record<string, number> }
  for (const r of (data ?? []) as any[]) {
    if (r.status === 'queued') s.queued++
    else if (r.status === 'running') s.running++
    else s.failed++
    if (r.status !== 'failed') s.byKind[r.kind] = (s.byKind[r.kind] ?? 0) + 1
  }
  return s
}

export async function requeueFailedJobs(owners: OwnerRef[]): Promise<number> {
  if (!owners.length) return 0
  const { data } = await admin()
    .from('wardrobe_job')
    .update({ status: 'queued', attempts: 0, error: null, started_at: null, finished_at: null })
    .eq('status', 'failed')
    .in('owner_user_id', ownerIds(owners))
    .select('job_id')
  return (data ?? []).length
}

// ── Auth user lookup (linking a pilot member to her login) ──────────────────

export async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const want = email.trim().toLowerCase()
  if (!want) return null
  const a = admin()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await a.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) break
    const hit = data.users.find((u: any) => (u.email ?? '').toLowerCase() === want)
    if (hit) return hit.id
    if (data.users.length < 200) break
  }
  return null
}
