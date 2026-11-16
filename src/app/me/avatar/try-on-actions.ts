'use server'

// TRY ON THE AVATAR, from the app: one piece on her avatar. Every export here
// resolves the signed-in member itself — nobody can ask for another member's
// avatar. `start` is her tap (it queues the picture); without it the call only
// reports what MYRA already has.

import { resolveClientMember } from '@/lib/client-member'
import { tryOnPiece, type TryOn } from '@/lib/avatar/try-on'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function tryOnMyPiece(itemId: string, start = false): Promise<TryOn> {
  const m = await resolveClientMember()
  if (!m) return { state: 'failed', message: 'Sign in to try this on' }
  if (typeof itemId !== 'string' || !UUID.test(itemId)) return { state: 'failed', message: 'MYRA cannot find that piece' }
  try {
    return await tryOnPiece(m.memberId, itemId, { start: start === true })
  } catch (e) {
    console.error('[avatar] try on', e)
    return { state: 'failed', message: 'That did not work — try again' }
  }
}
