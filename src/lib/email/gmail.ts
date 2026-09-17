// GMAIL — Google sign-in (read-only) and a search of her past year of order
// emails. Plain fetch against the Gmail REST API; no SDK. Server only.
//
// Setup (Chloe, once): a Google Cloud OAuth client (Web application) with the
// redirect URI below, the Gmail API enabled, the app in Testing with each
// client's Gmail added as a test user. Env: GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (…/api/email/google/callback).

import 'server-only'
import type { MailMessage } from './purchase-core'

const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email'

export function gmailConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI)
}

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline', // a refresh token, so later scans need no sign-in
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      ...body,
    }).toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Google token request failed: ${data?.error_description ?? data?.error ?? res.status}`)
  return data
}

/** Code → refresh token and the Gmail address it belongs to. */
export async function exchangeGoogleCode(code: string): Promise<{ refreshToken: string; email: string }> {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '' })
  if (!t.refresh_token) throw new Error('Google did not return a refresh token — remove MYRA from your Google account permissions and connect again')
  const profile = await gmailGet(t.access_token, 'profile')
  return { refreshToken: t.refresh_token, email: profile.emailAddress }
}

export async function googleAccessToken(refreshToken: string): Promise<string> {
  const t = await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' })
  return t.access_token
}

/** Tell Google to forget the grant (on disconnect). Best-effort. */
export async function revokeGoogle(refreshToken: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' }).catch(() => undefined)
}

async function gmailGet(accessToken: string, path: string): Promise<any> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Gmail ${path.split('?')[0]} failed: ${data?.error?.message ?? res.status}`)
  return data
}

/** Order- and return-looking messages since a date, newest first. Gmail does the first filter. */
export async function listGmailPurchaseIds(accessToken: string, since: Date, max = 1500): Promise<string[]> {
  const after = Math.floor(since.getTime() / 1000)
  const q = `after:${after} {category:purchases subject:order subject:receipt subject:confirmation subject:dispatched subject:shipped subject:"on its way" subject:return subject:returned subject:refund subject:refunded subject:cancelled}`
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ q, maxResults: '500' })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await gmailGet(accessToken, `messages?${params.toString()}`)
    for (const m of page.messages ?? []) ids.push(m.id)
    pageToken = page.nextPageToken
  } while (pageToken && ids.length < max)
  return ids.slice(0, max)
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

export async function getGmailMessage(accessToken: string, id: string): Promise<MailMessage> {
  const m = await gmailGet(accessToken, `messages/${id}?format=full`)
  const headers: { name: string; value: string }[] = m.payload?.headers ?? []
  const header = (n: string) => headers.find((h) => h.name.toLowerCase() === n)?.value ?? ''
  let html: string | null = null
  let text: string | null = null
  const walk = (part: any) => {
    if (!part) return
    if (part.mimeType === 'text/html' && part.body?.data && !html) html = b64url(part.body.data)
    if (part.mimeType === 'text/plain' && part.body?.data && !text) text = b64url(part.body.data)
    for (const p of part.parts ?? []) walk(p)
  }
  walk(m.payload)
  const internal = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null
  return { id, subject: header('subject'), from: header('from'), date: header('date') || internal, html, text }
}

/** Sender and subject only — no body is opened. For sorting a year of candidates cheaply. */
export async function getGmailHeaders(accessToken: string, ids: string[]): Promise<{ id: string; from: string; subject: string }[]> {
  const out: { id: string; from: string; subject: string }[] = []
  for (let i = 0; i < ids.length; i += 20) {
    const part = await Promise.all(ids.slice(i, i + 20).map(async (id) => {
      try {
        const m = await gmailGet(accessToken, `messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)
        const headers: { name: string; value: string }[] = m.payload?.headers ?? []
        const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value ?? ''
        return { id, from: h('from'), subject: h('subject') }
      } catch {
        return { id, from: '', subject: '' }
      }
    }))
    out.push(...part)
  }
  return out
}
