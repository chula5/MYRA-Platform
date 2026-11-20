'use server'

// DELETE MY ACCOUNT — from YOU. Apple requires that anyone who can make an
// account in the app can also delete it there (App Review 5.1.1(v)). This
// removes her member row (46 tables cascade from it), the pieces she owns, and
// her login, then signs her out. Only she can do it, from her own session:
// Chloe in HER VIEW (test) and the admin login are refused.

import { redirect } from 'next/navigation'
import { resolveClientMember } from '@/lib/client-member'
import { createAdminClient, createServerClient } from '@/lib/supabase-server'
import { forgetMemberMemory } from '@/lib/member-memory'

export async function deleteMyAccount(): Promise<{ error?: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are signed out already.' }
  if (user.id === process.env.ADMIN_USER_ID) return { error: 'The house account cannot be deleted from here.' }

  const me = await resolveClientMember()
  if (me?.test) return { error: 'This is a preview of her room. Nothing was deleted.' }
  const admin = createAdminClient() as any

  try {
    if (me) {
      // Two quality-lab tables point at the member without a cascade: let go of her, keep the run.
      for (const table of ['outfit_quality_case', 'outfit_quality_batch']) {
        await admin.from(table).update({ real_member_id: null }).eq('real_member_id', me.memberId)
      }
      // The pieces she owns are hers, not stock.
      await admin.from('item').delete().eq('ownership', 'owned').in('owner_user_id', [me.memberId, user.id])
      const { error } = await admin.from('pilot_member').delete().eq('member_id', me.memberId)
      if (error) throw error
      forgetMemberMemory(me.memberId)
    } else {
      await admin.from('item').delete().eq('ownership', 'owned').eq('owner_user_id', user.id)
    }
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) throw error
  } catch (e) {
    console.error('[delete-account]', e)
    return { error: 'Something stopped your account being deleted. Please try again, or email hello@myraassistant.co.uk and we will do it for you.' }
  }

  await supabase.auth.signOut().catch(() => {})
  redirect('/signin?deleted=1')
}
