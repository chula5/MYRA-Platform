'use server'

import { createAdminClient } from '@/lib/supabase-server'

// Save a brand suggestion or feedback note from the landing page.
export async function submitFeedback(
  kind: 'brand' | 'feedback',
  message: string,
  email?: string,
): Promise<{ ok?: true; error?: string }> {
  try {
    const m = (message || '').trim().slice(0, 2000)
    if (!m) return { error: 'Please write something first' }
    const admin = createAdminClient()
    const { error } = await (admin.from('feedback_submission') as any).insert({
      kind,
      message: m,
      email: (email || '').trim().slice(0, 200) || null,
    })
    if (error) return { error: 'Could not submit — please try again' }
    return { ok: true }
  } catch {
    return { error: 'Could not submit — please try again' }
  }
}
