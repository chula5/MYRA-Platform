// OpenAI calls for the wardrobe pipeline — plain fetch, no SDK. Two endpoints:
//   POST /responses     — detect garments in a photo (structured JSON output)
//   POST /images/edits  — regenerate one garment as a product cutout on white
// Every call returns its usage block so cost.ts can price it.

import 'server-only'
import { WARDROBE_CONFIG, openAiApiKey } from './config'
import { DETECT_PROMPT, DETECT_SCHEMA, normaliseDetectedList } from './detect'
import type { ApiUsage, DetectedGarment } from './types'

export class OpenAIError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function authHeaders(): Record<string, string> {
  const key = openAiApiKey()
  if (!key) throw new OpenAIError('OPENAI_API_KEY is not configured', 0)
  return { Authorization: `Bearer ${key}` }
}

function pickUsage(u: any): ApiUsage | null {
  if (!u || typeof u !== 'object') return null
  return {
    input_tokens: u.input_tokens ?? u.prompt_tokens ?? null,
    output_tokens: u.output_tokens ?? u.completion_tokens ?? null,
    image_input_tokens: u.input_tokens_details?.image_tokens ?? null,
    image_output_tokens: u.output_tokens_details?.image_tokens ?? null,
  }
}

/** Stage 1 — one photo in, zero..8 garments out. */
export async function detectGarments(
  jpeg: Buffer,
  opts: { model?: string } = {},
): Promise<{ garments: DetectedGarment[]; raw: unknown; usage: ApiUsage | null; model: string; ms: number }> {
  const model = opts.model ?? WARDROBE_CONFIG.visionModel
  const started = Date.now()
  const res = await fetch(`${WARDROBE_CONFIG.apiBase}/responses`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: DETECT_PROMPT },
            { type: 'input_image', image_url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, detail: 'high' },
          ],
        },
      ],
      text: { format: { type: 'json_schema', name: 'wardrobe_garments', strict: true, schema: DETECT_SCHEMA } },
    }),
  })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new OpenAIError(body?.error?.message ?? `OpenAI detect failed (${res.status})`, res.status)
  const text: string | undefined =
    body.output_text ??
    body.output?.flatMap((o: any) => o.content ?? []).find((c: any) => c.type === 'output_text')?.text
  if (!text) throw new OpenAIError('OpenAI detect returned no structured output', res.status)
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new OpenAIError('OpenAI detect returned invalid JSON', res.status)
  }
  return {
    garments: normaliseDetectedList(parsed?.items, WARDROBE_CONFIG.maxGarmentsPerPhoto),
    raw: parsed,
    usage: pickUsage(body.usage),
    model,
    ms: Date.now() - started,
  }
}

/** Stage 2 — one crop in, one product-style cutout (PNG bytes) out. */
export async function editToCutout(
  cropPng: Buffer,
  prompt: string,
  opts: { model?: string; quality?: 'low' | 'medium' | 'high'; size?: string } = {},
): Promise<{ png: Buffer; usage: ApiUsage | null; model: string; ms: number }> {
  const model = opts.model ?? WARDROBE_CONFIG.imageModel
  const quality = opts.quality ?? WARDROBE_CONFIG.imageQuality
  const size = opts.size ?? WARDROBE_CONFIG.imageSize
  const started = Date.now()
  const form = new FormData()
  form.set('model', model)
  form.set('prompt', prompt)
  form.set('size', size)
  form.set('quality', quality)
  form.set('n', '1')
  form.set('output_format', 'png')
  form.append('image[]', new Blob([new Uint8Array(cropPng)], { type: 'image/png' }), 'garment.png')
  const res = await fetch(`${WARDROBE_CONFIG.apiBase}/images/edits`, { method: 'POST', headers: authHeaders(), body: form })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new OpenAIError(body?.error?.message ?? `OpenAI image edit failed (${res.status})`, res.status)
  const b64: string | undefined = body.data?.[0]?.b64_json
  if (!b64) throw new OpenAIError('OpenAI image edit returned no image data', res.status)
  return { png: Buffer.from(b64, 'base64'), usage: pickUsage(body.usage), model, ms: Date.now() - started }
}
