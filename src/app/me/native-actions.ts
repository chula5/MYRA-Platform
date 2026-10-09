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

export async function mintMirrorTokenForApp(): Promise<{ token: string } | { error: string }> {
  const member = await resolveClientMember()
  if (!member) return { error: 'Not signed in' }
  // Never stylist mode from the app: the share sheet keeps pieces for the
  // person holding the phone, not for a client Chloe is testing as.
  return { token: mintMirrorToken(member.memberId) }
}
