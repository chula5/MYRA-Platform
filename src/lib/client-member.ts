// WHOSE PAGE IS THIS — the one question every client page answers first.
//
// Her rooms (For You, Dressing Room, Inspiration) run for two people: Alison,
// signed in, and Chloe testing them as Alison from HER VIEW. The member is
// always resolved on the server: from her session, or from the id Chloe names
// — and a named id is honoured only for the admin. A browser-supplied member
// id from anyone else resolves to nobody.

import 'server-only'
import { cache } from 'react'

// React's per-request cache exists in the React that Next ships; a plain
// `react` (vitest, scripts) has none, and there a call is simply uncached.
const perRequest: <F extends (...args: never[]) => unknown>(fn: F) => F =
  typeof cache === 'function' ? cache : (fn) => fn
import { createAdminClient, createServerClient } from '@/lib/supabase-server'

export interface ClientMember {
  memberId: string
  name: string
  authUserId: string | null
  /** Chloe testing as her: show everything, record nothing she would. */
  test: boolean
}

// Cached per request: the layout, the page and its loader all ask, and the
// answer cannot change between them.
export const resolveClientMember = perRequest(async (asMemberId?: string | null): Promise<ClientMember | null> => {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as any
  // HER VIEW frames her real pages: the member Chloe chose rides in on a
  // cookie scoped to /me, so every room and its actions open as her, in test.
  if (!asMemberId && user.id === process.env.ADMIN_USER_ID) asMemberId = await herViewMemberId()
  if (asMemberId) {
    if (user.id !== process.env.ADMIN_USER_ID) return null
    const { data } = await admin.from('pilot_member')
      .select('member_id, name, auth_user_id').eq('member_id', asMemberId).maybeSingle()
    return data ? { memberId: data.member_id, name: data.name, authUserId: data.auth_user_id ?? null, test: true } : null
  }
  const { data } = await admin.from('pilot_member')
    .select('member_id, name, auth_user_id').eq('auth_user_id', user.id).maybeSingle()
  return data ? { memberId: data.member_id, name: data.name, authUserId: data.auth_user_id ?? null, test: false } : null
})

/** The cookie HER VIEW sets for Chloe — honoured only for the admin, sent only to /me. */
export const HER_VIEW_COOKIE = 'myra_her_view'

async function herViewMemberId(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers')
    return (await cookies()).get(HER_VIEW_COOKIE)?.value || null
  } catch { return null }
}

/** Her first name, for headings. */
export const firstNameOf = (name: string): string => (name ?? '').trim().split(/\s+/)[0] ?? ''
