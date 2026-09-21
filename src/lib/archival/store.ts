// ARCHIVAL LOOKS — what she already wears, and how.
//
// A photo (from Instagram, or uploaded) becomes two things at once:
//   · an archival look — the whole outfit, read once by analyseOutfit so MYRA
//     knows how she puts things together (kept with its 34-dim vector);
//   · a wardrobe photo — run through the existing import pipeline (detect →
//     cut out → score), whose finds are OFFERED to her. Nothing enters her
//     wardrobe until she taps it: old posts hold things she has since sold.
// No framework here — the browser-callable surface is archival-actions.ts.

import 'server-only'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase-server'
import { encryptSecret, decryptSecret } from '@/lib/email/secrets'
import { addPhotoToBatch, createBatch, listExtractions, signedPhotoUrls } from '@/lib/wardrobe/store'
import type { OwnerRef, WardrobeExtraction } from '@/lib/wardrobe/types'
import { analyseOutfit } from '@/app/admin/ai/analyse-outfit'
import { buildOutfitVector } from '@/lib/taste-vector'
import { listInstagramImages, refreshInstagramToken, type InstagramGrant } from './instagram'

export const MIGRATION_HINT = 'Run migration 0061_archival_looks.sql in Supabase first'
const missing = (msg: string) => /archival_look|member_instagram_connection|schema cache|does not exist/i.test(msg)
const BATCH_LABEL = 'Archival looks'
/** New photos taken in per sync — each costs a detection and a read. */
export const SYNC_PHOTOS = 12

const ownerFor = (memberId: string): OwnerRef => ({ kind: 'pilot_member', id: memberId })

export interface InstagramConnectionView { connection_id: string; username: string | null; status: string; error: string | null; last_synced_at: string | null }

export async function saveInstagramConnection(memberId: string, g: InstagramGrant): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { error } = await admin.from('member_instagram_connection').upsert({
    member_id: memberId, ig_user_id: g.userId, username: g.username, token_enc: encryptSecret(g.token),
    token_expires_at: g.expiresAt, status: 'connected', error: null,
  }, { onConflict: 'member_id,ig_user_id' })
  return error ? { error: missing(error.message) ? MIGRATION_HINT : error.message } : {}
}

export async function listInstagramConnections(memberId: string): Promise<InstagramConnectionView[]> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('member_instagram_connection')
    .select('connection_id, username, status, error, last_synced_at').eq('member_id', memberId).neq('status', 'disconnected').order('created_at')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function disconnectInstagram(memberId: string, connectionId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  // The token goes; the looks she already brought in stay hers.
  const { error } = await admin.from('member_instagram_connection').update({ status: 'disconnected', token_enc: encryptSecret('revoked') })
    .eq('connection_id', connectionId).eq('member_id', memberId)
  return error ? { error: error.message } : {}
}

async function archivalBatchId(memberId: string): Promise<string | null> {
  const admin = createAdminClient() as any
  const { data } = await admin.from('wardrobe_batch').select('batch_id').eq('owner_user_id', memberId).eq('label', BATCH_LABEL).order('created_at', { ascending: false }).limit(1)
  if (data?.[0]?.batch_id) return data[0].batch_id
  try { return (await createBatch(ownerFor(memberId), 'client', BATCH_LABEL)).batch_id } catch { return null }
}

export interface IncomingPhoto { bytes: Buffer; name: string | null; mime: string | null; source: 'instagram' | 'upload'; sourceId: string; permalink?: string | null; caption?: string | null; takenAt?: string | null }

/** One photo in: a wardrobe photo (for the garments) and an archival look (for the outfit). Idempotent on (member, source, sourceId). */
export async function importArchivalPhoto(memberId: string, p: IncomingPhoto): Promise<{ lookId?: string; skipped?: true; error?: string }> {
  const admin = createAdminClient() as any
  const { data: known, error: kErr } = await admin.from('archival_look').select('look_id').eq('member_id', memberId).eq('source', p.source).eq('source_id', p.sourceId).maybeSingle()
  if (kErr) return { error: missing(kErr.message) ? MIGRATION_HINT : kErr.message }
  if (known) return { skipped: true, lookId: known.look_id }
  const added = await addPhotoToBatch(await archivalBatchId(memberId), ownerFor(memberId), { bytes: p.bytes, name: p.name, mime: p.mime })
  if (!added.photo) return { error: added.error ?? 'Could not keep that photo' }
  const { data, error } = await admin.from('archival_look').insert({
    member_id: memberId, source: p.source, source_id: p.sourceId, permalink: p.permalink ?? null,
    caption: p.caption ? p.caption.slice(0, 600) : null, taken_at: p.takenAt ?? null, photo_id: added.photo.photo_id,
  }).select('look_id').single()
  if (error) return { error: error.message }
  return { lookId: data.look_id }
}

export const uploadSourceId = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32)

