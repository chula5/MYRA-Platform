// Reading one order email: Claude Haiku pulls out the retailer, date, order id
// and each wearable piece. Only messages that pass looksLikeOrderEmail get here,
// so a year of inbox is a few hundred cheap calls, not thousands. Server only.

import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { emailForExtraction, parseExtraction, type MailMessage, type PurchaseExtraction } from './purchase-core'

const MODEL = 'claude-haiku-4-5'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_purchase', 'retailer', 'order_date', 'order_id', 'items'],
  properties: {
    is_purchase: { type: 'boolean' },
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

const prompt = (email: string, images: string[], links: string[]) => `This is an email from a woman's inbox. Decide whether it confirms something she BOUGHT (an order confirmation, receipt or dispatch/delivery notice) and, if so, list each item in the order.

Rules:
- is_purchase is false for marketing, newsletters, abandoned baskets, returns, refunds, cancellations and account emails.
- category: clothing, shoes, bag, jewellery or accessory for anything she would wear or carry; "other" for everything else (beauty, homeware, food, tech, gift cards).
- product_name exactly as the email names it. brand_name when the email says it (the retailer is not always the brand). colour and size as shown.
- price: the item's price as a number, currency as a 3-letter code (GBP for £).
- image_url: the product photo for that item, chosen from the image URLs below, or null. product_url: the item's product page from the links below, or null.
- order_date as YYYY-MM-DD when shown, else the email date.

Image URLs in the email:
${images.join('\n') || '(none)'}

Links in the email:
${links.join('\n') || '(none)'}

The email:
${email}`

export async function extractPurchase(m: MailMessage): Promise<{ extraction: PurchaseExtraction; error?: string }> {
  const none = parseExtraction(null)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { extraction: none, error: 'ANTHROPIC_API_KEY not configured' }
  const { text, images, links } = emailForExtraction(m)
  try {
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: prompt(text, images, links) }],
    } as any) as Anthropic.Message
    const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!block) return { extraction: none, error: 'No answer from the model' }
    const extraction = parseExtraction(JSON.parse(block.text))
    // The email's own date stands in when the order date is not written.
    if (extraction.is_purchase && !extraction.order_date && m.date) {
      const d = new Date(m.date)
      if (!Number.isNaN(d.getTime())) extraction.order_date = d.toISOString().slice(0, 10)
    }
    return { extraction }
  } catch (err) {
    return { extraction: none, error: err instanceof Error ? err.message : 'Extraction failed' }
  }
}
