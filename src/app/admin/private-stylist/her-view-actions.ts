'use server'

// HER VIEW opens her real pages as her. The member rides on a cookie scoped
// to /me, read only when the signed-in user is the admin. Admin only.

import { cookies } from 'next/headers'
import { assertAdmin } from '@/lib/admin-audit'
import { HER_VIEW_COOKIE } from '@/lib/client-member'

/** Open /me as this member (test mode), or stop with null. */
export async function setHerView(memberId: string | null): Promise<void> {
  await assertAdmin()
  const store = await cookies()
  if (!memberId) { store.delete({ name: HER_VIEW_COOKIE, path: '/me' }); return }
  store.set(HER_VIEW_COOKIE, memberId, {
    path: '/me', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    // A session's worth: a forgotten one lapses rather than haunting her /me.
    maxAge: 60 * 60 * 6,
  })
}
