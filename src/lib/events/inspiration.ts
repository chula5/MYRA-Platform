// EVENT PICTURES — the database side of what she loves (and does not) for one
// occasion. A plain server module: the Events room actions (member-checked)
// and the add script call in here after checking who is asking.
//
// Each picture is hosted on Cloudinary, scored by the same vision pass as an
// inspiration image (same 34-dim vector), and read for its colours — the
// vector carries no hue, and "deep olive, chocolate, teal" is half of what
// seven satin dresses say. Event picks read them through eventPictureLens.

import 'server-only'
import crypto from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { analyseInspirationImage } from '@/app/admin/ai/analyse-inspiration'
import { vectorFromInspiration, type InspirationScores } from '@/lib/inspiration'
import { uploadImageBytesToCloudinary } from '@/lib/cloudinary-persist'

export const EVENT_PICTURES_MIGRATION_HINT = 'Run migration 0111_event_inspiration.sql first (npm run migrate)'
const missing = (m: string) => /event_inspiration_image|never_brands|max_price_gbp|nevers|schema cache|does not exist/i.test(m)

export type PictureKind = 'love' | 'not'

export interface EventPictureView {
  image_id: string
  known_event_id: string
  kind: PictureKind
  image_url: string
  status: 'pending_scoring' | 'scored' | 'failed'
  colours: string[]
}

export interface EventPictureLens {
  loves: { vector: number[]; colours: string[]; types: string[] }[]
  nots: { vector: number[]; colours: string[]; types: string[] }[]
}

const COLOUR_FAMILIES = ['white', 'cream', 'black', 'grey', 'navy', 'brown', 'camel', 'green', 'burgundy', 'red', 'blue', 'pink', 'yellow', 'orange', 'purple', 'multicolour']

const parseVector = (v: unknown): number[] | null => {
  if (Array.isArray(v)) return v as number[]
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : null } catch { return null } }
  return null
}

/** The event is hers: an id from the browser selects a row, it never grants one. */
async function ownsEvent(admin: any, memberId: string, eventId: string): Promise<boolean> {
  const { data } = await admin.from('pilot_known_event').select('event_id').eq('event_id', eventId).eq('member_id', memberId).maybeSingle()
  return !!data
}

export async function listEventPictures(admin: any, memberId: string, eventIds: string[]): Promise<EventPictureView[]> {
  if (!eventIds.length) return []
  const { data, error } = await admin.from('event_inspiration_image')
    .select('image_id, known_event_id, kind, image_url, status, colours')
    .eq('member_id', memberId).in('known_event_id', eventIds).order('created_at')
  if (error) { if (missing(error.message)) return []; throw new Error(error.message) }
  return (data ?? []) as EventPictureView[]
}

/** Host, keep and score one picture. The same bytes twice for one event are kept once. */
export async function addEventPicture(
  admin: any,
  memberId: string,
  eventId: string,
  file: { data: Buffer; contentType: string },
  kind: PictureKind = 'love',
): Promise<{ picture?: EventPictureView; error?: string }> {
  if (!(await ownsEvent(admin, memberId, eventId))) return { error: 'Event not found' }
  const key = `upload:sha1:${crypto.createHash('sha1').update(file.data).digest('hex')}`
  const { data: had, error: hadErr } = await admin.from('event_inspiration_image')
    .select('image_id').eq('known_event_id', eventId).eq('source_url', key).maybeSingle()
  if (hadErr) return { error: missing(hadErr.message) ? EVENT_PICTURES_MIGRATION_HINT : hadErr.message }
  if (had) return { error: 'That picture is already here' }

  const url = await uploadImageBytesToCloudinary(file.data, file.contentType || 'image/jpeg', {
    folder: `events/${eventId}`, publicId: `event-${Date.now()}`,
  })
  if (!url) return { error: 'Could not save that picture — try again' }

  const { data: row, error } = await admin.from('event_inspiration_image').insert({
    member_id: memberId, known_event_id: eventId, kind: kind === 'not' ? 'not' : 'love', image_url: url, source_url: key,
  }).select('image_id, known_event_id, kind, image_url, status, colours').single()
  if (error) return { error: missing(error.message) ? EVENT_PICTURES_MIGRATION_HINT : error.message }

  await scoreEventPicture(admin, row.image_id, url)
  const { data: fresh } = await admin.from('event_inspiration_image')
    .select('image_id, known_event_id, kind, image_url, status, colours').eq('image_id', row.image_id).maybeSingle()
  return { picture: (fresh ?? row) as EventPictureView }
}

