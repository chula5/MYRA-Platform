'use server'

// The link Chloe sends a client so she can make her own login. Admin only.

import { assertAdmin } from '@/lib/admin-audit'
import { createAdminClient } from '@/lib/supabase-server'
import { mintInvite, INVITE_DAYS } from '@/lib/member-invite'

export async function createMemberInvite(memberId: string, origin?: string): Promise<{ url?: string; name?: string; hasLogin?: boolean; days?: number; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('member_id, name, auth_user_id').eq('member_id', memberId).maybeSingle()
  if (!member) return { error: 'Member not found' }
  if (member.auth_user_id) return { name: member.name, hasLogin: true, error: `${member.name} already has a login — she signs in at /signin` }
  const base = (process.env.NEXT_PUBLIC_SITE_URL || origin || 'http://localhost:3000').replace(/\/+$/, '')
  return { url: `${base}/welcome/${encodeURIComponent(mintInvite(member.member_id))}`, name: member.name, days: INVITE_DAYS }
}
