// SPLIT A SCREENSHOT INTO OUTFITS.
//
// A pasted image is either one outfit photo or a screenshot of many — a
// Pinterest board, a shop grid. Claude finds each separate outfit photo; each
// is cropped out and saved as its own reference picture, so every outfit is
// scored on its own rather than the whole collage being read as one look.
//
// Server use only (reads ANTHROPIC_API_KEY); no 'server-only' import so the
// detector can be exercised from a script against a real screenshot.

import Anthropic from '@anthropic-ai/sdk'
import { normaliseTileBoxes, coversImage, type TileBox } from './tile-boxes'

/** Long edge of the image shown to the model — box coordinates are in this space. */
const VISION_LONG_EDGE = 1568

const PROMPT = (w: number, h: number) => `This image is ${w}×${h} pixels. It is either a single fashion photo, or a screenshot containing several separate photos (for example a Pinterest board or a shop grid).

Find every separate photo in it that shows an OUTFIT — a person wearing a look, or a flat lay of a complete look.

Ignore: app chrome, search bars, buttons, text, captions, avatars, adverts, logos, close-ups of a single accessory, and any photo cut off so that less than about half of it is visible.

For each outfit photo, give the rectangle of the whole photo tile (not just the person) in pixels of this ${w}×${h} image: x and y of the top-left corner, width and height. If the image is one single outfit photo, return one box covering that photo. If no outfit is visible, return an empty list.`

const SCHEMA = {
  type: 'object',
  properties: {
    outfits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          x: { type: 'integer' },
          y: { type: 'integer' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          description: { type: 'string' },
        },
        required: ['x', 'y', 'width', 'height', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['outfits'],
  additionalProperties: false,
} as const

export interface OutfitSplit {
  /** One JPEG per outfit found — the original image itself when it is a single photo. */
  crops: Buffer[]
  /** How many outfit photos the model found in the image. */
  found: number
  /** Why it fell back to keeping the image whole, if it did. */
  note?: string
}

export async function splitIntoOutfits(original: Buffer): Promise<OutfitSplit> {
  const sharp = (await import('sharp')).default
  const meta = await sharp(original).rotate().metadata()
  const width = meta.autoOrient?.width ?? meta.width ?? 0
  const height = meta.autoOrient?.height ?? meta.height ?? 0
  const whole = (note: string, found = 1): OutfitSplit => ({ crops: [original], found, note })
  if (!width || !height) return whole('could not read the image size')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return whole('ANTHROPIC_API_KEY not configured')

  // Show the model a bounded rendition; its boxes are scaled back up after.
  const scale = Math.max(1, Math.max(width, height) / VISION_LONG_EDGE)
  const shownW = Math.round(width / scale)
  const shownH = Math.round(height / scale)
  const shown = await sharp(original).rotate().resize(shownW, shownH).jpeg({ quality: 85 }).toBuffer()

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      // Refusals re-run server-side on Anthropic's recommended fallback.
      betas: ['server-side-fallback-2026-07-01'],
      ...({ fallbacks: 'default' } as Record<string, unknown>),
      output_config: { format: { type: 'json_schema', schema: SCHEMA as any } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shown.toString('base64') } },
          { type: 'text', text: PROMPT(shownW, shownH) },
        ],
      }],
    } as any) as Anthropic.Beta.BetaMessage

    if (response.stop_reason === 'refusal') return whole('the vision pass declined this image')
    const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text
    if (!text) return whole('no answer from the vision pass')

    const parsed = JSON.parse(text) as { outfits?: (TileBox & { description?: string })[] }
    const boxes = normaliseTileBoxes(parsed.outfits ?? [], scale, width, height)
    if (boxes.length === 0) return whole('no separate outfit photos found', 0)
    if (boxes.length === 1 && coversImage(boxes[0], width, height)) return whole('a single photo', 1)

    const crops: Buffer[] = []
    for (const b of boxes) {
      crops.push(await sharp(original).rotate().extract({ left: b.x, top: b.y, width: b.width, height: b.height }).jpeg({ quality: 90 }).toBuffer())
    }
    return { crops, found: boxes.length }
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return whole('rate limited — kept as one picture')
    if (err instanceof Anthropic.APIError) return whole(`vision pass error ${err.status}`)
    console.error('[splitIntoOutfits]', err)
    return whole(err instanceof Error ? err.message : 'split failed')
  }
}
