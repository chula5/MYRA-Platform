'use server'

// HER REFERENCE PICTURES — images a client likes, added on her profile.
//
// They are scored exactly like a house style's moodboard (same vision pass,
// same 34-dim vector) but they belong to HER: they shape her looks through a
// second lens in the composer, they never fade, and they never move the house
// style every other client on it inherits. They are stored as inspiration
// images under her house style with user_id = her member id, which is what
// keeps them out of the style's own envelope.

import { createAdminClient, createServerClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { scoreInspirationImages } from '@/app/admin/stylists/inspiration-actions'
import { picturesFromForm, intakePictures } from '@/lib/picture-intake'
import { updateLovesFromReferences } from '@/lib/reference-loves'

const PATH = '/admin/private-stylist'

async function isAdmin(): Promise<boolean> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user && user.id === process.env.ADMIN_USER_ID
}

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

export async function listMemberReferencePictures(memberId: string): Promise<{
  pictures: ReferencePicture[]
  styleName: string | null
  error?: string
}> {
  if (!(await isAdmin())) return { pictures: [], styleName: null, error: 'Not authorised' }
  const admin = createAdminClient() as any
  const [{ data: member }, { data: assignment }] = await Promise.all([
    admin.from('pilot_member').select('auth_user_id').eq('member_id', memberId).maybeSingle(),
    admin.from('user_persona').select('persona_id').eq('user_id', memberId).maybeSingle(),
  ])
  let styleName: string | null = null
  if (assignment?.persona_id) {
    const { data: s } = await admin.from('stylist').select('name').eq('stylist_id', assignment.persona_id).maybeSingle()
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
export async function addMemberReferencePictures(formData: FormData): Promise<{
  added?: number
  screenshots?: number
  failed?: number
  notes?: string[]
  /** Pieces the new pictures added to her loves list. */
  lovesAdded?: string[]
  error?: string
}> {
  if (!(await isAdmin())) return { error: 'Not authorised' }
  const memberId = String(formData.get('memberId') ?? '')
  if (!memberId) return { error: 'No member' }

  const admin = createAdminClient() as any
  const { data: assignment } = await admin.from('user_persona').select('persona_id').eq('user_id', memberId).maybeSingle()
  const personaId = assignment?.persona_id
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
  await scoreInspirationImages(personaId, Math.max(40, rows.length))
  // What the pictures keep showing goes on her loves list (never an avoided piece).
  const loves = await updateLovesFromReferences(admin, memberId, ((inserted ?? []) as any[]).map((r) => r.image_id))
  revalidatePath(PATH)
  return { added: rows.length, screenshots, failed, notes, lovesAdded: loves.added }
}

export async function removeMemberReferencePicture(imageId: string): Promise<{ error?: string }> {
  if (!(await isAdmin())) return { error: 'Not authorised' }
  const admin = createAdminClient() as any
  // Only a client's picture — never an image of the house style itself.
  const { error } = await admin.from('inspiration_image').delete().eq('image_id', imageId).not('user_id', 'is', null)
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}
