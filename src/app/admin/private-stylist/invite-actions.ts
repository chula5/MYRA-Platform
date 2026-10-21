'use server'

// The link Chloe sends a client so she can make her own login. Admin only.

import { assertAdmin } from '@/lib/admin-audit'
import { createAdminClient } from '@/lib/supabase-server'
import { mintShortInvite, INVITE_DAYS } from '@/lib/member-invite'

export interface MemberAccessView {
  /** The email Chloe wrote down for the door (pilot_member.invite_email). */
  inviteEmail: string | null
  /** The email her login uses, if she has one. */
  loginEmail: string | null
  hasLogin: boolean
}

/** Her door email and whether she has a login yet. Admin only. */
export async function loadMemberAccess(memberId: string): Promise<MemberAccessView> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('member_id, auth_user_id, email, invite_email').eq('member_id', memberId).maybeSingle()
  if (!member) return { inviteEmail: null, loginEmail: null, hasLogin: false }
  let loginEmail: string | null = member.email ?? null
  if (member.auth_user_id && !loginEmail) {
    try {
      const { data } = await admin.auth.admin.getUserById(member.auth_user_id)
      loginEmail = data?.user?.email ?? null
    } catch { /* shown without it */ }
  }
  return { inviteEmail: member.invite_email ?? null, loginEmail, hasLogin: !!member.auth_user_id }
}

/** The email she will type on the door. Empty clears it. Admin only. */
export async function setMemberInviteEmail(memberId: string, email: string): Promise<{ inviteEmail?: string | null; error?: string }> {
  await assertAdmin()
  const clean = String(email ?? '').trim().toLowerCase()
  if (clean && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { error: 'Enter a valid email address' }
  const admin = createAdminClient() as any
  if (clean) {
    // One door email, one member: the door must know whose it is.
    const { data: other } = await admin.from('pilot_member').select('member_id, name').ilike('invite_email', clean).neq('member_id', memberId).limit(1)
    if (other?.length) return { error: `That email is already on ${other[0].name}'s record` }
  }
  const { error } = await admin.from('pilot_member').update({ invite_email: clean || null }).eq('member_id', memberId)
  if (error) {
    if (/does not exist|schema cache|not find/i.test(error.message)) return { error: 'RUN MIGRATION 0102_invite_email_sign_in.sql FIRST (npm run migrate)' }
    return { error: error.message }
  }
  return { inviteEmail: clean || null }
}

export async function createMemberInvite(memberId: string, origin?: string): Promise<{ url?: string; name?: string; hasLogin?: boolean; days?: number; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('member_id, name, auth_user_id').eq('member_id', memberId).maybeSingle()
  if (!member) return { error: 'Member not found' }
  if (member.auth_user_id) return { name: member.name, hasLogin: true, error: `${member.name} already has a login — she signs in at /signin` }
  const base = (process.env.NEXT_PUBLIC_SITE_URL || origin || 'http://localhost:3000').replace(/\/+$/, '')
  // The short, friendly form; /join turns it into her welcome page.
  return { url: `${base}/join/${mintShortInvite(member.member_id, member.name)}`, name: member.name, days: INVITE_DAYS }
}
