// MEMBER AVATAR — rows and files.
// Her photos live in the private bucket and are read through signed URLs or downloaded for a
// model call; pictures MYRA makes go to Cloudinary under avatar/<member_id>/.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { uploadImageBytesToCloudinary } from '@/lib/cloudinary-persist'
import { AVATAR_CONFIG } from './config'

export type AvatarStatus = 'collecting' | 'portrait' | 'choose' | 'body' | 'review' | 'ready' | 'failed' | 'retired'
export interface AvatarPhoto { path: string; kind: 'face' | 'full' }
export interface MemberAvatar {
  avatar_id: string
  member_id: string
  status: AvatarStatus
  photos: AvatarPhoto[]
  height_cm: number | null
  portrait_urls: string[]
  portrait_url: string | null
  body_url: string | null
  base_url: string | null
  width: number | null
  height: number | null
  consent_at: string | null
  approved_at: string | null
  attempts: number
  error: string | null
  cost_gbp: number
  created_at: string
  updated_at: string
}

const admin = () => createAdminClient() as any
const BUCKET = AVATAR_CONFIG.storageBucket

export async function liveAvatarFor(memberId: string): Promise<MemberAvatar | null> {
  const { data } = await admin().from('member_avatar').select('*').eq('member_id', memberId).neq('status', 'retired').maybeSingle()
  return (data as MemberAvatar) ?? null
}

export async function getAvatar(avatarId: string): Promise<MemberAvatar | null> {
  const { data } = await admin().from('member_avatar').select('*').eq('avatar_id', avatarId).maybeSingle()
  return (data as MemberAvatar) ?? null
}

export async function updateAvatar(avatarId: string, patch: Partial<MemberAvatar> & Record<string, unknown>): Promise<void> {
  const { error } = await admin().from('member_avatar').update({ ...patch, updated_at: new Date().toISOString() }).eq('avatar_id', avatarId)
  if (error) throw new Error(`member_avatar update: ${error.message}`)
}

export async function addCost(avatarId: string, gbp: number): Promise<void> {
  const a = admin()
  const { data } = await a.from('member_avatar').select('cost_gbp').eq('avatar_id', avatarId).maybeSingle()
  await a.from('member_avatar').update({ cost_gbp: Number(data?.cost_gbp ?? 0) + gbp }).eq('avatar_id', avatarId)
}

/** Start (or restart) her avatar: retire any live one, store the photos, record consent. */
export async function createAvatar(memberId: string, input: { photos: { bytes: Buffer; kind: 'face' | 'full'; name: string }[]; heightCm: number | null; consentText: string }): Promise<MemberAvatar> {
  const a = admin()
  await a.from('member_avatar').update({ status: 'retired', updated_at: new Date().toISOString() }).eq('member_id', memberId).neq('status', 'retired')
  const { data: row, error } = await a.from('member_avatar').insert({
    member_id: memberId, status: 'collecting', height_cm: input.heightCm, consent_text: input.consentText, consent_at: new Date().toISOString(),
  }).select('*').single()
  if (error || !row) throw new Error(`member_avatar insert: ${error?.message ?? 'no row'}`)
  const photos: AvatarPhoto[] = []
  for (let i = 0; i < input.photos.length; i++) {
    const p = input.photos[i]
    const path = `${memberId}/${row.avatar_id}/${p.kind}-${i + 1}.jpg`
    const { error: upErr } = await a.storage.from(BUCKET).upload(path, p.bytes, { contentType: 'image/jpeg', upsert: true })
    if (upErr) throw new Error(`photo upload: ${upErr.message}`)
    photos.push({ path, kind: p.kind })
  }
  await updateAvatar(row.avatar_id, { photos, status: 'portrait' })
  return { ...(row as MemberAvatar), photos, status: 'portrait' }
}

export async function downloadPhoto(path: string): Promise<Buffer> {
  const { data, error } = await admin().storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(`photo download: ${error?.message ?? path}`)
  return Buffer.from(await data.arrayBuffer())
}

export async function signedPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data } = await admin().storage.from(BUCKET).createSignedUrls(paths, AVATAR_CONFIG.signedUrlSeconds)
  const out: Record<string, string> = {}
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl
  return out
}

/** Her photos go once the avatar is approved: MYRA keeps what it made, not what she gave it. */
export async function deletePhotos(avatar: MemberAvatar): Promise<void> {
  const paths = (avatar.photos ?? []).map((p) => p.path)
  if (paths.length) await admin().storage.from(BUCKET).remove(paths)
  await updateAvatar(avatar.avatar_id, { photos: [] })
}

/** A picture MYRA made, kept in Cloudinary. Returns the stable URL, or throws. */
export async function keepPicture(memberId: string, name: string, bytes: Buffer, contentType: 'image/png' | 'image/webp' | 'image/jpeg'): Promise<string> {
  const url = await uploadImageBytesToCloudinary(bytes, contentType, { folder: `${AVATAR_CONFIG.cloudinaryFolder}/${memberId}`, publicId: `${name}-${Date.now()}` })
  if (!url) throw new Error('Cloudinary upload failed')
  return url
}

/** Everything about her avatar, gone: rows cascade, files removed. Cloudinary assets are left for the nightly sweep. */
export async function retireAvatar(memberId: string): Promise<void> {
  const live = await liveAvatarFor(memberId)
  if (!live) return
  await deletePhotos(live).catch(() => undefined)
  await admin().from('avatar_job').update({ status: 'failed', error: 'avatar deleted', finished_at: new Date().toISOString() }).eq('member_id', memberId).in('status', ['queued', 'running'])
  await updateAvatar(live.avatar_id, { status: 'retired', base_url: null, body_url: null, portrait_url: null, portrait_urls: [] })
}
