// Higgsfield over its cloud API — the renderer that runs on Vercel.
//
// The studio's shoots go through the Higgsfield CLI logged in on Chloe's Mac
// (app/admin/projects/higgsfield-actions), which Vercel does not have. This is
// the same job over https://api.higgsfield.ai with an API key, so a picture can
// be made from a serverless request. Documented 2026-11-03 at docs.higgsfield.ai:
//   POST /<model>  { prompt, image_urls[], aspect_ratio, resolution, quality }
//     → { status: 'queued', request_id, status_url }
//   GET  status_url → { status: queued|in_progress|completed|failed|nsfw|canceled, images: [{ url }] }
// Seedream (the CLI's model) is not on the cloud API; Grok Imagine 2.0 takes up
// to ten reference pictures and is the default. HIGGSFIELD_CLOUD_MODEL switches
// it (e.g. alibaba/qwen-image-3/edit, 1–3 references).
//
// Needs HF_API_KEY_ID + HF_API_KEY_SECRET (platform console → API keys) in the
// environment. Reference URLs must be public https — Cloudinary's are.

import 'server-only'
import crypto from 'node:crypto'
import { persistImageToCloudinary } from '@/lib/cloudinary-persist'

const API = 'https://api.higgsfield.ai'
const DEFAULT_MODEL = 'xai/grok-imagine-image-2.0'

export function cloudRendererAvailable(): boolean {
  return !!(process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET)
}

function authHeader(): string {
  return `Key ${process.env.HF_API_KEY_ID}:${process.env.HF_API_KEY_SECRET}`
}

function modelPath(): string {
  return (process.env.HIGGSFIELD_CLOUD_MODEL || DEFAULT_MODEL).replace(/^\/+/, '')
}

/** What the chosen model takes: Qwen edit wants 1–3 references, Grok up to 10. */
function maxRefs(model: string): number {
  return /qwen/.test(model) ? 3 : 10
}

function bodyFor(model: string, prompt: string, refs: string[]): Record<string, unknown> {
  if (/qwen-image-3\/edit/.test(model)) {
    return { prompt, image_urls: refs, aspect_ratio: '3:4', resolution: '2k' }
  }
  // Grok Imagine 2.0 generate-and-edit (and anything shaped like it).
  return { prompt, image_urls: refs, aspect_ratio: '3:4', resolution: '2k', quality: 'medium' }
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

/**
 * Prompt + public reference URLs → one picture persisted to Cloudinary under
 * higgsfield-shoots/<publicId>. Same shape as runHiggsfieldGeneration so a
 * caller can hold either. `budgetMs` bounds the wait for the render.
 */
export async function runHiggsfieldCloudGeneration(
  prompt: string,
  referenceUrls: string[],
  publicId: string,
  opts: { budgetMs?: number } = {},
): Promise<{ imageUrl?: string; imageUrls?: string[]; error?: string; providerJobIds?: string[]; submitted?: boolean }> {
  if (!cloudRendererAvailable()) return { error: 'Higgsfield cloud API keys (HF_API_KEY_ID / HF_API_KEY_SECRET) are not set' }
  if (!prompt?.trim()) return { error: 'No prompt provided' }
  const model = modelPath()
  const refs = (referenceUrls ?? []).filter((u) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, maxRefs(model))
  if (refs.length === 0) return { error: 'No public reference images' }

  // 1. Submit. The idempotency key lets a timed-out submit be repeated safely.
  const idem = crypto.randomUUID()
  let submitted: any
  try {
    const res = await fetch(`${API}/${model}`, {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json', 'Idempotency-Key': idem },
      body: JSON.stringify(bodyFor(model, prompt, refs)),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    if (!res.ok) return { error: `Higgsfield ${res.status}: ${text.slice(0, 300)}` }
    submitted = JSON.parse(text)
  } catch (e) {
    return { error: `Higgsfield submit failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  const requestId: string | undefined = submitted?.request_id
  const statusUrl: string = submitted?.status_url || (requestId ? `${API}/requests/${requestId}/status` : '')
  if (!statusUrl) return { error: 'Higgsfield returned no request id' }

  // 2. Poll: 2s growing to 10s with jitter, as their docs ask.
  const budgetMs = opts.budgetMs ?? 240_000
  const t0 = Date.now()
  let wait = 2000
  let last: any = submitted
  let polls = 0
  while (Date.now() - t0 < budgetMs) {
    await sleep(wait + Math.random() * 500)
    wait = Math.min(10_000, Math.round(wait * 1.4))
    try {
      const res = await fetch(statusUrl, { headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(20_000) })
      if (res.status === 401) return { error: 'Higgsfield rejected the API key', providerJobIds: requestId ? [requestId] : undefined, submitted: true }
      if (res.status === 404) return { error: 'Higgsfield lost the request', providerJobIds: requestId ? [requestId] : undefined, submitted: true }
      if (!res.ok) { polls++; continue } // 5xx: try again
      last = await res.json()
    } catch { polls++; continue }
    const status = String(last?.status ?? '')
    if (status === 'completed') break
    if (status === 'failed' || status === 'nsfw' || status === 'canceled') {
      return { error: `Higgsfield ${status}${last?.error ? `: ${String(last.error).slice(0, 200)}` : ''}`, providerJobIds: requestId ? [requestId] : undefined, submitted: true }
    }
  }
  const urls: string[] = Array.isArray(last?.images) ? last.images.map((i: any) => i?.url).filter((u: unknown): u is string => typeof u === 'string' && !!u) : []
  if (last?.status !== 'completed' || !urls.length) {
    return { error: 'Higgsfield is still rendering — ask again in a minute', providerJobIds: requestId ? [requestId] : undefined, submitted: true }
  }

  // 3. Keep it: the provider's URL expires; Cloudinary's does not.
  const persisted = await Promise.all(urls.map(async (raw, i) => {
    const cloud = await persistImageToCloudinary(raw, { folder: 'higgsfield-shoots', publicId: i === 0 ? publicId : `${publicId}-${i + 1}` })
    if (!cloud) console.error('[higgsfield-cloud] Cloudinary persist failed — keeping the ephemeral URL for', publicId)
    return cloud ?? raw
  }))
  return { imageUrl: persisted[0], imageUrls: persisted, providerJobIds: requestId ? [requestId] : undefined, submitted: true }
}
