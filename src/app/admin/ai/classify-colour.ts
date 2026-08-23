'use server'

// Colour from the product image.
//
// Colour is 3 of the 7 house-style points, so a piece whose colour nobody can
// read caps at 4 and can never clear a min score of 5 — the brand looks
// off-taste when really its feed is just quiet. THE POSSE is the clean case:
// 624 products, no colour option, no colour tag, and titles like "MAEVE LONG
// SLEEVE TOP". Most of those carry the colourway in the URL slug and are read
// for free in brand-watch; this is for the remainder, where the photograph is
// the only evidence — Venetian names like BOTTIGLIA and SALINA, and house
// words like DUSK, BLOSSOM and APPLE that no lexicon will ever cover.

import Anthropic from '@anthropic-ai/sdk'
import { fetchImageForVision } from '@/lib/vision-image'

// The families the scanner scores on, exactly as they are stored on the item.
const FAMILIES = [
  'black', 'white', 'cream', 'grey', 'navy', 'blue', 'green', 'brown', 'camel',
  'burgundy', 'red', 'pink', 'purple', 'orange', 'yellow', 'multicolour',
] as const

const PROMPT = `What colour is the GARMENT in this product photo?

Answer with exactly one word from this list:
${FAMILIES.join(', ')}

How to decide:
- Judge the garment being sold. Ignore the background, the model's skin and
  hair, and any other piece styled with it.
- If it carries a print, check, floral, dot or stripe in more than one colour,
  answer multicolour — even when the colours are close in tone, and even when
  one of them is white or cream.
- cream covers ivory, ecru, off-white, vanilla, pearl and butter — an ivory
  piece is cream, never white. camel covers beige, sand, tan, stone, taupe and
  nude. Keep white for a true bright white.
- Rust, terracotta, tobacco and chocolate are brown, not orange.
- Otherwise give the single dominant colour. Never explain.`

export async function classifyProductColour(
  imageUrl: string,
): Promise<{ colour: string | null; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { colour: null, error: 'ANTHROPIC_API_KEY not configured' }

  const { image, error } = await fetchImageForVision(imageUrl)
  if (!image) return { colour: null, error }

  try {
    const client = new Anthropic({ apiKey })
    const r = await client.messages.create({
      // Naming the colour of a garment is a far easier read than judging who
      // it is cut for, and this runs once per unreadable product across a
      // whole catalogue. Checked against Sonnet on THE POSSE: identical on
      // every unambiguous piece, so the cheap model is the right one here.
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
          { type: 'text', text: PROMPT },
        ],
      }],
    })
    const block = r.content.find((b) => b.type === 'text')
    const word = (block && block.type === 'text' ? block.text : '').trim().toLowerCase().replace(/[^a-z]/g, '')
    const hit = FAMILIES.find((f) => f === word)
    return hit ? { colour: hit } : { colour: null, error: word ? `unusable read "${word}"` : 'empty read' }
  } catch (err) {
    return { colour: null, error: err instanceof Error ? err.message : 'vision failed' }
  }
}
