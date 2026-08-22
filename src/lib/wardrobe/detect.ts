// Stage 1 — DETECT. Pure: the prompt, the strict JSON schema the Responses API
// is asked to fill, and the normaliser that maps the model's answer onto MYRA's
// item taxonomy. The network call lives in openai.ts.
//
// Prompt structure follows the reference import-clothes skill (one record per
// distinct wearable item, tight 0-1000 bounding box, ignore body and scene),
// with MYRA's own vocabulary substituted for its five coarse "parts".

import type { ItemType, ColourFamily } from '@/types/database'
import { slotForItemType } from '@/lib/composer'
import type { DetectedGarment } from './types'

export const ITEM_TYPES: ItemType[] = [
  'coat', 'trench', 'jacket', 'blazer', 'gilet', 'cape',
  'shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit',
  'trousers', 'jeans', 'shorts', 'skirt',
  'mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress',
  'boot', 'heel', 'flat', 'sneaker', 'mule', 'sandal',
  'tote', 'shoulder_bag', 'clutch', 'crossbody', 'structured_bag',
  'belt', 'scarf', 'necklace', 'earrings', 'bracelet', 'ring', 'brooch',
  'hair_accessory', 'hat', 'gloves', 'sunglasses',
]

export const COLOUR_FAMILIES: ColourFamily[] = [
  'white', 'cream', 'black', 'grey', 'navy', 'brown', 'camel', 'green', 'burgundy',
  'red', 'blue', 'pink', 'yellow', 'orange', 'purple', 'multicolour',
]

const PATTERNS = ['none', 'tonal', 'subtle', 'graphic', 'statement'] as const

export const DETECT_PROMPT = `You are MYRA's wardrobe intake. Identify every distinct wearable garment, shoe, bag or piece of jewellery visible in this photo. The photo may show ONE item on its own (flat lay, hanger, close-up) or a PERSON wearing several items — return one record per actual wearable item that belongs in a wardrobe. Ignore the person's body, hair, skin, and any non-wearable background object. Ignore underlayers you cannot actually see enough of to describe.

For each item give:
- name: a concise specific name, lower case, colour + material + garment ("navy linen shirt", "black leather ankle boot")
- item_type: the single closest value from the allowed list
- colour_family: the dominant colour's family from the allowed list, or null if you genuinely cannot tell
- colour_hex: the dominant colour as #RRGGBB, or null
- material_guess: the most likely primary material from the visible texture ("linen", "wool", "cotton poplin", "leather", "silk", "denim"), or null
- pattern: none | tonal | subtle | graphic | statement
- silhouette: a short phrase on fit, length and shape ("relaxed, hip-length, dropped shoulder"), or null for jewellery/bags
- description: ONE sentence describing exactly what is visibly there — construction, closure, neckline, sleeve, hem. Describe only what you can see; do not invent logos, text or hardware.
- brand_hint: the brand name ONLY if a label, logo or monogram is clearly legible, else null
- bounding_box: a tight box around only this item, integers normalised to a 1000x1000 image: x,y top-left then width,height. Boxes may overlap when garments overlap.
- confidence: 0-1, how sure you are this is the item_type you chose and that the box isolates it.

Return at most 8 items. If no wearable item is visible, return an empty list.`

export const DETECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      minItems: 0,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          item_type: { type: 'string', enum: ITEM_TYPES },
          colour_family: { anyOf: [{ type: 'string', enum: COLOUR_FAMILIES }, { type: 'null' }] },
          colour_hex: { anyOf: [{ type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }, { type: 'null' }] },
          material_guess: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          pattern: { type: 'string', enum: [...PATTERNS] },
          silhouette: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          description: { type: 'string' },
          brand_hint: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          bounding_box: {
            type: 'object',
            additionalProperties: false,
            properties: {
              x: { type: 'integer', minimum: 0, maximum: 999 },
              y: { type: 'integer', minimum: 0, maximum: 999 },
              width: { type: 'integer', minimum: 1, maximum: 1000 },
              height: { type: 'integer', minimum: 1, maximum: 1000 },
            },
            required: ['x', 'y', 'width', 'height'],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: [
          'name', 'item_type', 'colour_family', 'colour_hex', 'material_guess', 'pattern',
          'silhouette', 'description', 'brand_hint', 'bounding_box', 'confidence',
        ],
      },
    },
  },
  required: ['items'],
} as const

const HEX = /^#[0-9a-f]{6}$/i

export function normaliseBoundingBox(raw: any): DetectedGarment['bounding_box'] {
  const n = (k: string, fb: number) => (Number.isFinite(Number(raw?.[k])) ? Math.round(Number(raw[k])) : fb)
  const x = Math.max(0, Math.min(999, n('x', 0)))
  const y = Math.max(0, Math.min(999, n('y', 0)))
  const width = Math.max(1, Math.min(1000 - x, n('width', 1000 - x)))
  const height = Math.max(1, Math.min(1000 - y, n('height', 1000 - y)))
  return { x, y, width, height }
}

/** Coerce one raw detector record onto the taxonomy; null when it isn't usable. */
export function normaliseDetected(raw: any): DetectedGarment | null {
  if (!raw || typeof raw !== 'object') return null
  const item_type = ITEM_TYPES.includes(raw.item_type) ? (raw.item_type as ItemType) : null
  if (!item_type) return null
  const colour_family = COLOUR_FAMILIES.includes(raw.colour_family) ? (raw.colour_family as ColourFamily) : null
  const pattern = (PATTERNS as readonly string[]).includes(raw.pattern) ? raw.pattern : 'none'
  const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const conf = Number(raw.confidence)
  return {
    name: str(raw.name, 120) ?? item_type.replace(/_/g, ' '),
    item_type,
    category: slotForItemType(item_type),
    colour_family,
    colour_hex: typeof raw.colour_hex === 'string' && HEX.test(raw.colour_hex) ? raw.colour_hex.toLowerCase() : null,
    material_guess: str(raw.material_guess, 80),
    pattern,
    silhouette: str(raw.silhouette, 160),
    description: str(raw.description, 400) ?? '',
    brand_hint: str(raw.brand_hint, 80),
    bounding_box: normaliseBoundingBox(raw.bounding_box),
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
  }
}

export function normaliseDetectedList(items: unknown, cap = 8): DetectedGarment[] {
  if (!Array.isArray(items)) return []
  return items.map(normaliseDetected).filter((g): g is DetectedGarment => g != null).slice(0, cap)
}

// Title-case product name from the detector's lower-case name, e.g.
// "navy linen shirt" → "Navy Linen Shirt".
export function productNameFromDetected(g: Pick<DetectedGarment, 'name' | 'item_type'>): string {
  const base = (g.name || g.item_type.replace(/_/g, ' ')).trim()
  return base.split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ').slice(0, 120)
}
