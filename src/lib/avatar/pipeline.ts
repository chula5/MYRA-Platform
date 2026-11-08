// MEMBER AVATAR — the two long steps, run from the job drainer.
//
//   portrait  her face photos → two GPT Image portraits → status 'choose'
//   body      chosen portrait + full-length photos → Nano Banana Pro A-pose body
//             → both heads marked magenta → portrait head pasted on → harmonise (face kept)
//             → arms relaxed → checks → status 'review'
//
// Each step is idempotent on its avatar row and records what it cost.

import 'server-only'
import { AVATAR_CONFIG } from './config'
import { generateGoogleImage, googleCostGbp, type ImageRef } from './google'
import { generateOpenAIImage } from './openai-image'
import { portraitPrompt, bodyPrompt, magentaPrompt, HEAD_MASK_WHAT, HARMONISE_PROMPT, RELAX_PROMPT } from './prompts'
import { toJpeg, dims, transplantHead, avatarChecks } from './image-ops'
import { getAvatar, updateAvatar, addCost, downloadPhoto, keepPicture, type MemberAvatar } from './store'

const jpg = (bytes: Buffer): ImageRef => ({ bytes, mime: 'image/jpeg' })
const png = (bytes: Buffer): ImageRef => ({ bytes, mime: 'image/png' })

async function photosOf(avatar: MemberAvatar, kind: 'face' | 'full'): Promise<Buffer[]> {
  const out: Buffer[] = []
  for (const p of avatar.photos.filter((p) => p.kind === kind)) out.push(await toJpeg(await downloadPhoto(p.path), 1000, 90))
  return out
}

/** Step one: the face. Two candidates for her to choose between. */
export async function runPortraitStep(avatarId: string, heartbeat?: () => void): Promise<void> {
  const avatar = await getAvatar(avatarId)
  if (!avatar) throw new Error('avatar gone')
  if (avatar.status !== 'portrait') return
  const faces = await photosOf(avatar, 'face')
  if (faces.length < 1) throw new Error('No face photos')
  const refs = faces.map(jpg)
  const urls: string[] = []
  for (let i = 0; i < AVATAR_CONFIG.portraitCandidates; i++) {
    heartbeat?.()
    const r = await generateOpenAIImage({ prompt: portraitPrompt(), images: refs, size: '1024x1024', quality: 'high' })
    urls.push(await keepPicture(avatar.member_id, `portrait-${i + 1}`, r.png, 'image/png'))
    await addCost(avatarId, AVATAR_CONFIG.costGbp.portrait)
  }
  await updateAvatar(avatarId, { portrait_urls: urls, status: 'choose', error: null })
}

async function fetchBytes(url: string): Promise<Buffer> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`fetch ${r.status} ${url}`)
  return Buffer.from(await r.arrayBuffer())
}

/** Step two: the body, with her face on it, standing naturally. */
export async function runBodyStep(avatarId: string, heartbeat?: () => void): Promise<void> {
  const avatar = await getAvatar(avatarId)
  if (!avatar) throw new Error('avatar gone')
  if (avatar.status !== 'body' || !avatar.portrait_url) return
  const memberId = avatar.member_id
  const portraitBytes = await toJpeg(await fetchBytes(avatar.portrait_url), 1024, 92)
  const fulls = await photosOf(avatar, 'full')
  const faces = await photosOf(avatar, 'face')
  const bodyModel = AVATAR_CONFIG.bodyModel
  let cost = 0

  // 1. A-pose body, portrait as image 1, then her full-length photos, then a face for good measure
  heartbeat?.()
  const body = await generateGoogleImage({ model: bodyModel, prompt: bodyPrompt(avatar.height_cm), images: [jpg(portraitBytes), ...fulls.map(jpg), ...faces.slice(0, 1).map(jpg)] })
  cost += googleCostGbp(body, bodyModel)

  // 2. mark both heads
  heartbeat?.()
  const [bodyMask, portraitMask] = await Promise.all([
    generateGoogleImage({ model: AVATAR_CONFIG.dressModel, prompt: magentaPrompt(HEAD_MASK_WHAT), images: [png(body.png)] }),
    generateGoogleImage({ model: AVATAR_CONFIG.dressModel, prompt: magentaPrompt(HEAD_MASK_WHAT), images: [jpg(portraitBytes)], aspect: '1:1', size: '1K' }),
  ])
  cost += googleCostGbp(bodyMask, AVATAR_CONFIG.dressModel) + googleCostGbp(portraitMask, AVATAR_CONFIG.dressModel)

  // 3. paste the portrait head on, then blend with the face kept
  heartbeat?.()
  const pasted = await transplantHead(body.png, bodyMask.png, portraitBytes, portraitMask.png)
  const blended = await generateGoogleImage({ model: bodyModel, prompt: HARMONISE_PROMPT, images: [png(pasted)] })
  cost += googleCostGbp(blended, bodyModel)

  // 4. arms down
  heartbeat?.()
  const relaxed = await generateGoogleImage({ model: bodyModel, prompt: RELAX_PROMPT, images: [png(blended.png)] })
  cost += googleCostGbp(relaxed, bodyModel)

  // 5. checks, using a fresh head mask on the final picture
  heartbeat?.()
  const finalMask = await generateGoogleImage({ model: AVATAR_CONFIG.dressModel, prompt: magentaPrompt(HEAD_MASK_WHAT), images: [png(relaxed.png)] })
  cost += googleCostGbp(finalMask, AVATAR_CONFIG.dressModel)
  const check = await avatarChecks(relaxed.png, finalMask.png)
  await addCost(avatarId, cost)
  if (!check.ok) throw new Error(`check failed: ${check.reasons.join('; ')}`)

  const d = await dims(relaxed.png)
  const [bodyUrl, baseUrl] = await Promise.all([
    keepPicture(memberId, 'body', blended.png, 'image/png'),
    keepPicture(memberId, 'base', relaxed.png, 'image/png'),
  ])
  await updateAvatar(avatarId, { body_url: bodyUrl, base_url: baseUrl, width: d.width, height: d.height, status: 'review', error: null })
}
