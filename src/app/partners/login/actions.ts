'use server'

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { getPartnerContext } from '@/lib/partners/auth'

export async function partnerSignIn(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const supabase = await createServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) redirect(`/partners/login?error=${encodeURIComponent(error.message)}`)

  // Signed in but not a brand user → shopper account, not a partner one.
  const ctx = await getPartnerContext()
  if (!ctx) {
    await supabase.auth.signOut()
    redirect(`/partners/login?error=${encodeURIComponent('This account has no partner access. Use your invite link, or contact MYRA.')}`)
  }
  redirect('/partners')
}

export async function partnerSignOut() {
  const supabase = await createServerClient()
  await supabase.auth.signOut()
  redirect('/partners/login')
}
