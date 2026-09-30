// One word back from an image, from the cheapest reader that works.
//
// OpenAI rather than Anthropic, for two measured reasons. On a real piece the
// same read costs $0.00004 against $0.00043 on Haiku and $0.00128 on Sonnet —
// and the Anthropic key is currently out of credit, so every one of those reads
// comes back with nothing at all. Colour and gender were both dead.
//
// The GENDER read stays on Anthropic on purpose. It decides whether menswear
// reaches the library, and it was moved up to a stronger model after a cheaper
// one read a plainly male model as womenswear. Cheaper is not automatically
// right for a read that decides what she is shown; this module is for the reads
// that name a thing, where a wrong answer is visible and correctable.

import { fetchImageForVision } from '@/lib/vision-image'

/** The cheap reader the word reads use. */
export const VISION_WORD_MODEL = process.env.BRAND_WATCH_VISION_MODEL || 'gpt-6-luna'

export async function readWordFromImage(
  imageUrl: string,
  prompt: string,
  opts: { maxTokens?: number; model?: string; detail?: 'low' | 'high' } = {},
): Promise<{ word: string; error?: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { word: '', error: 'OPENAI_API_KEY not configured' }

  // The media type is sniffed from the bytes, as in the gender read: CDN
  // headers lie often enough to matter.
  const { image, error } = await fetchImageForVision(imageUrl)
  if (!image) return { word: '', error }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model ?? VISION_WORD_MODEL,
        max_completion_tokens: opts.maxTokens ?? 12,
        reasoning_effort: 'none',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:${image.mediaType};base64,${image.data}`, detail: opts.detail ?? 'low' },
            },
          ],
        }],
      }),
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) return { word: '', error: `HTTP ${res.status}: ${String(j?.error?.message ?? '').slice(0, 160)}` }
    return { word: String(j.choices?.[0]?.message?.content ?? '') }
  } catch (err) {
    return { word: '', error: err instanceof Error ? err.message : 'vision failed' }
  }
}
