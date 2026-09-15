// NOT a 'use server' module, on purpose: every export of a 'use server' file is
// callable by anyone from the browser, and these run without an admin session
// (cron, src/lib pipelines, /me client actions). Browser-facing callers must go
// through an admin-gated 'use server' wrapper. Don't add 'use server' here.

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
// The shade list lives in a plain module: a 'use server' file may export only
// async functions, and exporting a constant here took Brand Watch down.
import { PALE_SHADES, type PaleShade } from '@/lib/pale-tone'

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


// ── White or cream ──────────────────────────────────────────────────────────
// Chloe's rule, for every client: white and cream do not go together. The
// stored colour codes cannot answer it — they are picked from a small palette
// (87 pale pieces share one code) or are stock web colour names like #F5F5DC —
// and the family read above deliberately files ivory under cream. So a pale
// piece gets its own read of which side it sits on.


const SHADE_PROMPT = `Look only at the GARMENT being sold in this product photo — ignore the background, skin, hair and anything styled with it.

Which of these is its main colour? Answer with exactly one word:
optic_white — a bright, cool, pure white
off_white — a soft white with barely any warmth
ivory — a white with a slight warm cast, still reads as white next to cream
cream — clearly yellowed or warm, reads as cream rather than white
butter — a pale buttery or light yellow cream
ecru — raw, greyish-beige natural undyed cream
not_pale — anything else (beige, sand, grey, a colour, a print, black)

Never explain.`

export async function classifyPaleShade(imageUrl: string): Promise<{ shade: PaleShade | null; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { shade: null, error: 'ANTHROPIC_API_KEY not configured' }
  const { image, error } = await fetchImageForVision(imageUrl)
  if (!image) return { shade: null, error }
  try {
    const client = new Anthropic({ apiKey })
    const r = await client.messages.create({
      // Same read class as the family read above, once per pale product.
      model: 'claude-haiku-4-5',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
          { type: 'text', text: SHADE_PROMPT },
        ],
      }],
    })
    const block = r.content.find((b) => b.type === 'text')
    const word = (block && block.type === 'text' ? block.text : '').trim().toLowerCase().replace(/[^a-z_]/g, '')
    const hit = PALE_SHADES.find((x) => x === word)
    return hit ? { shade: hit } : { shade: null, error: word ? `unusable read "${word}"` : 'empty read' }
  } catch (err) {
    return { shade: null, error: err instanceof Error ? err.message : 'vision failed' }
  }
}
