// The portrait: GPT Image via OpenAI's /images/edits, several reference photos in, one face out.
// The only step not on Google — GPT Image was the one model that kept Chloe's likeness (2026-11-08).

import 'server-only'
import { AVATAR_CONFIG } from './config'
import type { ImageRef } from './google'

export class OpenAIImageError extends Error {
  constructor(message: string, public status?: number) { super(message); this.name = 'OpenAIImageError' }
}

const apiBase = () => (process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')

export async function generateOpenAIImage(opts: {
  prompt: string
  images: ImageRef[]
  model?: string
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  quality?: 'low' | 'medium' | 'high'
}): Promise<{ png: Buffer; ms: number }> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new OpenAIImageError('OPENAI_API_KEY is missing')
  const form = new FormData()
  form.set('model', opts.model ?? AVATAR_CONFIG.portraitModels[0])
  form.set('prompt', opts.prompt)
  form.set('size', opts.size ?? '1024x1024')
  form.set('quality', opts.quality ?? 'high')
  form.set('n', '1')
  form.set('output_format', 'png')
  opts.images.forEach((img, i) => form.append('image[]', new Blob([new Uint8Array(img.bytes)], { type: img.mime }), `ref-${i + 1}.${img.mime === 'image/png' ? 'png' : 'jpg'}`))
  const t0 = Date.now()
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${apiBase()}/images/edits`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(180_000) })
      const body: any = await res.json().catch(() => ({}))
      if (!res.ok) {
        const err = new OpenAIImageError(body?.error?.message ?? `OpenAI image edit failed (${res.status})`, res.status)
        if (res.status >= 500 || res.status === 429) { lastErr = err; continue }
        throw err
      }
      const b64: string | undefined = body.data?.[0]?.b64_json
      if (!b64) throw new OpenAIImageError('OpenAI returned no image data', res.status)
      return { png: Buffer.from(b64, 'base64'), ms: Date.now() - t0 }
    } catch (e) {
      lastErr = e
      if (e instanceof OpenAIImageError && e.status && e.status < 500 && e.status !== 429) throw e
    }
  }
  throw lastErr instanceof Error ? lastErr : new OpenAIImageError(String(lastErr))
}
