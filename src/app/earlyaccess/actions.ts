'use server'

import { redirect } from 'next/navigation'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { recordEarlyAccessLogin } from './activity'
import { EARLY_ACCESS_INVITE_CODE } from './invite'

const ROLE = 'early_access'

export async function earlyAccessSignIn(formData: FormData) {
  const email = ((formData.get('email') as string) || '').trim().toLowerCase()
  const password = (formData.get('password') as string) || ''

  if (!email || !password) {
    redirect(`/earlyaccess?error=${encodeURIComponent('Enter your email and password')}`)
  }

  const supabase = await createServerClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    redirect(`/earlyaccess?error=${encodeURIComponent('Incorrect email or password')}`)
  }

  if (data.user) await recordEarlyAccessLogin(data.user.id)

  redirect('/edit')
}

// Public self-sign-up via the shareable invite link (/earlyaccess/join?key=…).
export async function earlyAccessSignUp(formData: FormData) {
  const key = ((formData.get('key') as string) || '').trim()
  const email = ((formData.get('email') as string) || '').trim().toLowerCase()
  const password = (formData.get('password') as string) || ''
  const confirm = (formData.get('confirm') as string) || ''

  const back = (msg: string) =>
    redirect(`/earlyaccess/join?key=${encodeURIComponent(key)}&error=${encodeURIComponent(msg)}`)

  if (key !== EARLY_ACCESS_INVITE_CODE) back('This sign-up link is invalid')
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back('Enter a valid email address')
  if (!password || password.length < 8) back('Password must be at least 8 characters')
  if (password !== confirm) back('Passwords do not match')

  const admin = createAdminClient()
  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no email step — they can sign in immediately
    user_metadata: { role: ROLE },
  })
  if (createErr) {
    if (/already|exists|registered/i.test(createErr.message)) {
      redirect(`/earlyaccess?error=${encodeURIComponent('You already have an account — sign in below')}`)
    }
    back('Could not create your account — please try again')
  }

  // Sign them straight in and send them to The Edit.
  const supabase = await createServerClient()
  const { data, error: signErr } = await supabase.auth.signInWithPassword({ email, password })
  if (signErr) {
    redirect(`/earlyaccess?error=${encodeURIComponent('Account created — please sign in')}`)
  }
  if (data.user) await recordEarlyAccessLogin(data.user.id)
  redirect('/edit')
}

export async function earlyAccessSignOut() {
  const supabase = await createServerClient()
  await supabase.auth.signOut()
  redirect('/earlyaccess')
}
