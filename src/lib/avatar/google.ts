// Nano Banana on Google's own API (Vertex AI generateContent).
//
// Proven 2026-11-08/09 from the sandbox: gemini-nano-banana-2.1 (dressing, 2K, ~25s, ≈$0.05)
// and gemini-3-pro-image (the body, ~30s, ≈$0.14). Auth is a service account: the JSON key
// is turned into a one-hour access token here, no Google SDK needed.

import 'server-only'
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { AVATAR_CONFIG } from './config'

export interface ImageRef { bytes: Buffer; mime: 'image/jpeg' | 'image/png' | 'image/webp' }
export interface GenResult { png: Buffer; ms: number; tokensIn: number; tokensOut: number }

export class GoogleImageError extends Error {
  constructor(message: string, public status?: number) { super(message); this.name = 'GoogleImageError' }
}

let cached: { token: string; exp: number } | null = null

function serviceAccount(): { client_email: string; private_key: string; token_uri: string } {
  const b64 = process.env.GOOGLE_SA_KEY
  if (b64) return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (path) return JSON.parse(readFileSync(path, 'utf8'))
  throw new GoogleImageError('Google is not set up: GOOGLE_SA_KEY or GOOGLE_APPLICATION_CREDENTIALS is missing')
}

async function accessToken(): Promise<string> {
  if (cached && cached.exp - 60 > Date.now() / 1000) return cached.token
  const sa = serviceAccount()
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri, iat: now, exp: now + 3600 })}`
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')
  const r = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  })
  const j: any = await r.json().catch(() => ({}))
  if (!j.access_token) throw new GoogleImageError(`Google token: ${JSON.stringify(j).slice(0, 200)}`, r.status)
  cached = { token: j.access_token, exp: now + (j.expires_in ?? 3600) }
  return cached.token
}

/**
 * One picture from a prompt and reference images. `images` come first (image 1, image 2 …)
 * so prompts can name them. Retries once on a dropped request — both routes dropped one
 * request each during the sandbox.
 */
export async function generateGoogleImage(opts: {
  model?: string
  prompt: string
  images?: ImageRef[]
  aspect?: string
  size?: '1K' | '2K' | '4K'
  timeoutMs?: number
}): Promise<GenResult> {
  const model = opts.model ?? AVATAR_CONFIG.dressModel
  const location = AVATAR_CONFIG.location
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`
  const url = `https://${host}/v1/projects/${AVATAR_CONFIG.project}/locations/${location}/publishers/google/models/${model}:generateContent`
  const parts: any[] = [
    ...(opts.images ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.bytes.toString('base64') } })),
    { text: opts.prompt },
  ]
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: opts.aspect ?? AVATAR_CONFIG.aspect, imageSize: opts.size ?? AVATAR_CONFIG.imageSize } },
  }
  const t0 = Date.now()
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
      })
      const text = await res.text()
      if (!res.ok) {
        // 429/5xx: try once more; 4xx: no point
        if (res.status >= 500 || res.status === 429) { lastErr = new GoogleImageError(`Google ${res.status}: ${text.slice(0, 300)}`, res.status); continue }
        throw new GoogleImageError(`Google ${res.status}: ${text.slice(0, 300)}`, res.status)
      }
      const j = JSON.parse(text)
      const img = (j.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data)
      if (!img) throw new GoogleImageError(`Google returned no image: ${text.slice(0, 300)}`)
      return {
        png: Buffer.from(img.inlineData.data, 'base64'),
        ms: Date.now() - t0,
        tokensIn: j.usageMetadata?.promptTokenCount ?? 0,
        tokensOut: j.usageMetadata?.candidatesTokenCount ?? 0,
      }
    } catch (e) {
      lastErr = e
      if (e instanceof GoogleImageError && e.status && e.status < 500 && e.status !== 429) throw e
    }
  }
  throw lastErr instanceof Error ? lastErr : new GoogleImageError(String(lastErr))
}

/** Google's list price for one call, in GBP (output image tokens at $30/M, inputs at $1.50/M; ~0.78 £/$). */
export function googleCostGbp(r: GenResult, model: string): number {
  const outRate = /pro-image/.test(model) ? 120 : 30      // $ per 1M output tokens
  const inRate = /pro-image/.test(model) ? 2 : 1.5
  const usd = (r.tokensOut / 1e6) * outRate + (r.tokensIn / 1e6) * inRate
  return Math.round(usd * 0.78 * 10000) / 10000
}
