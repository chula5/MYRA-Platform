'use server'

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'

export async function earlyAccessSignIn(formData: FormData) {
  const email = ((formData.get('email') as string) || '').trim().toLowerCase()
  const password = (formData.get('password') as string) || ''

  if (!email || !password) {
    redirect(`/earlyaccess?error=${encodeURIComponent('Enter your email and password')}`)
  }

  const supabase = await createServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    redirect(`/earlyaccess?error=${encodeURIComponent('Incorrect email or password')}`)
  }

  redirect('/edit')
}

export async function earlyAccessSignOut() {
  const supabase = await createServerClient()
  await supabase.auth.signOut()
  redirect('/earlyaccess')
}
