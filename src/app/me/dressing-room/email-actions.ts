'use server'

// FIND WHAT YOU'VE BOUGHT — the browser-callable surface for her email
// connector. Every action resolves the member on the server (her session, or the
// member Chloe names from HER VIEW — admin only) and passes only that id on.
// Connecting an inbox is real in HER VIEW too: it is her actual mailbox.

import { resolveClientMember } from '@/lib/client-member'
import {
  approveFind, connectImap, disconnect, discardFind, listConnections, listFinds, processEmailScans, queueScan,
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
  error?: string
}

export async function loadEmailPanel(asMemberId?: string): Promise<EmailPanelView> {
  const me = await resolveClientMember(asMemberId)
  const base = { gmailReady: gmailConfigured(), secretsReady: emailSecretsConfigured() }
  if (!me) return { memberId: null, test: false, connections: [], finds: [], ...base }
  try {
    const [connections, finds] = await Promise.all([listConnections(me.memberId), listFinds(me.memberId)])
    return { memberId: me.memberId, test: me.test, connections, finds, ...base }
  } catch (err) {
    // Before migration 0058 the tables do not exist.
    const msg = err instanceof Error ? err.message : String(err)
    return { memberId: me.memberId, test: me.test, connections: [], finds: [], ...base, error: /member_email_connection|email_purchase_find/.test(msg) ? 'Run migration 0058_member_email_connection.sql in Supabase first' : msg }
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
export async function scanNow(asMemberId?: string): Promise<{ error?: string; remaining?: number }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const r = await processEmailScans(45_000)
  return { remaining: r.remaining }
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
