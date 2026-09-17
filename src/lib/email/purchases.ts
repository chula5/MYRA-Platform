// Reading one order or return email: Claude Haiku pulls out the retailer, date,
// order id and each wearable piece — bought, or sent back. Only messages whose
// subject passes emailKind get here, so a year of inbox is a few hundred cheap
// calls, not thousands. Server only.

import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { emailForExtraction, matchImagesByAlt, nameAppearsIn, parseExtraction, type EmailImage, type MailMessage, type PurchaseExtraction } from './purchase-core'

const MODEL = 'claude-haiku-4-5'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'whole_order', 'return_confirmed', 'retailer', 'order_date', 'order_id', 'items'],
  properties: {
    kind: { type: 'string', enum: ['purchase', 'return', 'other'] },
    whole_order: { type: 'boolean' },
    return_confirmed: { type: 'boolean' },
    retailer: { type: ['string', 'null'] },
    order_date: { type: ['string', 'null'] },
    order_id: { type: ['string', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['product_name', 'brand_name', 'colour', 'size', 'price', 'currency', 'image_url', 'product_url', 'category'],
        properties: {
          product_name: { type: 'string' },
          brand_name: { type: ['string', 'null'] },
          colour: { type: ['string', 'null'] },
          size: { type: ['string', 'null'] },
          price: { type: ['number', 'null'] },
          currency: { type: ['string', 'null'] },
          image_url: { type: ['string', 'null'] },
          product_url: { type: ['string', 'null'] },
          category: { type: 'string', enum: ['clothing', 'shoes', 'bag', 'jewellery', 'accessory', 'other'] },
        },
      },
    },
  },
} as const

const prompt = (email: string, images: EmailImage[], links: string[]) => `This is an email from a woman's inbox. Decide what it is:
- "purchase": it confirms something she BOUGHT — an order confirmation, receipt, payment receipt, dispatch or delivery notice.
- "return": she sent something back, was refunded, or the order (or part of it) was cancelled.
- "other": marketing, newsletters, abandoned baskets, account emails, or anything else.

Then list each item the email is about (bought, or returned/refunded/cancelled).

Rules:
- category: clothing, shoes, bag, jewellery or accessory ONLY for something she would wear or carry as part of an outfit (accessory = belts, scarves, hats, gloves, sunglasses, hair accessories, watches). "other" for everything else — beauty and makeup tools (mirrors, brushes), homeware, food, tech, phone cases, gift cards, multi-packs of small goods.
- product_name exactly as the email names it. Never invent a generic name like "Item" — if the email does not name the piece, use what the photo's alt text or the email says it is, else leave the item out.
- brand_name when the email says it (the retailer is not always the brand — on Vinted, eBay or Depop the brand is in the listing title). colour and size as shown.
- price: the item's price as a number, currency as a 3-letter code (GBP for £).
- image_url: the product photo for that item, chosen from the image URLs below — the alt text usually names the piece. null if none shows the piece (logos and icons are not product photos). product_url: the item's product page from the links below, or null.
- retailer: the shop. On a payment receipt (PayPal, Klarna, Clearpay) it is the shop that was paid.
- order_id when shown. order_date as YYYY-MM-DD when shown, else the email date.
- whole_order: true only for a return/refund/cancellation of the entire order.
- return_confirmed (returns only): true when the return is DONE — a refund issued, the shop/seller received it back, or the order was cancelled. false when a return is only requested, a label or instructions are sent, or she must still send it (e.g. "return your order by 23 Sep, or else you'll keep it"). false for purchases.

Image URLs in the email (with alt text):
${images.map((i) => (i.alt ? `${i.url}  [alt: ${i.alt}]` : i.url)).join('\n') || '(none)'}

Links in the email:
${links.join('\n') || '(none)'}

The email:
${email}`

