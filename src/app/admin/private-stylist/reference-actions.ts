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
import {
  addReferencePicturesFor, listReferencePicturesFor,
  type AddPicturesResult, type ReferencePicture,
} from '@/lib/reference-pictures'

export type { ReferencePicture } from '@/lib/reference-pictures'

const PATH = '/admin/private-stylist'

async function isAdmin(): Promise<boolean> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user && user.id === process.env.ADMIN_USER_ID
}

// The work is shared with her own INSPIRATION page (lib/reference-pictures);
// these are the admin's doors onto it.
export async function listMemberReferencePictures(memberId: string): Promise<{
  pictures: ReferencePicture[]
  styleName: string | null
  error?: string
}> {
  if (!(await isAdmin())) return { pictures: [], styleName: null, error: 'Not authorised' }
  return listReferencePicturesFor(createAdminClient() as any, memberId)
}

/**
 * Add pictures from files, pasted screenshots and/or image links. A screenshot
 * of several outfits (a Pinterest board) is split so each outfit is saved and
 * scored on its own; every piece keeps the screenshot it came from.
 */
export async function addMemberReferencePictures(formData: FormData): Promise<AddPicturesResult> {
  if (!(await isAdmin())) return { error: 'Not authorised' }
  const memberId = String(formData.get('memberId') ?? '')
  if (!memberId) return { error: 'No member' }
  const r = await addReferencePicturesFor(createAdminClient() as any, memberId, formData)
  revalidatePath(PATH)
  return r
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
