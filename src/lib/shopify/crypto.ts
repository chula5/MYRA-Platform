// Shopify security primitives — pure Node crypto, no SDK.
//
//  - Webhook HMAC:   X-Shopify-Hmac-Sha256 = base64(hmacSHA256(secret, rawBody))
//  - OAuth HMAC:     hmac query param      = hex(hmacSHA256(secret, sortedQuery))
//  - State token:    random nonce, HMAC-signed so the callback can verify we
//                    issued it (no server-side session needed)
//  - Access tokens:  AES-256-GCM at rest (key = SHOPIFY_TOKEN_ENCRYPTION_KEY,
//                    32-byte hex). Tokens are never logged.

import crypto from 'node:crypto'

const enc = () => {
  const hex = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ?? ''
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY missing or not 32-byte hex')
  return Buffer.from(hex, 'hex')
}

const secret = () => process.env.SHOPIFY_API_SECRET ?? ''

function timingSafeEq(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ── Webhook verification (raw request body, base64 digest) ──────────────────
export function verifyWebhookHmac(rawBody: string | Buffer, hmacHeader: string | null, secretOverride?: string): boolean {
  if (!hmacHeader) return false
  const s = secretOverride ?? secret()
  if (!s) return false
  const digest = crypto.createHmac('sha256', s).update(rawBody).digest()
  let claimed: Buffer
  try { claimed = Buffer.from(hmacHeader, 'base64') } catch { return false }
  return timingSafeEq(digest, claimed)
}

// ── OAuth callback verification (query params, hex digest) ──────────────────
// Message = every param except hmac/signature, sorted, joined with '&'.
export function verifyOAuthHmac(params: URLSearchParams, secretOverride?: string): boolean {
  const s = secretOverride ?? secret()
  const claimedHex = params.get('hmac')
  if (!s || !claimedHex) return false
  const pairs: string[] = []
  const keys = [...new Set([...params.keys()])].filter((k) => k !== 'hmac' && k !== 'signature').sort()
  for (const k of keys) {
    for (const v of params.getAll(k)) pairs.push(`${k}=${v}`)
  }
  const digest = crypto.createHmac('sha256', s).update(pairs.join('&')).digest('hex')
  let a: Buffer, b: Buffer
  try { a = Buffer.from(digest, 'hex'); b = Buffer.from(claimedHex, 'hex') } catch { return false }
  return timingSafeEq(a, b)
}

// ── Shop domain validation ──────────────────────────────────────────────────
// Only ever redirect to / call real *.myshopify.com shops (prevents OAuth
// redirect + token-exchange against attacker-controlled hosts).
export function isValidShopDomain(shop: string | null | undefined): shop is string {
  return typeof shop === 'string' && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)
}

// ── Signed state (CSRF) ─────────────────────────────────────────────────────
// Separator is '~': it cannot appear in a hex nonce, a shop domain, or a hex
// signature — unlike '.', which is all over *.myshopify.com.
export function makeState(shop: string): string {
  const nonce = crypto.randomBytes(16).toString('hex')
  const body = `${nonce}~${shop}`
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('hex').slice(0, 32)
  return `${body}~${sig}`
}

export function verifyState(state: string | null, shop: string): boolean {
  if (!state) return false
  const parts = state.split('~')
  if (parts.length !== 3) return false
  const [nonce, stateShop, sig] = parts
  if (stateShop !== shop) return false
  const expected = crypto.createHmac('sha256', secret()).update(`${nonce}~${stateShop}`).digest('hex').slice(0, 32)
  try {
    return timingSafeEq(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch { return false }
}

// ── Access-token encryption at rest (AES-256-GCM) ───────────────────────────
// Format: v1.<iv hex>.<ciphertext hex>.<authTag hex>
export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', enc(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `v1.${iv.toString('hex')}.${ct.toString('hex')}.${cipher.getAuthTag().toString('hex')}`
}

export function decryptToken(stored: string): string {
  const [v, ivHex, ctHex, tagHex] = stored.split('.')
  if (v !== 'v1' || !ivHex || !ctHex || !tagHex) throw new Error('Malformed encrypted token')
  const decipher = crypto.createDecipheriv('aes-256-gcm', enc(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8')
}
