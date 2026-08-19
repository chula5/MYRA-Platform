'use server'

// CLIENT AREA — her uploads, her read, her payoff.
//
// An upload must visibly do something or she won't do it again, so every upload
// returns three looks from the live feed nearest what she just added.
//
// Pool separation is enforced here: uploads log a taste event in the
// ASPIRATIONAL pool and never touch the persona decay, which only behaviour
// drives. The gap between the two pools is the finding, so they never merge.

import crypto from 'crypto'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { analyseInspirationImage } from '@/app/admin/ai/analyse-inspiration'
import {
  vectorFromInspiration,
  SCORE_DIMENSIONS,
  type InspirationScores,
} from '@/lib/inspiration'
import { buildOutfitVector, cosine } from '@/lib/taste-vector'
import { poolFor, personaWeight, shouldRecompute } from '@/lib/user-persona'
import type { OutfitWithItems } from '@/types/database'

const CLOUD_NAME = 'dugby2pow'
const API_KEY = '333725823491761'
const API_SECRET = 'xlmEKzOlLW9rLxNA6rqTQBn3dkk'

const UPLOAD_SIGNAL_WEIGHT = 5

async function requireClient() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' as const }
  return { user }
}

/** Upload the raw file straight to Cloudinary — she picks from a camera roll,
 *  so there is no source URL to re-host. */
