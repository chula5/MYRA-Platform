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
import { persistImageToCloudinary, uploadImageBytesToCloudinary } from '@/lib/cloudinary-persist'
import { scoreInspirationImages } from '@/app/admin/stylists/inspiration-actions'

const PATH = '/admin/private-stylist'
const MAX_FILE_BYTES = 9 * 1024 * 1024

async function isAdmin(): Promise<boolean> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user && user.id === process.env.ADMIN_USER_ID
}

export interface ReferencePicture {
  image_id: string
  image_url: string
  status: string
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
    .select('image_id, image_url, status, scores, occasion_read, scoring_error, created_at')
    .in('user_id', owners).neq('status', 'rejected').order('created_at', { ascending: false })
  if (error) return { pictures: [], styleName, error: error.message }
  return {
    styleName,
    pictures: ((data ?? []) as any[]).map((r) => ({
      image_id: r.image_id,
      image_url: r.image_url,
      status: r.status,
      itemTypes: r.scores?.item_types ?? [],
      occasions: r.occasion_read ?? [],
      scoringError: r.scoring_error ?? null,
      created_at: r.created_at,
    })),
  }
}

/** Add pictures from files and/or image links, then score them. */
export async function addMemberReferencePictures(formData: FormData): Promise<{ added?: number; failed?: number; error?: string }> {
  if (!(await isAdmin())) return { error: 'Not authorised' }
  const memberId = String(formData.get('memberId') ?? '')
  if (!memberId) return { error: 'No member' }

  const admin = createAdminClient() as any
  const { data: assignment } = await admin.from('user_persona').select('persona_id').eq('user_id', memberId).maybeSingle()
  const personaId = assignment?.persona_id
  if (!personaId) return { error: 'Assign her a house style first — her pictures are stored alongside it' }

  const folder = `inspiration/${personaId}/client-${memberId.slice(0, 8)}`
  const urls: string[] = []
  let failed = 0

  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    if (f.size > MAX_FILE_BYTES) { failed++; continue }
    const hosted = await uploadImageBytesToCloudinary(Buffer.from(await f.arrayBuffer()), f.type || 'image/jpeg', {
      folder, publicId: `ref-${memberId.slice(0, 8)}-${Date.now()}-${i}`,
    })
    if (hosted) urls.push(hosted); else failed++
  }

  const links = String(formData.get('urls') ?? '').split(/[\s,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u))
  for (let i = 0; i < links.length; i++) {
    const link = links[i]
    const hosted = await persistImageToCloudinary(link, { folder, publicId: `ref-${memberId.slice(0, 8)}-${Date.now()}-l${i}` })
    if (hosted) urls.push(hosted); else failed++
  }

  if (!urls.length) return { added: 0, failed, error: failed ? 'Could not save those pictures' : 'Choose pictures or paste image links' }

  const { error } = await admin.from('inspiration_image').insert(urls.map((u) => ({
    persona_id: personaId,
    user_id: memberId,
    image_url: u,
    source_url: u,
    source: 'user_upload',
    status: 'pending_scoring',
  })))
  if (error) return { error: error.message }

  // Score now: an unscored picture has no vector, so it cannot shape her looks.
  await scoreInspirationImages(personaId, 40)
  revalidatePath(PATH)
  return { added: urls.length, failed }
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
