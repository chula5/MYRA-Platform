'use server'

// Her welcome: remembering that she has been shown around. Kept on her own
// login (user_metadata), so it needs no table and follows her between devices.

import { createAdminClient, createServerClient } from '@/lib/supabase-server'

export async function markTourDone(): Promise<{ ok: boolean }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const admin = createAdminClient()
  await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...(user.user_metadata ?? {}), toured_at: new Date().toISOString() } })
  return { ok: true }
}
