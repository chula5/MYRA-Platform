'use server'

import { createAdminClient } from '@/lib/supabase-server'

export async function joinWaitlist(email: string): Promise<{ error?: string }> {
  if (!email || !email.includes('@')) return { error: 'Please enter a valid email address.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('waitlist')
    .insert({ email: email.toLowerCase().trim() })

  if (error) {
    if (error.code === '23505') return { error: 'You\'re already on the list!' }
    console.error('[joinWaitlist]', error)
    return { error: 'Something went wrong. Please try again.' }
  }

  return {}
}
