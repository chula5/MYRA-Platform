// NOT a 'use server' module, on purpose: every export of a 'use server' file is
// callable by anyone from the browser, and these run without an admin session
// (cron, src/lib pipelines, keep actions). Browser-facing callers must go
// through an admin-gated 'use server' wrapper. Don't add 'use server' here.

// Item type from the product image, for pieces whose own words name nothing.
//
// Most pieces are named: "Linen Shirt", "Barrel-Leg Pant", and the rules in
// lib/brand-watch read those for free. Some are not. AFLALO sends no
// product_type at all — the literal string "undefined" — and its "Racquet
// String" pieces are bracelets made from tennis string, which the shop itself
// files under Jewelry. No rule can read that from the name, and an untyped
// piece cannot be kept: it sat in the queue for ever while ACCEPT did nothing.
//
// Where the words are silent the picture is the evidence: one cheap read per
// otherwise-unnamable piece, and only where the text has already failed. The
// reader and its cost are in lib/openai-vision, shared with the colour reads.

import { readWordFromImage } from '@/lib/openai-vision'
import type { ItemType } from '@/types/database'

/**
 * The whole taxonomy, so a confident answer can be filed without a mapping
 * table. Held in step with the item_type enum by the type itself.
 */
export const ITEM_TYPE_VALUES: ItemType[] = [
  'coat', 'trench', 'jacket', 'blazer', 'gilet', 'cape',
  'shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit',
  'trousers', 'jeans', 'shorts', 'skirt',
  'mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress',
  'boot', 'heel', 'flat', 'sneaker', 'mule', 'sandal',
  'tote', 'shoulder_bag', 'clutch', 'crossbody', 'structured_bag',
  'belt', 'scarf', 'necklace', 'earrings', 'bracelet', 'ring', 'brooch',
  'hair_accessory', 'hat', 'gloves', 'sunglasses',
]

/**
 * The plain word for a label the taxonomy spells differently. Only ever maps a
 * word onto ITS OWN label — never a guess between two — so the only debatable
 * entry is "bag", and structured_bag is the safe generic it already is.
 */
const ALIASES: Record<string, ItemType> = {
  tshirt: 't-shirt', tee: 't-shirt',
  jumper: 'knitwear', sweater: 'knitwear', cardigan: 'knitwear', pullover: 'knitwear', knit: 'knitwear',
  dress: 'midi_dress',
  bag: 'structured_bag', handbag: 'structured_bag',
  pants: 'trousers', pant: 'trousers', trouser: 'trousers',
  short: 'shorts',
  pumps: 'heel', heels: 'heel', stiletto: 'heel', stilettos: 'heel',
  sneakers: 'sneaker', trainer: 'sneaker', trainers: 'sneaker', runners: 'sneaker',
  sandals: 'sandal', mules: 'mule', flats: 'flat', loafers: 'flat',
  earring: 'earrings', glove: 'gloves',
}

/** The model's answer as a taxonomy value, or null when it is not one of them. */
export function asItemType(answer: string): ItemType | null {
  const raw = String(answer ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')
  if (!raw) return null
  const byLabel = ITEM_TYPE_VALUES.find((t) => t.replace(/[^a-z]/g, '') === raw)
  if (byLabel) return byLabel
  return ALIASES[raw] ?? null
}

const PROMPT = `What single kind of item is this?

Answer with exactly one word from this list, and nothing else:
${ITEM_TYPE_VALUES.join(', ')}

How to decide, in order:
1. Name the garment or accessory the shot is OF. If several pieces are shown,
   name the one the picture is about.
2. Judge what it is made AS, not what it is made FROM. A bracelet woven out of
   tennis racquet string is a bracelet; jewellery is the piece of jewellery it
   is, and never "string".
3. If the shot is a fabric detail, an interior, or you genuinely cannot tell,
   answer "unclear". Do not guess: a wrong type files the piece as the wrong
   thing, which is worse than leaving it unnamed.`

export async function classifyItemTypeFromImage(imageUrl: string): Promise<{ itemType: ItemType | null; error?: string }> {
  try {
    const { word, error } = await readWordFromImage(imageUrl, PROMPT)
    if (error) return { itemType: null, error }
    if (/unclear|unknown|cannot|can't/i.test(word)) return { itemType: null }
    return { itemType: asItemType(word) }
  } catch (err) {
    return { itemType: null, error: err instanceof Error ? err.message : 'vision failed' }
  }
}
