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

import { readWordFromImage } from '@/lib/openai-vision'
// The shade list lives in a plain module: a 'use server' file may export only
// async functions, and exporting a constant here took Brand Watch down.
import { PALE_SHADES, type PaleShade } from '@/lib/pale-tone'

// The families the scanner scores on, exactly as they are stored on the item.
const FAMILIES = [
  'black', 'white', 'cream', 'grey', 'navy', 'blue', 'green', 'brown', 'camel',
  'burgundy', 'red', 'pink', 'purple', 'orange', 'yellow', 'multicolour',
] as const

/**
 * The piece named, when the scan knows what it is. A product photo of
 * trousers is a model in trousers AND a top: asked for "the garment", the
 * reader answered with the top — MKDT's fig trousers came back cream, the
 * colour of the knit above them. Naming the piece tells it what to look at.
 */
const promptFor = (garment?: string | null) => `What colour is the ${garment ? garment.toUpperCase() : 'GARMENT'} in this product photo?

Answer with exactly one word from this list:
${FAMILIES.join(', ')}

How to decide:
- Judge ${garment ? `only the ${garment} being sold` : 'the garment being sold'}. Ignore the background, the model's skin and
  hair, and any other piece styled with it${garment ? ` — a top, trousers or shoes worn with the ${garment} do not count` : ''}.
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
  /** What the piece is — "trousers", "bag", "earrings" — so the read looks at it and not at what the model wears with it. */
  garment?: string | null,
): Promise<{ colour: string | null; error?: string }> {
  try {
    // The cheap reader (lib/openai-vision). Anthropic was doing this for a
    // measured 10x the cost and is out of credit, which left every unreadable
    // piece with no colour at all — and colour is 3 of the 7 house-style
    // points, so those pieces could never clear a min score of 5.
    const { word, error } = await readWordFromImage(imageUrl, promptFor(garment))
    if (error) return { colour: null, error }
    const read = word.trim().toLowerCase().replace(/[^a-z]/g, '')
    const hit = FAMILIES.find((f) => f === read)
    return hit ? { colour: hit } : { colour: null, error: read ? `unusable read "${read}"` : 'empty read' }
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
  try {
    // High detail here, unlike the family read: ivory against cream is a
    // question about a few degrees of warmth, and the coarse read cannot see
    // that. It still costs a fifth of the Haiku read that used to do this.
    const { word, error } = await readWordFromImage(imageUrl, SHADE_PROMPT, { maxTokens: 10, detail: 'high' })
    if (error) return { shade: null, error }
    const read = word.trim().toLowerCase().replace(/[^a-z_]/g, '')
    const hit = PALE_SHADES.find((x) => x === read)
    return hit ? { shade: hit } : { shade: null, error: read ? `unusable read "${read}"` : 'empty read' }
  } catch (err) {
    return { shade: null, error: err instanceof Error ? err.message : 'vision failed' }
  }
}
