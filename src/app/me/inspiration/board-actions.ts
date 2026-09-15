'use server'

// INSPIRATION — the browser-callable surface for her pictures page. The member
// is resolved on the server (her session, or the member Chloe names when testing
// from HER VIEW — admin only); the shared module does the rest.

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { resolveClientMember, firstNameOf } from '@/lib/client-member'
import {
  addReferencePicturesFor, listReferencePicturesFor,
  type AddPicturesResult, type ReferencePicture,
} from '@/lib/reference-pictures'

export interface InspirationBoardView {
  memberId: string | null
  firstName: string
  test: boolean
  pictures: ReferencePicture[]
  styleName: string | null
  error?: string
}

export async function loadMyInspiration(asMemberId?: string): Promise<InspirationBoardView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { memberId: null, firstName: '', test: false, pictures: [], styleName: null }
  const r = await listReferencePicturesFor(createAdminClient() as any, me.memberId)
  return { memberId: me.memberId, firstName: firstNameOf(me.name), test: me.test, ...r }
}

/** Files under `files`, links under `urls`; `asMemberId` only when Chloe is testing. */
export async function addMyInspiration(formData: FormData): Promise<AddPicturesResult> {
  const asMemberId = String(formData.get('asMemberId') ?? '') || undefined
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const r = await addReferencePicturesFor(createAdminClient() as any, me.memberId, formData)
  revalidatePath('/me/inspiration')
  return r
}
