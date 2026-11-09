'use server'

// MEMBER AVATAR — her actions. Every export here is public (see server-action-gating): each
// one resolves the member on the server first and touches only her rows.

import { revalidatePath } from 'next/cache'
import { resolveClientMember } from '@/lib/client-member'
import { AVATAR_CONFIG, avatarConfigured } from '@/lib/avatar/config'
import { createAvatar, liveAvatarFor, updateAvatar, deletePhotos, retireAvatar, signedPhotoUrls, type MemberAvatar } from '@/lib/avatar/store'
import { enqueueAvatarJob, kickAvatarDrain, openJobFor } from '@/lib/avatar/jobs'
import { queueWardrobeLayers } from '@/lib/avatar/wardrobe'
import { CONSENT_TEXT } from './consent'

const PATH = '/me/avatar'

export interface MyAvatarView {
  memberId: string
  firstName: string
  configured: boolean
  avatar: (MemberAvatar & { photoUrls: Record<string, string>; job: { status: string; error: string | null } | null }) | null
}

export async function loadMyAvatar(): Promise<MyAvatarView | { error: string }> {
  const m = await resolveClientMember()
  if (!m) return { error: 'Not signed in' }
  const avatar = await liveAvatarFor(m.memberId)
  let job: { status: string; error: string | null } | null = null
  if (avatar && (avatar.status === 'portrait' || avatar.status === 'body')) {
    const j = await openJobFor(avatar.status, avatar.avatar_id)
    job = j ? { status: j.status, error: j.error } : null
    // a job that should exist but doesn't (deploy in between, say) is queued again
    if (!j || j.status === 'failed') { await enqueueAvatarJob(avatar.status, avatar.avatar_id, m.memberId, 1); kickAvatarDrain() }
  }
  return {
    memberId: m.memberId,
    firstName: (m.name ?? '').trim().split(/\s+/)[0] ?? '',
    configured: avatarConfigured().ok,
    avatar: avatar ? { ...avatar, photoUrls: await signedPhotoUrls((avatar.photos ?? []).map((p) => p.path)), job } : null,
  }
}

/** Photos + consent in, a portrait job out. FormData: face[] files, full[] files, height_cm, consent=yes. */
export async function startMyAvatar(formData: FormData): Promise<{ avatarId?: string; error?: string }> {
  const m = await resolveClientMember()
  if (!m) return { error: 'Not signed in' }
  const cfg = avatarConfigured()
  if (!cfg.ok) return { error: `MYRA's avatar studio is not switched on yet (${cfg.missing.join(', ')})` }
  if (formData.get('consent') !== 'yes') return { error: 'Please agree to how your photos are used first' }
  const faces = formData.getAll('face').filter((f): f is File => f instanceof File && f.size > 0)
  const fulls = formData.getAll('full').filter((f): f is File => f instanceof File && f.size > 0)
  if (faces.length < 2) return { error: 'Add at least two photos of your face' }
  if (fulls.length < 1) return { error: 'Add at least one full-length photo' }
  if (faces.length + fulls.length > AVATAR_CONFIG.maxPhotos) return { error: `${AVATAR_CONFIG.maxPhotos} photos at most` }
  for (const f of [...faces, ...fulls]) {
    if (!f.type.startsWith('image/')) return { error: `${f.name} is not an image` }
    if (f.size > AVATAR_CONFIG.maxPhotoBytes) return { error: `${f.name} is too large` }
  }
  const heightRaw = Number(formData.get('height_cm') ?? 0)
  const heightCm = heightRaw >= 120 && heightRaw <= 220 ? Math.round(heightRaw) : null
  const { normalisePhoto } = await import('@/lib/wardrobe/cutout')
  const toJpeg = async (f: File) => {
    const { png } = await normalisePhoto(Buffer.from(await f.arrayBuffer()), 1600)
    const m: any = await import('sharp'); const sharp = m.default ?? m
    return sharp(png).jpeg({ quality: 90 }).toBuffer()
  }
  try {
    const photos = [
      ...(await Promise.all(faces.map(async (f) => ({ bytes: await toJpeg(f), kind: 'face' as const, name: f.name })))),
      ...(await Promise.all(fulls.map(async (f) => ({ bytes: await toJpeg(f), kind: 'full' as const, name: f.name })))),
    ]
    const avatar = await createAvatar(m.memberId, { photos, heightCm, consentText: CONSENT_TEXT })
    await enqueueAvatarJob('portrait', avatar.avatar_id, m.memberId, 1)
    kickAvatarDrain()
    revalidatePath(PATH)
    return { avatarId: avatar.avatar_id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not start your avatar' }
  }
}

/** She picked a face: fix it and make the body. */
export async function chooseMyPortrait(index: number): Promise<{ error?: string }> {
  const m = await resolveClientMember()
  if (!m) return { error: 'Not signed in' }
  const avatar = await liveAvatarFor(m.memberId)
  if (!avatar || avatar.status !== 'choose') return { error: 'Nothing to choose yet' }
  const url = avatar.portrait_urls?.[index]
  if (!url) return { error: 'That portrait is not there' }
  await updateAvatar(avatar.avatar_id, { portrait_url: url, status: 'body', error: null })
  await enqueueAvatarJob('body', avatar.avatar_id, m.memberId, 1)
  kickAvatarDrain()
  revalidatePath(PATH)
  return {}
}

/** The body is hers: approve it. Her photos are deleted; MYRA keeps only what it made. */
export async function approveMyAvatar(): Promise<{ error?: string }> {
  const m = await resolveClientMember()
  if (!m) return { error: 'Not signed in' }
  const avatar = await liveAvatarFor(m.memberId)
  if (!avatar || avatar.status !== 'review' || !avatar.base_url) return { error: 'Nothing to approve yet' }
  await updateAvatar(avatar.avatar_id, { status: 'ready', approved_at: new Date().toISOString() })
  await deletePhotos(avatar).catch(() => undefined)
  // her wardrobe goes on it from here: every wearable piece, every way, defaults first
  try { await queueWardrobeLayers({ ...avatar, status: 'ready' }); kickAvatarDrain() } catch (e) { console.error('[avatar] queue wardrobe', e) }
  revalidatePath(PATH)
  revalidatePath('/me/dressing-room')
  return {}
}

/** Not her: make the body again from the same portrait, or go back to the photos. */
export async function retakeMyAvatar(what: 'body' | 'all'): Promise<{ error?: string }> {
  const m = await resolveClientMember()
  if (!m) return { error: 'Not signed in' }
  const avatar = await liveAvatarFor(m.memberId)
  if (!avatar) return { error: 'No avatar yet' }
  if (what === 'body') {
    if (!avatar.portrait_url) return { error: 'Choose a portrait first' }
    if (!avatar.photos?.length) return { error: 'Your photos were deleted when the avatar was approved; start again with new photos' }
    await updateAvatar(avatar.avatar_id, { status: 'body', error: null, attempts: avatar.attempts + 1 })
    await enqueueAvatarJob('body', avatar.avatar_id, m.memberId, 1)
    kickAvatarDrain()
  } else {
    await retireAvatar(m.memberId)
  }
  revalidatePath(PATH)
  return {}
}

export async function deleteMyAvatar(): Promise<{ error?: string }> {
  const m = await resolveClientMember()
  if (!m) return { error: 'Not signed in' }
  await retireAvatar(m.memberId)
  revalidatePath(PATH)
  revalidatePath('/me/dressing-room')
  return {}
}
