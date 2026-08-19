'use server'

// Vision pass for a persona's inspiration images.
//
// Deliberately separate from analyseOutfit: that one reads a look MYRA might
// publish (labels, slot-by-slot scores, occasion tags). This one reads a
// moodboard image as a LENS — only the dimensions legible from a photograph,
// plus a confidence, so weak reads sort to the top of the review grid instead
// of quietly entering the envelope.

import Anthropic from '@anthropic-ai/sdk'
import type { InspirationScores } from '@/lib/inspiration'

export interface InspirationAnalysis extends InspirationScores {
  occasion_read: string[]
  score_confidence: number
}

const PROMPT = `You are a fashion analyst for MYRA. Read this inspiration image as a STYLE LENS — what kind of dressing it represents — not as a product to sell.

Return ONLY a JSON object, no prose and no markdown fences:

{
  "construction": 1-5,      // 1=TAILORED/STRUCTURED, 5=RELAXED/UNSTRUCTURED
  "volume": 1-5,            // 1=FITTED/CLOSE TO BODY, 5=OVERSIZED/DRAMATIC
  "colour_story": 1-5,      // 1=MONOCHROME/TONAL, 5=HIGH CONTRAST/MULTI-COLOUR
  "surface_story": 1-5,     // 1=CLEAN/PLAIN, 5=HEAVILY TEXTURED
  "pattern": 1-5,           // 1=SOLID, 5=STATEMENT PRINT
  "colour_depth": 1-5,      // 1=PALE/WASHED, 5=DEEP/SATURATED
  "sheen": 1-5,             // 1=FULLY MATTE, 5=HIGH SHINE/LIQUID
  "formality": 1-5,         // 1=EVERYDAY, 5=BLACK TIE
  "item_types": [],         // garments actually visible, from the list below
  "occasion_read": [],      // 2-4 lowercase occasions this look reads as
  "score_confidence": 1-5   // YOUR confidence in the reading above
}

item_types must come from: coat, trench, jacket, blazer, gilet, cape, shirt, blouse, t-shirt, knitwear, corset, bodysuit, trousers, jeans, shorts, skirt, mini_dress, midi_dress, maxi_dress, shirt_dress, slip_dress, boot, heel, flat, sneaker, mule, sandal, tote, shoulder_bag, clutch, crossbody, structured_bag, belt, scarf, hat, gloves, sunglasses, necklace, earrings, bracelet, ring.
Only list what you can actually see. An empty array is correct when nothing is legible.

score_confidence is about the IMAGE, and it matters — a human reviews low-confidence reads first. Score it 1-2 when the image is a detail crop, heavily filtered, badly lit, or the garments are obscured; 3 when you are reading partly from context; 4-5 only when the full look is clearly visible.`

const ALLOWED_TYPES = new Set([
  'coat', 'trench', 'jacket', 'blazer', 'gilet', 'cape', 'shirt', 'blouse', 't-shirt',
  'knitwear', 'corset', 'bodysuit', 'trousers', 'jeans', 'shorts', 'skirt',
  'mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress',
  'boot', 'heel', 'flat', 'sneaker', 'mule', 'sandal',
  'tote', 'shoulder_bag', 'clutch', 'crossbody', 'structured_bag',
  'belt', 'scarf', 'hat', 'gloves', 'sunglasses', 'necklace', 'earrings', 'bracelet', 'ring',
])

const clamp5 = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  if (Number.isNaN(n)) return null
  return Math.max(1, Math.min(5, Math.round(n)))
}

export async function analyseInspirationImage(
  imageUrl: string,
): Promise<{ data?: InspirationAnalysis; error?: string }> {
  if (!imageUrl) return { error: 'No image URL provided' }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY not configured' }

  try {
    // Images are already re-hosted on Cloudinary by this point, so ask for a
    // vision-sized rendition rather than the full-resolution original.
    const safeUrl = imageUrl.includes('res.cloudinary.com')
      ? imageUrl.replace('/upload/', '/upload/c_limit,w_1400,q_auto:good/')
      : imageUrl

    const imgRes = await fetch(safeUrl)
    if (!imgRes.ok) return { error: `Could not fetch image (${imgRes.status})` }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const mediaType = allowed.find((t) => contentType.includes(t)) ?? 'image/jpeg'

    const buf = await imgRes.arrayBuffer()
    const MAX_BYTES = 5 * 1024 * 1024 - 256 * 1024
    if (buf.byteLength > MAX_BYTES) {
      return { error: `Image too large for the vision pass (${(buf.byteLength / 1048576).toFixed(1)} MB)` }
    }

    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: Buffer.from(buf).toString('base64'),
            },
          },
          { type: 'text', text: PROMPT },
        ],
      }],
    })

    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') return { error: 'No text response from the vision pass' }

    let raw = block.text.trim()
    if (raw.startsWith('```')) raw = raw.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim()

    const parsed = JSON.parse(raw) as Record<string, unknown>
    const itemTypes = Array.isArray(parsed.item_types)
      ? (parsed.item_types as unknown[]).map((t) => String(t).toLowerCase().trim()).filter((t) => ALLOWED_TYPES.has(t))
      : []
    const occasions = Array.isArray(parsed.occasion_read)
      ? (parsed.occasion_read as unknown[]).map((o) => String(o).toLowerCase().trim()).filter(Boolean).slice(0, 4)
      : []

    return {
      data: {
        construction: clamp5(parsed.construction),
        volume: clamp5(parsed.volume),
        colour_story: clamp5(parsed.colour_story),
        surface_story: clamp5(parsed.surface_story),
        pattern: clamp5(parsed.pattern),
        colour_depth: clamp5(parsed.colour_depth),
        sheen: clamp5(parsed.sheen),
        formality: clamp5(parsed.formality),
        item_types: itemTypes,
        occasion_read: occasions,
        // Unreadable confidence is treated as low, so it surfaces for review.
        score_confidence: clamp5(parsed.score_confidence) ?? 1,
      },
    }
  } catch (err: unknown) {
    console.error('[analyseInspirationImage]', err)
    return { error: err instanceof Error ? err.message : 'Vision pass failed' }
  }
}
