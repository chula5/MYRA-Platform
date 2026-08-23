'use server'

import Anthropic from '@anthropic-ai/sdk'
import type { AnalysedProduct } from '@/app/admin/items/analyse-url'
import { DEFAULT_SCORING_MODEL } from '@/lib/item-scoring'

/**
 * Vision fallback for when a retailer URL can't be scraped.
 *
 * Takes a hosted image URL (typically the Cloudinary URL produced by
 * "SAVE TO CLOUDINARY") and asks Claude to read the product's features
 * straight off the photo, returning the SAME shape as analyseProductUrl so
 * the form's existing auto-fill logic populates the 1-5 boxes identically.
 */

const PROMPT = `You are a fashion data analyst for MYRA. Look at this product image and extract structured data about the single garment or accessory shown. Return ONLY a JSON object — no explanation, no markdown, no code fences.

Score every field you can confidently read from the image. Use null only when a dimension genuinely does not apply to this item type (e.g. rise/leg_opening for a bag) or cannot be judged from the photo.

Return this exact JSON:
{
  "product_name": "short descriptive name if any text/branding is legible, else null",
  "brand_name": "brand name only if clearly legible in the image, else null",
  "price": null,
  "currency": null,
  "item_type": one of exactly: coat|trench|jacket|blazer|gilet|cape|shirt|blouse|t-shirt|knitwear|corset|bodysuit|trousers|jeans|shorts|skirt|mini_dress|midi_dress|maxi_dress|shirt_dress|slip_dress|boot|heel|flat|sneaker|mule|sandal|tote|shoulder_bag|clutch|crossbody|structured_bag|belt|scarf|necklace|earrings|bracelet|ring|brooch|hair_accessory|hat|gloves|sunglasses,
  "colour_hex": "#RRGGBB of the dominant garment colour, or null",
  "colour_family": one of exactly: white|cream|black|grey|navy|brown|camel|green|burgundy|red|blue|pink|yellow|orange|purple|multicolour or null,
  "material_primary": "best-guess composition from the visible texture e.g. Wool, Silk, Leather, or null",
  "material_category": one of exactly: natural_woven|natural_knit|synthetic_woven|synthetic_knit|leather_suede|technical|mixed or null,
  "fit": integer 1-5 (1=skin tight, 5=oversized) or null,
  "length": integer 1-5 (1=cropped, 5=maxi/floor) or null,
  "rise": integer 1-5 (1=ultra low, 5=ultra high) or null,
  "structure": integer 1-5 (1=fully boned, 5=unstructured) or null,
  "shoulder": integer 1-5 (1=heavily padded, 5=off-shoulder/none) or null,
  "neckline": integer 1-5 (1=high/closed e.g. crew or funnel, 3=open e.g. shallow v or scoop, 5=plunging/low) or null — null unless it's a top, dress or bodysuit,
  "sleeve": integer 1-5 (1=sleeveless/strappy, 2=cap, 3=short, 4=three-quarter, 5=full long sleeve) or null — null unless it's a top, dress or bodysuit,
  "waist_definition": integer 1-5 (1=corseted, 5=boxy) or null,
  "leg_opening": integer 1-5 (1=narrow, 5=flared) or null,
  "surface": integer 1-5 (1=clean/flat, 5=highly patterned) or null,
  "colour_depth": integer 1-5 (1=pure neutral, 5=bold/bright) or null,
  "pattern": integer 1-5 (1=none, 5=statement pattern) or null,
  "sheen": integer 1-5 (1=matte, 5=high shine) or null,
  "material_weight": integer 1-5 (1=sheer, 5=structural) or null,
  "material_formality": integer 1-5 (1=casual, 5=occasion) or null,
  "jewellery_scale": integer 1-5 (1=micro, 5=sculptural) or null,
  "jewellery_formality": integer 1-5 (1=everyday, 5=haute joaillerie) or null
}`

/**
 * Inject size-capping transforms into a Cloudinary URL so the image stays under
 * Claude's 5MB vision limit. Leaves non-Cloudinary URLs untouched.
 *
 *   .../upload/v123/foo.jpg  →  .../upload/w_2000,q_auto,f_jpg/v123/foo.jpg
 */
function capCloudinaryImage(url: string): string {
  if (!url.includes('res.cloudinary.com')) return url
  if (/\/upload\/[^/]*[wqf]_/.test(url)) return url
  return url.replace('/upload/', '/upload/w_2000,q_auto,f_jpg/')
}

export async function analyseProductImage(
  imageUrl: string,
  model: string = DEFAULT_SCORING_MODEL,
): Promise<{ data?: AnalysedProduct; error?: string; usage?: { input_tokens: number; output_tokens: number; model: string } }> {
  if (!imageUrl || !imageUrl.startsWith('http')) {
    return { error: 'Paste a valid image URL first' }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY not configured' }

  try {
    const safeUrl = capCloudinaryImage(imageUrl)

    // Fetch the image server-side and convert to base64 so any host works.
    const imgRes = await fetch(safeUrl)
    if (!imgRes.ok) return { error: `Could not fetch image (${imgRes.status})` }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const mediaType = allowedTypes.find((t) => contentType.includes(t)) ?? 'image/jpeg'

    const arrayBuffer = await imgRes.arrayBuffer()
    // Claude vision rejects base64 images over 5MB.
    const MAX_BYTES = 5 * 1024 * 1024 - 256 * 1024
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return {
        error: `Image is too large (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)} MB). Re-upload it to Cloudinary — the server will auto-resize it.`,
      }
    }
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: base64,
              },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return { error: 'No text response from AI' }
    }

    let raw = textBlock.text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim()
    }
    const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0]
    if (!jsonStr) return { error: 'AI returned no structured data' }

    const data = JSON.parse(jsonStr) as AnalysedProduct
    // Usage rides along so callers that pay per item (wardrobe import) can log spend.
    return { data, usage: { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0, model: response.model } }
  } catch (err: unknown) {
    console.error('[analyseProductImage]', err)
    if (err instanceof SyntaxError) {
      return { error: 'AI returned invalid JSON — try again' }
    }
    return { error: err instanceof Error ? err.message : 'Analysis failed' }
  }
}
