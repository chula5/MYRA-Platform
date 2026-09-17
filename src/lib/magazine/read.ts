// MYRA MAGAZINE — the newsletters she already subscribes to, read for her.
//
// She gets the same emails everyone gets: brand drops, edits, Substacks. MYRA
// opens them so she does not have to, keeps only the pieces that are HER —
// her shapes, her palette, her house style — and lays them out as a page she
// can read in a minute. The email is never stored, only the pieces.
//
// Cheap by design: senders and subjects are sorted in bulk first (one call per
// ~150), then only the newsletters that survive are opened and read.

import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { emailForExtraction, type EmailImage, type MailMessage } from '@/lib/email/purchase-core'
import { looksLikeNewsletter, parseMagazineRead, type MagazinePick, type MagazineRead } from './core'

export { looksLikeNewsletter, parseMagazineRead }
export type { MagazinePick, MagazineRead }

const MODEL = 'claude-haiku-4-5'

const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['keep'],
  properties: { keep: { type: 'array', items: { type: 'integer' } } },
} as const

/**
 * Which of these are fashion newsletters worth opening — one call per ~150
 * senders and subjects. Fails open: a failed call keeps its batch.
 */
export async function triageNewsletters(rows: { id: string; from: string; subject: string }[]): Promise<Set<string>> {
  const keep = new Set<string>()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !rows.length) { rows.forEach((r) => keep.add(r.id)); return keep }
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
          content: `Below are the sender and subject of emails in a woman's inbox. Return the numbers of the ones that are FASHION READING she subscribes to: a brand's newsletter or new-season drop, a shop's edit, a fashion publication or Substack, a resale or vintage newsletter.

Leave out: order and delivery emails, receipts, account and security mail, work email, personal mail, news and politics, food, travel, tech, fitness, beauty-only, finance, and anything that is not about clothes, shoes, bags or jewellery.

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

const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_newsletter', 'publication', 'headline', 'hero_image', 'picks'],
  properties: {
    is_newsletter: { type: 'boolean' },
    publication: { type: ['string', 'null'] },
    headline: { type: ['string', 'null'] },
    hero_image: { type: ['string', 'null'] },
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'brand', 'price', 'currency', 'image_url', 'url', 'why'],
        properties: {
          name: { type: 'string' },
          brand: { type: ['string', 'null'] },
          price: { type: ['number', 'null'] },
          currency: { type: ['string', 'null'] },
          image_url: { type: ['string', 'null'] },
          url: { type: ['string', 'null'] },
          why: { type: 'string' },
        },
      },
    },
  },
} as const

const prompt = (client: string, email: string, images: EmailImage[], links: string[]) => `You are MYRA, her private stylist, reading one newsletter FOR her so she does not have to.

This is the client you are reading for:
${client}

Pick AT MOST 4 pieces from this email that are genuinely hers — her shapes, her colours, her brands, her house style — and skip the rest. Fewer is better: 0 picks is the right answer for a newsletter with nothing for her.

Rules:
- Only clothes, shoes, bags and jewellery she could buy. No beauty, homeware, competitions, events, discount codes or gift cards.
- name: the piece as the email names it. brand: the label. price as a number with a 3-letter currency when shown.
- image_url: that piece's photo, from the image URLs below. url: its link, from the links below. Leave either null rather than guessing.
- why: at most 8 words, plain and specific about HER ("your neckline, in your navy"). Never "trendy" or "versatile". No exclamation marks.
- publication: whose newsletter this is. headline: what the issue is about, at most 8 words.
- hero_image: the issue's main picture, from the image URLs below, or null.
- is_newsletter: false if this is not fashion reading at all (an order, an account email, news, anything else).

Image URLs in the email (with alt text):
${images.map((i) => (i.alt ? `${i.url}  [alt: ${i.alt}]` : i.url)).join('\n') || '(none)'}

Links in the email:
${links.join('\n') || '(none)'}

The email:
${email}`

/** Read one newsletter for one client. */
export async function readNewsletter(m: MailMessage, clientDescription: string): Promise<MagazineRead> {
  const none = parseMagazineRead(null)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return none
  const { text, imageAlts, links } = emailForExtraction(m, 9_000)
  try {
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      output_config: { format: { type: 'json_schema', schema: READ_SCHEMA } },
      messages: [{ role: 'user', content: prompt(clientDescription, text, imageAlts, links) }],
    } as any) as Anthropic.Message
    const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!block) return none
    const read = parseMagazineRead(JSON.parse(block.text))
    // A newsletter with nothing for her still counts as read — it just has no page.
    if (!read.publication) read.publication = (m.from ?? '').replace(/<[^>]*>/, '').replace(/"/g, '').trim() || 'Newsletter'
    return read
  } catch {
    return none
  }
}