/** Bring in her newest Instagram photos that MYRA has not seen. Bounded per run. */
export async function syncInstagram(memberId: string, max = SYNC_PHOTOS): Promise<{ added: number; seen: number; error?: string }> {
  const admin = createAdminClient() as any
  const { data: conns, error } = await admin.from('member_instagram_connection').select('*').eq('member_id', memberId).eq('status', 'connected')
  if (error) return { added: 0, seen: 0, error: missing(error.message) ? MIGRATION_HINT : error.message }
  let added = 0, seen = 0
  for (const c of conns ?? []) {
    try {
      let token = decryptSecret(c.token_enc)
      // Keep the 60-day token alive while she is still using it.
      if (c.token_expires_at && new Date(c.token_expires_at).getTime() - Date.now() < 14 * 86_400_000) {
        const fresh = await refreshInstagramToken(token)
        if (fresh) { token = fresh.token; await admin.from('member_instagram_connection').update({ token_enc: encryptSecret(fresh.token), token_expires_at: fresh.expiresAt }).eq('connection_id', c.connection_id) }
      }
      const images = await listInstagramImages(token, 90)
      seen += images.length
      const { data: have } = await admin.from('archival_look').select('source_id').eq('member_id', memberId).eq('source', 'instagram')
      const known = new Set((have ?? []).map((r: any) => r.source_id))
      for (const img of images.filter((i) => !known.has(i.id)).slice(0, Math.max(0, max - added))) {
        const res = await fetch(img.url)
        if (!res.ok) continue
        const bytes = Buffer.from(await res.arrayBuffer())
        const r = await importArchivalPhoto(memberId, { bytes, name: `instagram-${img.id}.jpg`, mime: res.headers.get('content-type'), source: 'instagram', sourceId: img.id, permalink: img.permalink, caption: img.caption, takenAt: img.takenAt })
        if (r.lookId && !r.skipped) added++
      }
      await admin.from('member_instagram_connection').update({ last_synced_at: new Date().toISOString(), status: 'connected', error: null }).eq('connection_id', c.connection_id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Instagram sync failed'
      await admin.from('member_instagram_connection').update({ status: 'error', error: msg.slice(0, 300) }).eq('connection_id', c.connection_id)
      return { added, seen, error: msg }
    }
  }
  return { added, seen }
}

/** Read the outfits MYRA has not read yet — how she wears things. Bounded: each is one vision call. */
export async function readArchivalLooks(memberId: string, max = 4): Promise<number> {
  const admin = createAdminClient() as any
  const { data } = await admin.from('archival_look').select('look_id, photo:photo_id(storage_path)').eq('member_id', memberId).is('read_at', null).eq('hidden', false).order('created_at').limit(max)
  const rows = (data ?? []).filter((r: any) => r.photo?.storage_path)
  if (!rows.length) return 0
  const urls = await signedPhotoUrls(rows.map((r: any) => r.photo.storage_path))
  let read = 0
  for (const r of rows) {
    const url = urls.get(r.photo.storage_path)
    const stamp = { read_at: new Date().toISOString() }
    if (!url) { await admin.from('archival_look').update(stamp).eq('look_id', r.look_id); continue }
    const a = await analyseOutfit(url)
    if (a.data) {
      let vector: number[] | null = null
      try { vector = buildOutfitVector({ ...(a.data as any), occasion_tags: (a.data as any).occasion_tags ?? [], outfit_item: [] } as any) } catch { vector = null }
      await admin.from('archival_look').update({ ...stamp, analysis: a.data, taste_vector: vector }).eq('look_id', r.look_id)
      read++
    } else await admin.from('archival_look').update(stamp).eq('look_id', r.look_id)
  }
  return read
}

export interface ArchivalPieceView { extraction_id: string; name: string; item_type: string; colour_family: string | null; image_url: string | null; status: string; item_id: string | null }
export interface ArchivalLookView {
  look_id: string
  source: 'instagram' | 'upload'
  permalink: string | null
  taken_at: string | null
  image_url: string | null
  photo_status: string | null
  summary: string | null
  pieces: ArchivalPieceView[]
}

const summaryOf = (a: any): string | null => {
  if (!a) return null
  const s = a.summary ?? a.description ?? a.styling_notes ?? a.overall ?? null
  return typeof s === 'string' && s.trim() ? s.trim().slice(0, 220) : null
}

export async function listArchivalLooks(memberId: string): Promise<ArchivalLookView[]> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('archival_look')
    .select('look_id, source, permalink, taken_at, created_at, analysis, photo_id, photo:photo_id(storage_path, status)')
    .eq('member_id', memberId).eq('hidden', false).order('taken_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(120)
  if (error) throw new Error(error.message)
  const looks = (data ?? []).filter((l: any) => l.photo?.status !== 'deleted')
  const paths = looks.map((l: any) => l.photo?.storage_path).filter(Boolean)
  const urls = paths.length ? await signedPhotoUrls(paths) : new Map<string, string>()
  const photoIds = new Set(looks.map((l: any) => l.photo_id).filter(Boolean))
  const extractions: WardrobeExtraction[] = photoIds.size ? await listExtractions([ownerFor(memberId)], { limit: 1500 }) : []
  const byPhoto = new Map<string, WardrobeExtraction[]>()
  for (const x of extractions) if (photoIds.has(x.photo_id) && x.status !== 'discarded') byPhoto.set(x.photo_id, [...(byPhoto.get(x.photo_id) ?? []), x])
  return looks.map((l: any) => ({
    look_id: l.look_id, source: l.source, permalink: l.permalink ?? null, taken_at: l.taken_at ?? l.created_at,
    image_url: l.photo?.storage_path ? urls.get(l.photo.storage_path) ?? null : null,
    photo_status: l.photo?.status ?? null,
    summary: summaryOf(l.analysis),
    pieces: (byPhoto.get(l.photo_id) ?? []).map((x) => ({
      extraction_id: x.extraction_id, name: x.edits?.product_name ?? x.detected?.name ?? 'Piece', item_type: String(x.detected?.item_type ?? ''),
      colour_family: x.detected?.colour_family ?? null, image_url: x.cutout_url ?? x.crop_url ?? null, status: x.status, item_id: x.item_id ?? null,
    })),
  }))
}

export async function hideArchivalLook(memberId: string, lookId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { error } = await admin.from('archival_look').update({ hidden: true }).eq('look_id', lookId).eq('member_id', memberId)
  return error ? { error: error.message } : {}
}
