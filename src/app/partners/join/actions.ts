'use server'

// Invite acceptance (Part 4). The token is single-use, hashed at rest, expiring.
// Signup here creates a BRAND user: the merchant_user mapping is what separates
// them from shoppers — same auth system, disjoint capability.

import crypto from 'node:crypto'
import { redirect } from 'next/navigation'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'

async function findInvite(token: string) {
  const admin = createAdminClient()
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  const { data } = await admin
    .from('merchant_invite' as any)
    .select('*')
    .eq('token_hash', hash)
    .is('accepted_at', null)
    .maybeSingle()
  const inv = data as any
  if (!inv) return null
  if (new Date(inv.expires_at) < new Date()) return null
  return inv
}

export async function acceptInvite(formData: FormData) {
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  const mode = String(formData.get('mode') ?? 'signup')

  const invite = await findInvite(token)
  if (!invite) redirect('/partners/join?error=invalid')

  const supabase = await createServerClient()
  const email = invite.email as string

  if (mode === 'signin') {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) redirect(`/partners/join?token=${encodeURIComponent(token)}&error=${encodeURIComponent(error.message)}`)
  } else {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) {
      // Account already exists → guide to the sign-in variant of the form.
      redirect(`/partners/join?token=${encodeURIComponent(token)}&error=${encodeURIComponent(error.message)}&mode=signin`)
    }
    if (!data?.session) {
      // Email confirmation is on: they must confirm, then reopen the link.
      redirect(`/partners/join?token=${encodeURIComponent(token)}&confirm=1`)
    }
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/partners/join?token=${encodeURIComponent(token)}&error=session`)

  const admin = createAdminClient()
  await admin.from('merchant_user' as any).upsert({
    user_id: user!.id,
    merchant_id: invite.merchant_id,
    role: invite.role,
  } as any, { onConflict: 'user_id,merchant_id' })
  await admin.from('merchant_invite' as any).update({ accepted_at: new Date().toISOString() } as any).eq('invite_id', invite.invite_id)

  redirect('/partners')
}

export async function inviteMeta(token: string): Promise<{ email: string; merchantName: string } | null> {
  const invite = await findInvite(token)
  if (!invite) return null
  const admin = createAdminClient()
  const { data: m } = await admin.from('merchant' as any).select('name').eq('merchant_id', invite.merchant_id).single()
  return { email: invite.email, merchantName: (m as any)?.name ?? 'your brand' }
}
