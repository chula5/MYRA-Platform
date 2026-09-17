'use server'

// FIND WHAT YOU'VE BOUGHT — the browser-callable surface for her email
// connector. Every action resolves the member on the server (her session, or the
// member Chloe names from HER VIEW — admin only) and passes only that id on.
// Connecting an inbox is real in HER VIEW too: it is her actual mailbox.

import { resolveClientMember } from '@/lib/client-member'
import {
  approveFind, connectImap, disconnect, discardFind, huntPhotoForFind, keepReturnedPiece, listConnections, listFinds, listReturnedInWardrobe,
  processEmailScans, queueScan, removeReturnedPiece, setFindPhoto,
  type EmailConnectionView, type EmailFindView,
} from '@/lib/email/connections'
import { IMAP_PRESETS, presetForEmail } from '@/lib/email/imap'
import { gmailConfigured } from '@/lib/email/gmail'
import { emailSecretsConfigured } from '@/lib/email/secrets'

export interface EmailPanelView {
  memberId: string | null
  test: boolean
  gmailReady: boolean
  secretsReady: boolean
  connections: EmailConnectionView[]
  finds: EmailFindView[]
  /** Already in her dressing room, but an email says it went back. */
  returned: EmailFindView[]
  error?: string
}

export async function loadEmailPanel(asMemberId?: string): Promise<EmailPanelView> {
  const me = await resolveClientMember(asMemberId)
  const base = { gmailReady: gmailConfigured(), secretsReady: emailSecretsConfigured() }
  if (!me) return { memberId: null, test: false, connections: [], finds: [], returned: [], ...base }
  try {
    const [connections, finds, returned] = await Promise.all([listConnections(me.memberId), listFinds(me.memberId), listReturnedInWardrobe(me.memberId)])
    return { memberId: me.memberId, test: me.test, connections, finds, returned, ...base }
  } catch (err) {
    // Before migration 0058 the tables do not exist.
    const msg = err instanceof Error ? err.message : String(err)
    return { memberId: me.memberId, test: me.test, connections: [], finds: [], returned: [], ...base, error: /member_email_connection|email_purchase_find/.test(msg) ? 'Run migration 0058_member_email_connection.sql in Supabase first' : msg }
  }
}

/** Virgin Media / Blueyonder: email + Virgin Media Mail app password, tested before it is saved. */
export async function connectVirginMedia(email: string, appPassword: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  if (!emailSecretsConfigured()) return { error: 'Email connections are not set up yet (EMAIL_SECRET_ENCRYPTION_KEY)' }
  const clean = (email ?? '').trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean) || !appPassword) return { error: 'Enter the email address and the app password' }
  const preset = presetForEmail(clean) ?? 'virgin_media'
  const r = await connectImap(me.memberId, { host: IMAP_PRESETS[preset].host, email: clean, password: appPassword })
  return r.error ? { error: r.error } : {}
}

/** Work through queued scans for a little while — the page calls this while a scan is running. */
export async function scanNow(asMemberId?: string): Promise<{ error?: string; remaining?: number; read?: number }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const r = await processEmailScans(45_000)
  return { remaining: r.remaining, read: r.read }
}

export async function scanAgain(connectionId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const conns = await listConnections(me.memberId)
  if (!conns.some((c) => c.connection_id === connectionId)) return { error: 'Connection not found' }
  return queueScan(me.memberId, connectionId)
}

export async function disconnectInbox(connectionId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return disconnect(me.memberId, connectionId)
}

export async function addFoundPiece(findId: string, asMemberId?: string): Promise<{ itemId?: string; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return approveFind(me.memberId, findId)
}

export async function notMine(findId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return discardFind(me.memberId, findId)
}

/** A photo for a find whose email had none. */
export async function addFindPhoto(formData: FormData): Promise<{ error?: string }> {
  const me = await resolveClientMember(String(formData.get('as_member_id') ?? '') || undefined)
  if (!me) return { error: 'Not signed in' }
  const findId = String(formData.get('find_id') ?? '')
  const file = formData.get('file')
  if (!findId || !(file instanceof File) || file.size === 0) return { error: 'Choose a photo' }
  if (!file.type.startsWith('image/')) return { error: 'That is not an image' }
  if (file.size > 15 * 1024 * 1024) return { error: 'That photo is too large' }
  return setFindPhoto(me.memberId, findId, Buffer.from(await file.arrayBuffer()), file.type)
}

export async function removeReturned(findId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return removeReturnedPiece(me.memberId, findId)
}

export async function keepReturned(findId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return keepReturnedPiece(me.memberId, findId)
}

/** Look through her other emails for a photo of this piece. */
export async function findPhotoInEmails(findId: string, asMemberId?: string): Promise<{ imageUrl?: string; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return huntPhotoForFind(me.memberId, findId)
}
