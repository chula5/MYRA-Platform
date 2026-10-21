'use server'

// Her welcome: remembering that she has been shown around. Kept on her own
// login (user_metadata), so it needs no table and follows her between devices.

import { createAdminClient, createServerClient } from '@/lib/supabase-server'
import { recordSignOn } from '@/lib/sign-on'

/**
 * She has been shown her welcome — connect your accounts, MYRA where you shop.
 * Once: For You stops sending her here. In the iPhone app the app's own first
 * open is noted too, because the Safari extension is set up differently there
 * and she should see that once even if she had the web welcome before.
 */
export async function markWelcomed(opts?: { app?: boolean }): Promise<{ ok: boolean }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const meta = { ...(user.user_metadata ?? {}) } as Record<string, unknown>
  const now = new Date().toISOString()
  if (!meta.welcomed_at) meta.welcomed_at = now
  if (opts?.app && !meta.app_welcomed_at) meta.app_welcomed_at = now
  if (meta.welcomed_at === user.user_metadata?.welcomed_at && meta.app_welcomed_at === user.user_metadata?.app_welcomed_at) return { ok: true }
  const admin = createAdminClient()
  await admin.auth.admin.updateUserById(user.id, { user_metadata: meta })
  // Only the first time each is stamped — the early return above is a repeat.
  if (meta.welcomed_at !== user.user_metadata?.welcomed_at) await recordSignOn({ step: 'welcomed', authUserId: user.id, email: user.email })
  if (meta.app_welcomed_at !== user.user_metadata?.app_welcomed_at) await recordSignOn({ step: 'app_first_open', authUserId: user.id, email: user.email })
  return { ok: true }
}

export async function markTourDone(): Promise<{ ok: boolean }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const admin = createAdminClient()
  await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...(user.user_metadata ?? {}), toured_at: new Date().toISOString() } })
  await recordSignOn({ step: 'tour_done', authUserId: user.id, email: user.email })
  return { ok: true }
}
