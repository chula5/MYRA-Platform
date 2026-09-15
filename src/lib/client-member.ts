// WHOSE PAGE IS THIS — the one question every client page answers first.
//
// Her rooms (For You, Dressing Room, Inspiration) run for two people: Alison,
// signed in, and Chloe testing them as Alison from HER VIEW. The member is
// always resolved on the server: from her session, or from the id Chloe names
// — and a named id is honoured only for the admin. A browser-supplied member
// id from anyone else resolves to nobody.

import 'server-only'
import { createAdminClient, createServerClient } from '@/lib/supabase-server'

export interface ClientMember {
  memberId: string
  name: string
  authUserId: string | null
  /** Chloe testing as her: show everything, record nothing she would. */
  test: boolean
}

export async function resolveClientMember(asMemberId?: string | null): Promise<ClientMember | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as any
  if (asMemberId) {
    if (user.id !== process.env.ADMIN_USER_ID) return null
    const { data } = await admin.from('pilot_member')
      .select('member_id, name, auth_user_id').eq('member_id', asMemberId).maybeSingle()
    return data ? { memberId: data.member_id, name: data.name, authUserId: data.auth_user_id ?? null, test: true } : null
  }
  const { data } = await admin.from('pilot_member')
    .select('member_id, name, auth_user_id').eq('auth_user_id', user.id).maybeSingle()
  return data ? { memberId: data.member_id, name: data.name, authUserId: data.auth_user_id ?? null, test: false } : null
}

/** Her first name, for headings. */
export const firstNameOf = (name: string): string => (name ?? '').trim().split(/\s+/)[0] ?? ''
