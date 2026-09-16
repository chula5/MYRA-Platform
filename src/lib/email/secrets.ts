// Email connector secrets — a Gmail refresh token or an IMAP app password —
// encrypted at rest (AES-256-GCM, key = EMAIL_SECRET_ENCRYPTION_KEY, 32-byte
// hex), plus HMAC-signed OAuth state so the Google callback can trust which
// member it is connecting. Never logged, never returned to the browser.

import 'server-only'
import crypto from 'node:crypto'

const key = () => {
  const hex = process.env.EMAIL_SECRET_ENCRYPTION_KEY ?? ''
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('EMAIL_SECRET_ENCRYPTION_KEY missing or not 32-byte hex (64 hex characters)')
  return Buffer.from(hex, 'hex')
}

export function emailSecretsConfigured(): boolean {
  return /^[0-9a-f]{64}$/i.test(process.env.EMAIL_SECRET_ENCRYPTION_KEY ?? '')
}

/** Format: v1.<iv hex>.<ciphertext hex>.<authTag hex> */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `v1.${iv.toString('hex')}.${ct.toString('hex')}.${cipher.getAuthTag().toString('hex')}`
}

export function decryptSecret(stored: string): string {
  const [v, ivHex, ctHex, tagHex] = stored.split('.')
  if (v !== 'v1' || !ivHex || !ctHex || !tagHex) throw new Error('Malformed encrypted secret')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8')
}

/** Signed OAuth state: which member, where to return, and a nonce also held in a cookie. */
export function signState(payload: { memberId: string; returnTo: string; nonce: string }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', key()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function readState(state: string | null): { memberId: string; returnTo: string; nonce: string } | null {
  if (!state) return null
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', key()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    return typeof p?.memberId === 'string' && typeof p?.nonce === 'string' ? p : null
  } catch {
    return null
  }
}

/** Only ever send someone back to a path on this site. */
export const safeReturnPath = (p: string | null | undefined): string =>
  typeof p === 'string' && /^\/(me|admin)(\/[\w\-/]*)?$/.test(p) ? p : '/me/dressing-room'