/** The vision pass and the colour read, written onto the row. A failure is kept, never thrown. */
export async function scoreEventPicture(admin: any, imageId: string, imageUrl: string): Promise<boolean> {
  const [{ data: a, error }, colours] = await Promise.all([analyseInspirationImage(imageUrl), readPictureColours(imageUrl)])
  if (error || !a) {
    await admin.from('event_inspiration_image')
      .update({ status: 'failed', colours, scoring_error: error ?? 'Vision pass returned nothing', updated_at: new Date().toISOString() })
      .eq('image_id', imageId)
    return false
  }
  const scores: InspirationScores = {
    construction: a.construction, volume: a.volume, colour_story: a.colour_story,
    surface_story: a.surface_story, pattern: a.pattern, colour_depth: a.colour_depth,
    sheen: a.sheen, formality: a.formality, item_types: a.item_types,
  }
  await admin.from('event_inspiration_image').update({
    status: 'scored', scores, occasion_read: a.occasion_read, score_confidence: a.score_confidence,
    vector: vectorFromInspiration(scores, a.occasion_read), colours, scoring_error: null, updated_at: new Date().toISOString(),
  }).eq('image_id', imageId)
  return true
}

export async function setEventPictureKind(admin: any, memberId: string, imageId: string, kind: PictureKind): Promise<{ error?: string }> {
  const { error } = await admin.from('event_inspiration_image')
    .update({ kind: kind === 'not' ? 'not' : 'love', updated_at: new Date().toISOString() })
    .eq('image_id', imageId).eq('member_id', memberId)
  return error ? { error: error.message } : {}
}

export async function removeEventPicture(admin: any, memberId: string, imageId: string): Promise<{ error?: string }> {
  const { error } = await admin.from('event_inspiration_image').delete().eq('image_id', imageId).eq('member_id', memberId)
  return error ? { error: error.message } : {}
}

/** The scored pictures of one event, as the picks ranking reads them. */
export async function eventPictureLens(admin: any, eventId: string): Promise<EventPictureLens> {
  const { data, error } = await admin.from('event_inspiration_image')
    .select('kind, vector, colours, scores').eq('known_event_id', eventId).eq('status', 'scored')
  if (error) return { loves: [], nots: [] }
  const lens: EventPictureLens = { loves: [], nots: [] }
  for (const r of (data ?? []) as any[]) {
    const vector = parseVector(r.vector)
    if (!vector?.length) continue
    ;(r.kind === 'not' ? lens.nots : lens.loves).push({ vector, colours: r.colours ?? [], types: r.scores?.item_types ?? [] })
  }
  return lens
}

/** The colour families of the clothes in a picture (not the background), main colour first. */
async function readPictureColours(imageUrl: string): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return []
  try {
    const safeUrl = imageUrl.includes('res.cloudinary.com') ? imageUrl.replace('/upload/', '/upload/c_limit,w_900,q_auto:good/') : imageUrl
    const res = await fetch(safeUrl)
    if (!res.ok) return []
    const type = res.headers.get('content-type') || 'image/jpeg'
    const mediaType = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].find((t) => type.includes(t)) ?? 'image/jpeg') as 'image/jpeg'
    const data = Buffer.from(await res.arrayBuffer()).toString('base64')
    const client = new Anthropic({ apiKey })
    const out = await client.messages.create({
      model: 'claude-haiku-5-5',
      // Room to think before the three words: at 60 the model thought and never answered.
      max_tokens: 600,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: `Which colour families are the CLOTHES in this picture (not the background, not the skin)? Answer with 1-3 words from this list only, main colour first, comma-separated, nothing else: ${COLOUR_FAMILIES.join(', ')}. Olive and teal are green; chocolate is brown; plum and violet are purple; dark red florals are burgundy.` },
      ] }],
    })
    const block = out.content.find((b) => b.type === 'text')
    const text = block && block.type === 'text' ? block.text.toLowerCase() : ''
    return text.split(/[^a-z]+/).filter((w, i, all) => COLOUR_FAMILIES.includes(w) && all.indexOf(w) === i).slice(0, 3)
  } catch (err) {
    console.error('[event picture colours]', err)
    return []
  }
}
