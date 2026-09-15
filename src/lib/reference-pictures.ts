// HER REFERENCE PICTURES — shared by Chloe's admin (her profile) and Alison's
// own INSPIRATION page. Plain server module: callers check who is asking first
// (reference-actions.ts for the admin, app/me/inspiration/board-actions.ts for
// the member), then pass the resolved member id — never one from the browser.
//
// Pictures are stored as inspiration images under her house style with
// user_id = her member id: they shape her looks through the composer's second
// lens and never move the house style other clients inherit. Both her member
// id and her login id are read, so older uploads made under her login show too.

import 'server-only'
import { picturesFromForm, intakePictures } from '@/lib/picture-intake'
import { updateLovesFromReferences } from '@/lib/reference-loves'
import { scorePendingInspiration } from '@/lib/inspiration-scoring'

export interface ReferencePicture {
  image_id: string
  image_url: string
  status: string
  /** The screenshot it was cut from, when it came from a collection. */
  fromScreenshot: string | null
  itemTypes: string[]
  occasions: string[]
  scoringError: string | null
  created_at: string
}

export interface AddPicturesResult {
  added?: number
  screenshots?: number
  failed?: number
  notes?: string[]
  /** Pieces the new pictures added to her loves list. */
  lovesAdded?: string[]
  error?: string
}

async function personaFor(admin: any, memberId: string): Promise<string | null> {
  const { data } = await admin.from('user_persona').select('persona_id').eq('user_id', memberId).maybeSingle()
  return data?.persona_id ?? null
}

export async function listReferencePicturesFor(admin: any, memberId: string): Promise<{
  pictures: ReferencePicture[]
  styleName: string | null
  error?: string
}> {
  const [{ data: member }, personaId] = await Promise.all([
    admin.from('pilot_member').select('auth_user_id').eq('member_id', memberId).maybeSingle(),
    personaFor(admin, memberId),
  ])
  let styleName: string | null = null
  if (personaId) {
    const { data: s } = await admin.from('stylist').select('name').eq('stylist_id', personaId).maybeSingle()
    styleName = s?.name ?? null
  }
  const owners = [memberId, member?.auth_user_id].filter(Boolean)
  const { data, error } = await admin.from('inspiration_image')
    .select('image_id, image_url, source_url, status, scores, occasion_read, scoring_error, created_at')
    .in('user_id', owners).neq('status', 'rejected').order('created_at', { ascending: false })
  if (error) return { pictures: [], styleName, error: error.message }
  return {
    styleName,
    pictures: ((data ?? []) as any[]).map((r) => ({
      image_id: r.image_id,
      image_url: r.image_url,
      status: r.status,
      fromScreenshot: r.source_url && r.source_url !== r.image_url ? r.source_url : null,
      itemTypes: r.scores?.item_types ?? [],
      occasions: r.occasion_read ?? [],
      scoringError: r.scoring_error ?? null,
      created_at: r.created_at,
    })),
  }
}

/**
 * Add pictures from files, pasted screenshots and/or image links. A screenshot
 * of several outfits (a Pinterest board) is split so each outfit is saved and
 * scored on its own; every piece keeps the screenshot it came from.
 */
export async function addReferencePicturesFor(admin: any, memberId: string, formData: FormData): Promise<AddPicturesResult> {
  const personaId = await personaFor(admin, memberId)
  if (!personaId) return { error: 'Assign her a house style first — her pictures are stored alongside it' }

  const folder = `inspiration/${personaId}/client-${memberId.slice(0, 8)}`
  const { inputs, failed: unread } = await picturesFromForm(formData, folder)
  if (!inputs.length) return { added: 0, failed: unread, error: unread ? 'Could not save those pictures' : 'Paste, choose or link some pictures' }
  const { rows, screenshots, failed: unsaved, notes } = await intakePictures(inputs, folder)
  const failed = unread + unsaved
  if (!rows.length) return { added: 0, failed, error: 'Could not save those pictures' }

  const { data: inserted, error } = await admin.from('inspiration_image').insert(rows.map((r) => ({
    persona_id: personaId,
    user_id: memberId,
    image_url: r.image_url,
    source_url: r.source_url,
    source: 'user_upload',
    status: 'pending_scoring',
  }))).select('image_id')
  if (error) return { error: error.message }

  // Score each outfit now: an unscored picture has no vector, so it cannot shape her looks.
  await scorePendingInspiration(admin, personaId, Math.max(40, rows.length))
  // What the pictures keep showing goes on her loves list (never an avoided piece).
  const loves = await updateLovesFromReferences(admin, memberId, ((inserted ?? []) as any[]).map((r) => r.image_id))
  return { added: rows.length, screenshots, failed, notes, lovesAdded: loves.added }
}
