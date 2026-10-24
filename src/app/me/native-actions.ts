'use server'

// THE APP HANDS ITS SIGN-IN TO THE SHARE SHEET.
//
// Inside the MYRA iPhone app, the share sheet ("MYRA" in Safari's share menu)
// needs the same Mirror token the Safari extension would hold. Until now the
// only way to get one onto the phone was to open the Safari extension and
// connect; here the app asks for one directly, for the member who is already
// signed in. Same token, same 30 days, same single signer (lib/mirror/auth).

import { resolveClientMember } from '@/lib/client-member'
import { mintMirrorToken } from '@/lib/mirror/auth'
import { createAdminClient } from '@/lib/supabase-server'

export async function mintMirrorTokenForApp(): Promise<{ token: string } | { error: string }> {
  const member = await resolveClientMember()
  if (!member) return { error: 'Not signed in' }
  // Never stylist mode from the app: the share sheet keeps pieces for the
  // person holding the phone, not for a client Chloe is testing as.
  return { token: mintMirrorToken(member.memberId) }
}

// HER PHONE, FOR NOTIFICATIONS.
//
// The app asks iOS for permission (components/me/PushSetup.tsx); when she says
// yes, iOS hands the app a device token and the app hands it here. The token
// belongs to whoever is signed in on that phone now — never a member Chloe is
// testing as from HER VIEW — so a phone that changes hands moves with it.
// Sending lives in lib/push.

/** Keep this phone's push token against the signed-in member. */
export async function registerPushDevice(token: string): Promise<{ ok: boolean; error?: string }> {
  const t = String(token ?? '').trim()
  // An APNs device token is hex — 64 characters today, longer allowed.
  if (!/^[0-9a-fA-F]{64,200}$/.test(t)) return { ok: false, error: 'Not a device token' }
  const member = await resolveClientMember()
  if (!member) return { ok: false, error: 'Not signed in' }
  const admin = createAdminClient() as any
  const now = new Date().toISOString()
  const { error } = await admin.from('push_device').upsert({
    device_token: t.toLowerCase(),
    member_id: member.memberId,
    auth_user_id: member.authUserId,
    last_seen_at: now,
    disabled_at: null,
    last_error: null,
  }, { onConflict: 'device_token' })
  return error ? { ok: false, error: error.message } : { ok: true }
}