async function uploadFileToCloudinary(file: File, folder: string): Promise<string | null> {
  try {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const publicId = `up-${crypto.randomBytes(6).toString('hex')}`
    const toSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`
    const signature = crypto.createHash('sha1').update(toSign + API_SECRET).digest('hex')

    const form = new FormData()
    form.append('api_key', API_KEY)
    form.append('timestamp', timestamp)
    form.append('signature', signature)
    form.append('folder', folder)
    form.append('public_id', publicId)
    form.append('file', file)

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: form,
    })
    const data = await res.json()
    if (!data.secure_url) {
      console.error('[uploadFileToCloudinary]', data.error?.message ?? 'no secure_url')
      return null
    }
    return data.secure_url as string
  } catch (err) {
    console.error('[uploadFileToCloudinary]', err)
    return null
  }
}

export interface UploadResult {
  imageId?: string
  imageUrl?: string
  scores?: InspirationScores
  readAs?: string[]          // the plain-language read shown back to her
  occasions?: string[]
  because?: { outfit_id: string; image_url: string; label: string }[]
  error?: string
}

/**
 * One upload, end to end: Cloudinary → InspirationImage (source=user_upload,
 * linked to her persona) → vision score → taste event → three nearest looks.
 */
export async function uploadInspiration(formData: FormData): Promise<UploadResult> {
  const auth = await requireClient()
  if ('error' in auth) return { error: auth.error }
  const user = auth.user

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'No image selected' }
  if (file.size > 15 * 1024 * 1024) return { error: 'That image is very large — try one under 15MB' }

  const admin = createAdminClient() as any
  const { data: assignment } = await admin
    .from('user_persona').select('persona_id').eq('user_id', user.id).maybeSingle()
  const personaId = assignment?.persona_id
  if (!personaId) return { error: 'No stylist assigned yet — ask MYRA to set you up' }

  const hosted = await uploadFileToCloudinary(file, `inspiration/${personaId}`)
  if (!hosted) return { error: 'Could not save that image — try again' }

  const { data: row, error: insErr } = await admin.from('inspiration_image').insert({
    persona_id: personaId,
    user_id: user.id,
    image_url: hosted,
    source: 'user_upload',
    status: 'pending_scoring',
  }).select('image_id').single()
  if (insErr || !row) return { error: insErr?.message ?? 'Could not save that image' }
  const imageId = row.image_id as string

  // Score it now — she is standing there waiting for the read.
  const { data: a, error: verr } = await analyseInspirationImage(hosted)
  if (verr || !a) {
    await admin.from('inspiration_image')
      .update({ scoring_error: verr ?? 'Vision pass failed' }).eq('image_id', imageId)
    return { imageId, imageUrl: hosted, error: 'Saved, but we could not read it just now' }
  }

  const scores: InspirationScores = {
    construction: a.construction, volume: a.volume, colour_story: a.colour_story,
    surface_story: a.surface_story, pattern: a.pattern, colour_depth: a.colour_depth,
    sheen: a.sheen, formality: a.formality, item_types: a.item_types,
  }
  const vector = vectorFromInspiration(scores, a.occasion_read)

  await admin.from('inspiration_image').update({
    status: 'scored',
    scores,
    scores_original: scores,
    occasion_read: a.occasion_read,
    score_confidence: a.score_confidence,
    vector,
    updated_at: new Date().toISOString(),
  }).eq('image_id', imageId)

  await logUploadEvent(admin, user.id, imageId)

  return {
    imageId,
    imageUrl: hosted,
    scores,
    readAs: readAsChips(scores),
    occasions: a.occasion_read,
    because: await nearestLooks(admin, vector, 3),
  }
}

/** Her read, in plain language — "relaxed fit, saturated print, low sheen". */
function readAsChips(s: InspirationScores): string[] {
  const words: Record<string, [string, string, string, string, string]> = {
    construction: ['sharply tailored', 'tailored', 'easy', 'relaxed', 'undone'],
    volume: ['close to the body', 'neat', 'balanced', 'roomy', 'oversized'],
    colour_story: ['tonal', 'quiet colour', 'considered colour', 'bold colour', 'high contrast'],
    surface_story: ['flat surface', 'clean', 'some texture', 'textured', 'rich texture'],
    pattern: ['solid', 'barely there pattern', 'some pattern', 'patterned', 'statement print'],
    colour_depth: ['pale', 'soft', 'mid-depth', 'deep', 'saturated'],
    sheen: ['matte', 'soft matte', 'light sheen', 'lustrous', 'high shine'],
    formality: ['everyday', 'easy day', 'smart', 'dressed', 'black tie'],
  }
  const out: string[] = []
  for (const d of SCORE_DIMENSIONS) {
    const v = s[d.key]
    if (typeof v === 'number' && v >= 1 && v <= 5) out.push(words[d.key][v - 1])
  }
  return out
}

/** Taste signal for an upload: aspirational pool, weight +5. */
async function logUploadEvent(admin: any, userId: string, imageId: string): Promise<void> {
  try {
    await admin.from('taste_event').insert({
      user_id: userId,
      event_type: 'inspiration_upload',
      signal_weight: UPLOAD_SIGNAL_WEIGHT,
      pool: poolFor('inspiration_upload'),
      inspiration_image_id: imageId,
    })
    // The persona weight is recomputed on the 10-event boundary — from
    // BEHAVIOURAL events only, so an upload never moves it.
    const { count: total } = await admin
      .from('taste_event').select('event_id', { count: 'exact', head: true }).eq('user_id', userId)
    if (shouldRecompute(total ?? 0)) await recomputePersonaWeight(userId)
  } catch (err) {
    console.error('[logUploadEvent]', err)
  }
}

/** weight = max(0.3, 0.9 − 0.02 × behavioural_event_count). */
export async function recomputePersonaWeight(userId: string): Promise<{ weight?: number; error?: string }> {
  try {
    const admin = createAdminClient() as any
    const { data: assignment } = await admin
      .from('user_persona').select('persona_id, weight').eq('user_id', userId).maybeSingle()
    if (!assignment) return { error: 'No persona assigned' }

    const { count } = await admin
      .from('taste_event')
      .select('event_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .neq('event_type', 'inspiration_upload')
    const behavioural = count ?? 0
    const weight = personaWeight(behavioural)

    if (weight !== assignment.weight) {
      await admin.from('user_persona')
        .update({ weight, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
      await admin.from('user_persona_weight_log').insert({
        user_id: userId, persona_id: assignment.persona_id, weight, event_count: behavioural,
      })
    }
    return { weight }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Recompute failed' }
  }
}

/** Three live looks nearest the uploaded image — the immediate payoff. */
async function nearestLooks(
  admin: any,
  vector: number[],
  n: number,
): Promise<{ outfit_id: string; image_url: string; label: string }[]> {
  try {
    const { data } = await admin
      .from('outfit').select('*, outfit_item(*, item(*, brand(*)))').eq('status', 'live')
    const live = (data ?? []) as OutfitWithItems[]
    return live
      .map((o) => ({ o, score: cosine(buildOutfitVector(o), vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map(({ o }) => ({
        outfit_id: (o as any).outfit_id,
        image_url: (o as any).image_url,
        label: (o as any).aesthetic_label ?? '',
      }))
  } catch (err) {
    console.error('[nearestLooks]', err)
    return []
  }
}

/**
 * Her correction of the read. High-value signal: she is the authority on her
 * own taste, so both values are kept — the original vision read and her fix.
 */
export async function correctMyRead(
  imageId: string,
  patch: Partial<InspirationScores>,
): Promise<{ readAs?: string[]; error?: string }> {
  const auth = await requireClient()
  if ('error' in auth) return { error: auth.error }

  const admin = createAdminClient() as any
  const { data: row } = await admin
    .from('inspiration_image').select('*').eq('image_id', imageId).maybeSingle()
  if (!row) return { error: 'Image not found' }
  if (row.user_id !== auth.user.id) return { error: 'Not your image' }

  const next: InspirationScores = { ...(row.scores ?? {}), ...patch }
  const original: InspirationScores = row.scores_original ?? row.scores ?? {}
  const corrected = new Set<string>(row.corrected_fields ?? [])
  for (const key of Object.keys(patch) as (keyof InspirationScores)[]) {
    if (JSON.stringify((original as any)[key] ?? null) === JSON.stringify((next as any)[key] ?? null)) corrected.delete(key as string)
    else corrected.add(key as string)
  }

  await admin.from('inspiration_image').update({
    scores: next,
    corrected_fields: Array.from(corrected),
    corrected_at: corrected.size ? new Date().toISOString() : null,
    vector: vectorFromInspiration(next, row.occasion_read ?? []),
    updated_at: new Date().toISOString(),
  }).eq('image_id', imageId)

  revalidatePath('/me/inspiration')
  return { readAs: readAsChips(next) }
}

