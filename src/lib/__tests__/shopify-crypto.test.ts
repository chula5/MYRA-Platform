import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'node:crypto'

const SECRET = 'test_shared_secret_abc123'
const KEY = '0'.repeat(64) // 32-byte hex

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = SECRET
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = KEY
})

// Imported after env is set — the module reads env lazily, but be explicit.
const load = async () => await import('@/lib/shopify/crypto')

describe('verifyWebhookHmac — the gate on every webhook', () => {
  it('accepts a correctly signed body', async () => {
    const { verifyWebhookHmac } = await load()
    const body = JSON.stringify({ id: 123, total_price: '420.00' })
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64')
    expect(verifyWebhookHmac(body, sig)).toBe(true)
  })

  it('rejects a tampered body (the attack that matters)', async () => {
    const { verifyWebhookHmac } = await load()
    const body = JSON.stringify({ id: 123, total_price: '420.00' })
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64')
    const tampered = JSON.stringify({ id: 123, total_price: '99999.00' })
    expect(verifyWebhookHmac(tampered, sig)).toBe(false)
  })

  it('rejects a signature made with the wrong secret', async () => {
    const { verifyWebhookHmac } = await load()
    const body = '{"id":1}'
    const sig = crypto.createHmac('sha256', 'not_the_secret').update(body).digest('base64')
    expect(verifyWebhookHmac(body, sig)).toBe(false)
  })

  it('rejects missing / malformed / empty signatures', async () => {
    const { verifyWebhookHmac } = await load()
    expect(verifyWebhookHmac('{}', null)).toBe(false)
    expect(verifyWebhookHmac('{}', '')).toBe(false)
    expect(verifyWebhookHmac('{}', 'not-base64-!!!')).toBe(false)
    // Right length, wrong bytes — must not pass.
    expect(verifyWebhookHmac('{}', crypto.randomBytes(32).toString('base64'))).toBe(false)
  })
})

describe('verifyOAuthHmac — the gate on install', () => {
  const sign = (params: Record<string, string>, secret = SECRET) => {
    const msg = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
    return crypto.createHmac('sha256', secret).update(msg).digest('hex')
  }

  it('accepts a valid callback', async () => {
    const { verifyOAuthHmac } = await load()
    const params = { code: 'abc', shop: 'test.myshopify.com', timestamp: '1700000000', state: 'xyz' }
    const sp = new URLSearchParams({ ...params, hmac: sign(params) })
    expect(verifyOAuthHmac(sp)).toBe(true)
  })

  it('rejects when a param was altered after signing', async () => {
    const { verifyOAuthHmac } = await load()
    const params = { code: 'abc', shop: 'test.myshopify.com', timestamp: '1700000000' }
    const sp = new URLSearchParams({ ...params, shop: 'evil.myshopify.com', hmac: sign(params) })
    expect(verifyOAuthHmac(sp)).toBe(false)
  })

  it('rejects a missing hmac', async () => {
    const { verifyOAuthHmac } = await load()
    expect(verifyOAuthHmac(new URLSearchParams({ shop: 'a.myshopify.com' }))).toBe(false)
  })
})

describe('isValidShopDomain — open-redirect / SSRF guard', () => {
  it('accepts real shop domains', async () => {
    const { isValidShopDomain } = await load()
    expect(isValidShopDomain('jamemme2.myshopify.com')).toBe(true)
    expect(isValidShopDomain('my-shop-1.myshopify.com')).toBe(true)
  })

  it('rejects lookalikes and injection attempts', async () => {
    const { isValidShopDomain } = await load()
    expect(isValidShopDomain('evil.com')).toBe(false)
    expect(isValidShopDomain('evil.myshopify.com.attacker.com')).toBe(false)
    expect(isValidShopDomain('shop.myshopify.com/../x')).toBe(false)
    expect(isValidShopDomain('https://shop.myshopify.com')).toBe(false)
    expect(isValidShopDomain('')).toBe(false)
    expect(isValidShopDomain(null)).toBe(false)
    expect(isValidShopDomain(undefined)).toBe(false)
  })
})

describe('signed state — CSRF on the install flow', () => {
  it('round-trips for the same shop', async () => {
    const { makeState, verifyState } = await load()
    const s = makeState('shop.myshopify.com')
    expect(verifyState(s, 'shop.myshopify.com')).toBe(true)
  })

  it('rejects state issued for a different shop', async () => {
    const { makeState, verifyState } = await load()
    const s = makeState('shop.myshopify.com')
    expect(verifyState(s, 'other.myshopify.com')).toBe(false)
  })

  it('rejects forged or malformed state', async () => {
    const { verifyState } = await load()
    expect(verifyState('nonce~shop.myshopify.com~deadbeef', 'shop.myshopify.com')).toBe(false)
    expect(verifyState('garbage', 'shop.myshopify.com')).toBe(false)
    expect(verifyState(null, 'shop.myshopify.com')).toBe(false)
  })
})

describe('access-token encryption at rest', () => {
  it('round-trips a token', async () => {
    const { encryptToken, decryptToken } = await load()
    const token = 'shpua_0123456789abcdef0123456789abcdef'
    expect(decryptToken(encryptToken(token))).toBe(token)
  })

  it('never stores the token in plaintext', async () => {
    const { encryptToken } = await load()
    const token = 'shpua_supersecrettoken'
    const stored = encryptToken(token)
    expect(stored).not.toContain(token)
    expect(stored).not.toContain('supersecret')
    expect(stored.startsWith('v1.')).toBe(true)
  })

  it('produces a different ciphertext each time (random IV)', async () => {
    const { encryptToken } = await load()
    expect(encryptToken('same')).not.toBe(encryptToken('same'))
  })

  it('refuses tampered ciphertext (GCM auth tag)', async () => {
    const { encryptToken, decryptToken } = await load()
    const stored = encryptToken('shpua_token')
    const [v, iv, ct, tag] = stored.split('.')
    const flipped = ct.slice(0, -2) + (ct.endsWith('00') ? '11' : '00')
    expect(() => decryptToken(`${v}.${iv}.${flipped}.${tag}`)).toThrow()
  })

  it('refuses malformed stored values', async () => {
    const { decryptToken } = await load()
    expect(() => decryptToken('not-encrypted')).toThrow()
    expect(() => decryptToken('v1.only.two')).toThrow()
  })
})
