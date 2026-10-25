// PHONE PUSH — straight to Apple.
//
// No Firebase, no third party: one HTTP/2 request per phone to Apple's push
// service, signed with the .p8 key from the Apple Developer portal (Keys →
// Apple Push Notifications service). Plain module, no 'use server' — crons
// and lib pipelines call it; nothing in a browser can.
//
// Env (Vercel; Chloe adds them — Claude never handles the key):
//   APNS_KEY      the .p8 file's contents (newlines may be written as \n)
//   APNS_KEY_ID   the 10-character Key ID shown beside the key
//   APNS_TEAM_ID  the developer team (2LSB76B969 when unset)
//   APNS_TOPIC    the app's bundle id (uk.co.myraassistant.app when unset)
//
// Environments: TestFlight and App Store builds hold PRODUCTION tokens, an
// Xcode debug build on her phone holds SANDBOX ones. A token sent to the wrong
// one comes back 400 BadDeviceToken, so the sender tries the other once and
// reports which answered; the caller remembers it on the device row.

import 'server-only'
import http2 from 'node:http2'
import crypto from 'node:crypto'

export type ApnsEnvironment = 'production' | 'sandbox'

const HOST: Record<ApnsEnvironment, string> = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
}

export interface PushMessage {
  title: string
  body: string
  /** A /me path the tap opens. Never an outside address. */
  url?: string
  /** Same id on a later push replaces this one on the lock screen. */
  collapseId?: string
}

export interface PushResult {
  ok: boolean
  status: number
  /** Which environment accepted the token (or was last tried). */
  environment: ApnsEnvironment
  /** Apple's reason on a failure: BadDeviceToken, Unregistered, … */
  reason?: string
  /** The token is dead — stop sending to it. */
  gone?: boolean
}

export function apnsConfigured(): boolean {
  return !!(process.env.APNS_KEY && process.env.APNS_KEY_ID)
}

// Apple wants the provider token refreshed between 20 and 60 minutes.
let jwtCache: { token: string; at: number } | null = null
const JWT_TTL_MS = 40 * 60_000

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

function providerToken(): string {
  if (jwtCache && Date.now() - jwtCache.at < JWT_TTL_MS) return jwtCache.token
  const key = String(process.env.APNS_KEY ?? '').replace(/\\n/g, '\n').trim()
  const keyId = String(process.env.APNS_KEY_ID ?? '').trim()
  const teamId = String(process.env.APNS_TEAM_ID ?? '2LSB76B969').trim()
  if (!key || !keyId) throw new Error('APNS_KEY and APNS_KEY_ID are not set')
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }))
  const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }))
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' })
  const token = `${header}.${claims}.${b64url(signature)}`
  jwtCache = { token, at: Date.now() }
  return token
}

/** The JSON Apple delivers. `url` rides in the payload for the app to open. */
export function apnsPayload(msg: PushMessage): string {
  return JSON.stringify({
    aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' },
    ...(msg.url ? { url: msg.url } : {}),
  })
}

function sendOnce(env: ApnsEnvironment, token: string, msg: PushMessage): Promise<PushResult> {
  return new Promise((resolve) => {
    let settled = false
    const done = (r: PushResult) => { if (!settled) { settled = true; resolve(r) } }
    let client: http2.ClientHttp2Session
    try {
      client = http2.connect(HOST[env])
    } catch (err) {
      return done({ ok: false, status: 0, environment: env, reason: err instanceof Error ? err.message : String(err) })
    }
    client.on('error', (err) => { done({ ok: false, status: 0, environment: env, reason: err.message }); client.close() })
    const headers: http2.OutgoingHttpHeaders = {
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${providerToken()}`,
      'apns-topic': String(process.env.APNS_TOPIC ?? 'uk.co.myraassistant.app').trim(),
      'apns-push-type': 'alert',
      'apns-priority': '10',
      ...(msg.collapseId ? { 'apns-collapse-id': msg.collapseId.slice(0, 64) } : {}),
    }
    const req = client.request(headers)
    let status = 0
    let body = ''
    req.setEncoding('utf8')
    req.on('response', (h) => { status = Number(h[':status'] ?? 0) })
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      client.close()
      let reason: string | undefined
      try { reason = body ? JSON.parse(body).reason : undefined } catch { reason = body || undefined }
      done({ ok: status === 200, status, environment: env, reason, gone: status === 410 || reason === 'Unregistered' })
    })
    req.on('error', (err) => { client.close(); done({ ok: false, status: 0, environment: env, reason: err.message }) })
    req.setTimeout(10_000, () => { req.close(); client.close(); done({ ok: false, status: 0, environment: env, reason: 'timeout' }) })
    req.end(apnsPayload(msg))
  })
}

/**
 * One push to one phone. Tries the environment on record, and the other one
 * once if Apple says the token does not belong there.
 */
export async function sendPush(token: string, msg: PushMessage, env: ApnsEnvironment = 'production'): Promise<PushResult> {
  const first = await sendOnce(env, token, msg)
  if (first.ok || first.reason !== 'BadDeviceToken') return first
  const other: ApnsEnvironment = env === 'production' ? 'sandbox' : 'production'
  const second = await sendOnce(other, token, msg)
  // Wrong in both: the token itself is bad.
  if (!second.ok && second.reason === 'BadDeviceToken') return { ...second, gone: true }
  return second
}
