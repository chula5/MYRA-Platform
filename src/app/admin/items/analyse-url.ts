'use server'

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export interface AnalysedProduct {
  product_name: string | null
  brand_name: string | null
  price: string | null
  currency: string | null
  item_type: string | null
  colour_hex: string | null
  colour_family: string | null
  material_primary: string | null
  material_category: string | null
  fit: number | null
  length: number | null
  rise: number | null
  structure: number | null
  shoulder: number | null
  waist_definition: number | null
  leg_opening: number | null
  surface: number | null
  colour_depth: number | null
  pattern: number | null
  sheen: number | null
  material_weight: number | null
  material_formality: number | null
  jewellery_scale: number | null
  jewellery_formality: number | null
}

export async function analyseProductUrl(
  url: string
): Promise<{ data?: AnalysedProduct; error?: string }> {
  if (!url) return { error: 'No URL provided' }

  try {
    // Fetch the product page
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    })
    clearTimeout(timeout)

    if (!res.ok) return { error: `Could not fetch page (${res.status})` }

    const html = await res.text()
    // Strip tags, collapse whitespace, cap at 12k chars
    const pageText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000)

    const prompt = `You are a fashion data analyst. Extract structured product data from the page text below and return ONLY a JSON object — no explanation, no markdown.

URL: ${url}

Page text:
${pageText}

Return this exact JSON (use null for unknown fields):
{
  "product_name": "full product name",
  "brand_name": "brand name only (not retailer)",
  "price": "numeric price as string with no currency symbol e.g. 495 or 1,295.00 — the current sale price if on sale, else retail, or null",
  "currency": one of exactly: GBP|USD|EUR|AUD|CAD|JPY or null,
  "item_type": one of exactly: coat|trench|jacket|blazer|gilet|cape|shirt|blouse|t-shirt|knitwear|corset|bodysuit|trousers|jeans|shorts|skirt|mini_dress|midi_dress|maxi_dress|shirt_dress|slip_dress|boot|heel|flat|sneaker|mule|sandal|tote|shoulder_bag|clutch|crossbody|structured_bag|belt|scarf|necklace|earrings|bracelet|ring|brooch|hair_accessory|hat|gloves|sunglasses,
  "colour_hex": "#RRGGBB based on product colour, or null",
  "colour_family": one of exactly: white|cream|black|grey|navy|brown|camel|green|burgundy|red|blue|pink|yellow|orange|purple|multicolour or null,
  "material_primary": "composition string e.g. 100% Silk, or null",
  "material_category": one of exactly: natural_woven|natural_knit|synthetic_woven|synthetic_knit|leather_suede|technical|mixed or null,
  "fit": integer 1-5 (1=skin tight, 5=oversized) or null,
  "length": integer 1-5 (1=cropped, 5=maxi/floor) or null,
  "rise": integer 1-5 (1=ultra low, 5=ultra high) or null,
  "structure": integer 1-5 (1=fully boned, 5=unstructured) or null,
  "shoulder": integer 1-5 (1=heavily padded, 5=off-shoulder/none) or null,
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

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0]
    if (!jsonStr) return { error: 'AI returned no structured data' }

    const data = JSON.parse(jsonStr) as AnalysedProduct
    return { data }
  } catch (err) {
    console.error('[analyseProductUrl]', err)
    return { error: err instanceof Error ? err.message : 'Analysis failed' }
  }
}
