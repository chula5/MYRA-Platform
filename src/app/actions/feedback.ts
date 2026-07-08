'use server'

import { createAdminClient, createServerClient } from '@/lib/supabase-server'

// Save a brand suggestion or feedback note from the landing page. If the visitor
// is logged in we attach their email so admin can see who left it.
export async function submitFeedback(
  kind: 'brand' | 'feedback',
  message: string,
  email?: string,
): Promise<{ ok?: true; error?: string }> {
  try {
    const m = (message || '').trim().slice(0, 2000)
    if (!m) return { error: 'Please write something first' }
    // Prefer the logged-in user's email; fall back to any passed value.
    let who = (email || '').trim().slice(0, 200) || null
    try {
      const supabase = await createServerClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email) who = user.email
    } catch { /* anonymous — leave as-is */ }
    const admin = createAdminClient()
    const { error } = await (admin.from('feedback_submission') as any).insert({
      kind,
      message: m,
      email: who,
    })
    if (error) return { error: 'Could not submit — please try again' }
    return { ok: true }
  } catch {
    return { error: 'Could not submit — please try again' }
  }
}
