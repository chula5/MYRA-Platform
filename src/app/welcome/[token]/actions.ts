'use server'

// Accepting an invite: she chooses her own email and password, the login is
// made with the client role, and it is pointed at the member record that is
// already hers. Everything is decided on the server from the signed link —
// the browser never names the member.

import { redirect } from 'next/navigation'
import { createAdminClient, createServerClient } from '@/lib/supabase-server'
import { readInvite } from '@/lib/member-invite'

export async function acceptInvite(formData: FormData) {
  const token = String(formData.get('token') ?? '')
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')
  const back = (msg: string) => redirect(`/welcome/${encodeURIComponent(token)}?error=${encodeURIComponent(msg)}`)

  const invite = readInvite(token)
  if (!invite) back('This link has expired — ask Chloe for a new one')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back('Enter a valid email address')
  if (password.length < 8) back('Choose a password of at least 8 characters')
  if (password !== confirm) back('Those passwords do not match')

  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('member_id, name, auth_user_id').eq('member_id', invite!.memberId).maybeSingle()
  if (!member) back('This link is no longer valid')
  if (member.auth_user_id) redirect(`/signin?error=${encodeURIComponent('You already have a login — sign in below')}`)

  const supabase = await createServerClient()
  let userId: string | null = null
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { role: 'client', name: member.name },
  })
  if (created?.user) userId = created.user.id
  else if (createErr && /already|exists|registered/i.test(createErr.message)) {
    // She has a MYRA account already (early access): the same password proves it is hers, and it becomes her client login.
    const { data: existing, error: signErr } = await supabase.auth.signInWithPassword({ email, password })
    if (signErr || !existing.user) back('You already have a MYRA account with this email — use that password here')
    userId = existing.user!.id
    await admin.auth.admin.updateUserById(userId, { user_metadata: { ...(existing.user!.user_metadata ?? {}), role: 'client', name: member.name } })
  } else back('Could not create your login — please try again')

  // Point the login at her member record — only if nobody got there first.
  const { data: linked } = await admin.from('pilot_member').update({ auth_user_id: userId }).eq('member_id', member.member_id).is('auth_user_id', null).select('member_id')
  if (!linked?.length) redirect(`/signin?error=${encodeURIComponent('You already have a login — sign in below')}`)
  try { await admin.from('client_profile').upsert({ user_id: userId, name: member.name, email }, { onConflict: 'user_id' }) } catch { /* optional table */ }

  const { error: signErr } = await supabase.auth.signInWithPassword({ email, password })
  if (signErr) redirect(`/signin?error=${encodeURIComponent('Login created — please sign in')}`)
  // A fresh session so the client role is in it.
  await supabase.auth.refreshSession()
  redirect('/me/welcome')
}
