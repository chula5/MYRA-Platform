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

export type GenderRead = 'women' | 'men' | 'unclear'

const PROMPT = `Is this a WOMEN'S or MEN'S fashion product?

Answer with exactly one word: women, men, or unclear.

Judge on the garment and, if a model is shown, who it is cut for. Unisex or
genuinely ambiguous pieces (most bags, jewellery, scarves, sunglasses) are
"unclear" — not a guess. Answer "men" only when it is clearly menswear.`

export async function classifyProductGender(imageUrl: string): Promise<{ gender: GenderRead; error?: string }> {
  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) return { gender: 'unclear', error: 'no image' }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { gender: 'unclear', error: 'ANTHROPIC_API_KEY not configured' }

  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return { gender: 'unclear', error: `image fetch ${res.status}` }
    const ct = res.headers.get('content-type') ?? 'image/jpeg'
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const mediaType = allowed.find((t) => ct.includes(t)) ?? 'image/jpeg'
    const buf = await res.arrayBuffer()
    if (buf.byteLength > 4.5 * 1024 * 1024) return { gender: 'unclear', error: 'image too large' }

    const client = new Anthropic({ apiKey })
    const r = await client.messages.create({
      // Cheapest capable model — this is a one-word visual call, not styling.
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType as any, data: Buffer.from(buf).toString('base64') } },
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