export async function extractPurchase(m: MailMessage): Promise<{ extraction: PurchaseExtraction; error?: string }> {
  const none = parseExtraction(null)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { extraction: none, error: 'ANTHROPIC_API_KEY not configured' }
  const { text, imageAlts, links } = emailForExtraction(m, 7_000)
  try {
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: prompt(text, imageAlts, links) }],
    } as any) as Anthropic.Message
    const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!block) return { extraction: none, error: 'No answer from the model' }
    const extraction = parseExtraction(JSON.parse(block.text))
    extraction.items = matchImagesByAlt(extraction.items, imageAlts)
      // A name the email never says was made up — mark it unnamed so the photo names it.
      .map((item) => (nameAppearsIn(item.product_name, text, imageAlts) ? item : { ...item, product_name: 'Item' }))
    // The email's own date stands in when the order date is not written.
    if (extraction.kind !== 'other' && !extraction.order_date && m.date) {
      const d = new Date(m.date)
      if (!Number.isNaN(d.getTime())) extraction.order_date = d.toISOString().slice(0, 10)
    }
    return { extraction }
  } catch (err) {
    return { extraction: none, error: err instanceof Error ? err.message : 'Extraction failed' }
  }
}

/** A short name for a piece from its product photo ("Cream lace midi dress") — for emails that never name it. */
export async function namePieceFromPhoto(imageUrl: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  try {
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 40,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: 'Name this clothing product in 2 to 5 words, colour first, the way a shop would list it (e.g. "Cream lace midi dress"). Reply with the name only.' },
        ],
      }],
    })
    const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    const name = block?.text.trim().replace(/^["']|["'.]$/g, '') ?? ''
    return name && name.length <= 60 ? name.charAt(0).toUpperCase() + name.slice(1) : null
  } catch {
    return null
  }
}

const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['keep'],
  properties: { keep: { type: 'array', items: { type: 'integer' } } },
} as const

/**
 * Sort a year of order-looking emails by sender and subject alone, ~150 per
 * call: which could be about clothes, shoes, bags, jewellery or wearable
 * accessories she bought or sent back. Only those are opened and read. When a
 * call fails, its emails are kept — better a read too many than a purchase missed.
 */
export async function triageBySubject(rows: { id: string; from: string; subject: string }[]): Promise<Set<string>> {
  const keep = new Set<string>()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { rows.forEach((r) => keep.add(r.id)); return keep }
  const client = new Anthropic({ apiKey })
  for (let i = 0; i < rows.length; i += 150) {
    const batch = rows.slice(i, i + 150)
    const list = batch.map((r, n) => `${n}. ${r.from.replace(/<[^>]*>/, '').trim() || r.from} — ${r.subject}`).join('\n')
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        output_config: { format: { type: 'json_schema', schema: TRIAGE_SCHEMA } },
        messages: [{
          role: 'user',
          content: `Below are the sender and subject of emails from a woman's inbox. Return the numbers of the emails that could be an order confirmation, receipt, dispatch/delivery notice, return or refund for CLOTHING, SHOES, BAGS, JEWELLERY or wearable ACCESSORIES she bought.

Keep: fashion brands and shops, department stores, marketplaces and resale (Vinted, eBay, Depop, Vestiaire, Amazon, ASOS, John Lewis...) — when unsure whether a shop sells clothes, keep it. Keep every update about a specific order or item from such a shop, even delays and failed deliveries ("Order update for Black vest top", "Your Flannels parcel could not be delivered" — a carrier naming a fashion shop counts).
Leave out: food and takeaway, groceries, travel, tickets, parcel carriers, payment processors, software and subscriptions, gyms, utilities, banks, beauty and skincare, homeware, cards and gifts, news, and marketing.

${list}`,
        }],
      } as any) as Anthropic.Message
      const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
      const nums: number[] = block ? (JSON.parse(block.text).keep ?? []) : []
      for (const n of nums) if (batch[n]) keep.add(batch[n].id)
    } catch {
      batch.forEach((r) => keep.add(r.id))
    }
  }
  return keep
}
