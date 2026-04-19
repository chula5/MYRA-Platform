'use server'

import Anthropic from '@anthropic-ai/sdk'

export interface DetectedItem {
  slot: 'outerwear' | 'top' | 'bottom' | 'dress' | 'shoe' | 'bag' | 'jewellery' | 'accessory'
  description: string
}

export interface OutfitAnalysis {
  aesthetic_label: string
  occasion_tags: string[]
  detected_items: DetectedItem[]
  // Occasion scoring
  formality: number
  planning: number
  wearer_priority: number
  time_of_day: number
  // Outfit scoring
  construction: number
  surface_story: number
  volume: number
  colour_story: number
  intent: number
  // Slot scoring (nullable)
  outerwear_construction: number | null
  outerwear_volume: number | null
  outerwear_material_weight: number | null
  outerwear_material_formality: number | null
  top_construction: number | null
  top_volume: number | null
  top_material_weight: number | null
  top_material_formality: number | null
  bottom_construction: number | null
  bottom_volume: number | null
  bottom_rise: number | null
  bottom_leg_opening: number | null
  bottom_material_weight: number | null
  shoe_formality: number | null
  shoe_style: number | null
  dress_construction: number | null
  dress_volume: number | null
  dress_length: number | null
  dress_material_weight: number | null
  dress_material_formality: number | null
  bag_formality: number | null
  jewellery_scale: number | null
  jewellery_formality: number | null
}

const PROMPT = `You are a fashion analyst for MYRA, a fashion discovery app. Analyse this outfit image and return a JSON object with the following scores.

REQUIRED FIELDS:
- aesthetic_label: A 2-4 word aesthetic description in ALL CAPS (e.g. "CLEAN COASTAL EASE", "MINIMAL LUXURY", "QUIET POWER DRESSING")
- occasion_tags: Array of 2-4 lowercase occasion strings (e.g. ["dinner", "weekend", "gallery opening"])
- detected_items: Array of garment/accessory objects visible in the image. Each object has:
  - slot: one of "outerwear", "top", "bottom", "dress", "shoe", "bag", "jewellery", "accessory"
  - description: a brief description of the specific item (e.g. "oversized white linen blazer", "wide-leg cream tailored trousers", "pointed toe kitten heel mule")

OCCASION SCORING (required integers 1-5):
- formality: 1=CASUAL/EVERYDAY, 5=BLACK TIE
- planning: 1=SPONTANEOUS/ERRAND, 5=DESTINATION/SPECIAL OCCASION
- wearer_priority: 1=MAX COMFORT, 5=SACRIFICIAL IMPACT (style over comfort)
- time_of_day: 1=DAYTIME, 5=NIGHT

OUTFIT SCORING (required integers 1-5):
- construction: 1=TAILORED/STRUCTURED, 5=RELAXED/UNSTRUCTURED
- surface_story: 1=CLEAN/PLAIN, 5=HEAVILY PATTERNED/TEXTURED
- volume: 1=FITTED/CLOSE TO BODY, 5=OVERSIZED/DRAMATIC VOLUME
- colour_story: 1=PURE NEUTRAL (white/black/beige/grey), 5=BOLD COLOUR or PRINT
- intent: 1=BACKGROUND/UNDERSTATED, 5=DOMINANT STATEMENT

SLOT SCORING (nullable integers 1-5 — only score garment slots visible in the image, use null for anything not present):
- outerwear_construction (1=TAILORED, 5=RELAXED), outerwear_volume (1=FITTED, 5=OVERSIZED), outerwear_material_weight (1=SHEER, 5=STRUCTURAL), outerwear_material_formality (1=CASUAL, 5=OCCASION)
- top_construction, top_volume, top_material_weight, top_material_formality
- bottom_construction, bottom_volume, bottom_rise (1=ULTRA LOW, 5=ULTRA HIGH), bottom_leg_opening (1=NARROW, 5=FLARED), bottom_material_weight
- dress_construction (1=TAILORED, 5=RELAXED), dress_volume (1=FITTED, 5=OVERSIZED), dress_length (1=MICRO/MINI, 5=MAXI/FLOOR), dress_material_weight (1=SHEER, 5=STRUCTURAL), dress_material_formality (1=CASUAL, 5=OCCASION) — only score if a dress is present
- shoe_formality (1=CASUAL, 5=OCCASION), shoe_style (1=FLAT/CASUAL, 5=HEEL/STATEMENT)
- bag_formality (1=CASUAL tote, 5=OCCASION clutch/structured)
- jewellery_scale (1=MICRO/DELICATE, 5=SCULPTURAL/OVERSIZED), jewellery_formality (1=EVERYDAY, 5=HAUTE JOAILLERIE)

Return ONLY a valid JSON object. No markdown, no explanation, no code fences.`

/**
 * Inject size-capping transforms into a Cloudinary URL so the image stays under
 * Claude's 5MB vision limit. Leaves non-Cloudinary URLs untouched.
 *
 *   .../upload/v123/foo.jpg  →  .../upload/w_2000,q_auto,f_jpg/v123/foo.jpg
 */
function capCloudinaryImage(url: string): string {
  if (!url.includes('res.cloudinary.com')) return url
  // Avoid double-applying if a transform is already present
  if (/\/upload\/[^/]*[wqf]_/.test(url)) return url
  return url.replace('/upload/', '/upload/w_2000,q_auto,f_jpg/')
}

export async function analyseOutfit(
  imageUrl: string
): Promise<{ data?: OutfitAnalysis; error?: string }> {
  if (!imageUrl) return { error: 'No image URL provided' }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY not configured' }

  try {
    const safeUrl = capCloudinaryImage(imageUrl)

    // Fetch image server-side and convert to base64 so any URL works
    const imgRes = await fetch(safeUrl)
    if (!imgRes.ok) return { error: `Could not fetch image (${imgRes.status})` }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const mediaType = allowedTypes.find((t) => contentType.includes(t)) ?? 'image/jpeg'

    const arrayBuffer = await imgRes.arrayBuffer()
    // Hard cap — Claude vision rejects base64 images over 5MB.
    const MAX_BYTES = 5 * 1024 * 1024 - 256 * 1024 // leave ~250KB of safety margin
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return {
        error: `Image is too large (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)} MB). Re-upload it to Cloudinary — the server will auto-resize it.`,
      }
    }
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
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

    // Strip any markdown code fences Claude might add despite instructions
    let raw = textBlock.text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim()
    }

    const data = JSON.parse(raw) as OutfitAnalysis
    return { data }
  } catch (err: unknown) {
    console.error('[analyseOutfit]', err)
    if (err instanceof SyntaxError) {
      return { error: 'AI returned invalid JSON — try again' }
    }
    return { error: err instanceof Error ? err.message : 'Analysis failed' }
  }
}
