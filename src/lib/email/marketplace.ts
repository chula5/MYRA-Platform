// Purchases read off a marketplace she is signed into (Vinted today), turned
// into the same finds her order emails produce: pending, reviewed in the
// Dressing Room, photos laid out on white before she sees them.
//
// A marketplace listing line is written by the seller, not a shop, so the
// title carries the brand, the size and the state of the order in one string.
// Haiku reads one batch of lines into fields; no images are sent.

import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase-server'
import { cutoutPendingSnapshots, keepFindPhoto } from './connections'
import { sameFind, mergeFind, isGenericName } from './purchase-core'

export interface MarketplaceOrder {
  key: string
  order_id: string | null
  product_url: string | null
  product_name: string
  image_url: string | null
  /** The card's whole line of text: title, size, price, status. */
  line: string
  price: number | null
  currency: string | null
}

export interface MarketplaceRead {
  product_name: string
  brand_name: string | null
  colour: string | null
  size: string | null
  price: number | null
  currency: string | null
  order_date: string | null
  /** false for a cancelled or refunded order, or one she sold rather than bought. */
  is_purchase: boolean
  returned: boolean
}

const MODEL = 'claude-haiku-4-5'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['orders'],
  properties: {
    orders: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'product_name', 'brand_name', 'colour', 'size', 'price', 'currency', 'order_date', 'is_purchase', 'returned'],
        properties: {
          index: { type: 'integer' },
          product_name: { type: 'string' },
          brand_name: { type: ['string', 'null'] },
          colour: { type: ['string', 'null'] },
          size: { type: ['string', 'null'] },
          price: { type: ['number', 'null'] },
          currency: { type: ['string', 'null'] },
          order_date: { type: ['string', 'null'] },
          is_purchase: { type: 'boolean' },
          returned: { type: 'boolean' },
        },
      },
    },
  },
} as const

/** Read seller-written order lines into fields. One call per 60 orders. */
export async function readMarketplaceLines(orders: MarketplaceOrder[]): Promise<Map<number, MarketplaceRead>> {
  const out = new Map<number, MarketplaceRead>()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return out
  const client = new Anthropic({ apiKey })
  for (let i = 0; i < orders.length; i += 60) {
    const batch = orders.slice(i, i + 60)
    const list = batch.map((o, n) => `${i + n}. ${o.line}`).join('\n')
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{
          role: 'user',
          content: `These are rows from a woman's own orders page on Vinted, each written by the seller. Read each into fields.

- product_name: what the piece is, without the size, condition or seller notes ("Jigsaw drop waist midi black skirt size 8" -> "Jigsaw drop waist midi black skirt").
- brand_name: the brand in the title, when there is one.
- colour and size as written; price as a number with its 3-letter currency.
- order_date as YYYY-MM-DD when the row shows one, else null.
- is_purchase: false when the row is something she SOLD, or an order that was cancelled or never completed.
- returned: true when the row says returned, refunded or cancelled.

${list}`,
        }],
      } as any) as Anthropic.Message
      const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
      for (const r of (block ? JSON.parse(block.text).orders ?? [] : []) as MarketplaceRead[] & { index: number }[]) {
        if (typeof (r as any).index === 'number') out.set((r as any).index, r)
      }
    } catch {
      // Unread rows fall back to the raw title below.
    }
  }
  return out
}

/**
 * Save what she bought there as pending finds: skip what she sold, mark what
 * went back, merge with a piece already found in her email, and lay each
 * seller snapshot out on white.
 */
export async function saveMarketplacePurchases(
  memberId: string, retailer: string, orders: MarketplaceOrder[],
): Promise<{ added: number; merged: number; skipped: number }> {
  const a = createAdminClient() as any
  const read = await readMarketplaceLines(orders)

  const { data: existing } = await a.from('email_purchase_find')
    .select('find_id, retailer, order_id, order_date, product_name, brand_name, colour, size, price, currency, image_url, product_url, status')
    .eq('member_id', memberId).limit(1000)
  const finds = (existing ?? []) as any[]

  let added = 0
  let merged = 0
  let skipped = 0

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i]
    const r = read.get(i)
    if (r && !r.is_purchase) { skipped++; continue }
    const name = (r?.product_name && !isGenericName(r.product_name) ? r.product_name : o.product_name).trim()
    if (!name || isGenericName(name)) { skipped++; continue }
    const incoming = {
      retailer,
      order_id: o.order_id,
      order_date: r?.order_date ?? null,
      product_name: name,
      brand_name: r?.brand_name ?? null,
      colour: r?.colour ?? null,
      size: r?.size ?? null,
      price: r?.price ?? o.price,
      currency: r?.currency ?? o.currency ?? 'GBP',
      image_url: o.image_url,
      product_url: o.product_url,
    }

    // Already found in her email (Vinted's emails name the same listing).
    const match = finds.find((f) => sameFind(f, incoming, 120))
    if (match) {
      const patch: any = mergeFind(match, incoming)
      if (o.image_url && !match.image_url) patch.image_url = await keepFindPhoto(o.image_url, memberId, match.find_id, retailer)
      if (Object.keys(patch).length) {
        Object.assign(match, patch)
        await a.from('email_purchase_find').update(patch).eq('find_id', match.find_id)
        merged++
      } else {
        skipped++
      }
      continue
    }

    const image = o.image_url ? await keepFindPhoto(o.image_url, memberId, o.key, retailer) : null
    const { data: inserted } = await a.from('email_purchase_find').upsert({
      member_id: memberId,
      connection_id: null,
      message_id: `vinted:${o.key}`,
      find_key: `vinted|${o.key}`,
      ...incoming,
      image_url: image,
      status: r?.returned ? 'discarded' : 'pending',
      error: r?.returned ? 'Returned' : null,
    }, { onConflict: 'member_id,find_key', ignoreDuplicates: true }).select('find_id, retailer, order_id, order_date, product_name, brand_name, colour, size, price, currency, image_url, product_url, status')
    const row = ((inserted ?? []) as any[])[0]
    if (row) { finds.push(row); added++ } else { skipped++ }
  }

  // Anything that came in as a seller's snapshot is laid out on white.
  await cutoutPendingSnapshots(memberId).catch(() => 0)
  return { added, merged, skipped }
}
