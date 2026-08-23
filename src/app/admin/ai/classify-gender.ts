'use server'

// Gender classification from the product image.
//
// MYRA is womenswear only. Most feeds say so in a product type, tag or URL
// path, and lib/brand-watch reads those for free. But some sites carry NO
// gender signal anywhere — Adolfo Domínguez publishes flat URLs
// (/en-gb/linen-tailored-blazer-136151869261.html), numeric category codes,
// and a JS-rendered women's section — so 168 men's pieces reached the queue.
//
// For those, the picture is the only evidence. One cheap vision call per
// otherwise-unknowable product, cached on the row so it never repeats.

import Anthropic from '@anthropic-ai/sdk'
import { fetchImageForVision } from '@/lib/vision-image'

export type GenderRead = 'women' | 'men' | 'unclear'

const PROMPT = `Is this fashion product WOMEN'S or MEN'S wear?

Answer with exactly one word: women, men, or unclear.

How to decide, in order:
1. If a person is shown, judge THEM — face, body, hair, build — even if the
   shot is cropped to the torso or legs. A male model means "men", whatever
   the styling. Contemporary menswear is often loose, pastel and androgynous;
   do not read that as womenswear.
2. With no person, judge the garment's cut: bust darts, a nipped waist, a
   women's button side, narrow shoulders and a shaped body mean "women";
   a straight boxy body, wide shoulders and a men's placket mean "men".
3. If you genuinely cannot tell, answer "unclear". Do not guess.`

export async function classifyProductGender(imageUrl: string): Promise<{ gender: GenderRead; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { gender: 'unclear', error: 'ANTHROPIC_API_KEY not configured' }

  // The media type is sniffed from the bytes: the CDN header lies often enough
  // that trusting it cost real answers, and here an unanswered read excludes a
  // womenswear piece.
  const { image, error } = await fetchImageForVision(imageUrl)
  if (!image) return { gender: 'unclear', error }

  try {
    const client = new Anthropic({ apiKey })
    const r = await client.messages.create({
      // Haiku read a plainly male model in cropped shorts as womenswear, and a
      // whole queue of menswear followed. This call decides what MYRA shows,
      // so it uses the stronger model — it still costs one word of output.
      model: 'claude-sonnet-4-6',
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
    const word = block && block.type === 'text' ? block.text.trim().toLowerCase() : ''
    if (word.startsWith('women')) return { gender: 'women' }
    if (word.startsWith('men')) return { gender: 'men' }
    return { gender: 'unclear' }
  } catch (err) {
    return { gender: 'unclear', error: err instanceof Error ? err.message : 'vision failed' }
  }
}
