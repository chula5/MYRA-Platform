import 'server-only'

// Is there an outfit in this photo? Asked BEFORE an archival photo is kept, so
// landscapes, food, rooms and face-only selfies never land in her looks. One
// small Haiku vision call on a 512px copy (a fraction of a penny). When the
// check cannot run, the photo is kept: better one landscape too many than a
// real look lost.

import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'

const MODEL = 'claude-haiku-4-5'

const PROMPT =
  'Does this photo show a person wearing an outfit where the clothes can be seen — at least from the shoulders to the hips? ' +
  'Answer "no" for landscapes, food, rooms, objects, animals, or a close-up of a face. Reply with only "yes" or "no".'

async function ask(content: Anthropic.ImageBlockParam['source']): Promise<boolean> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return true
  try {
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 5,
      messages: [{ role: 'user', content: [{ type: 'image', source: content }, { type: 'text', text: PROMPT }] }],
    })
    const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    return !/^\s*no\b/i.test(block?.text ?? '')
  } catch {
    return true
  }
}

/** From the photo's bytes (an upload or an Instagram image). */
export async function photoHasOutfit(bytes: Buffer): Promise<boolean> {
  let small: Buffer
  try {
    small = await sharp(bytes).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
  } catch {
    return true
  }
  return ask({ type: 'base64', media_type: 'image/jpeg', data: small.toString('base64') })
}

/** From a URL (photos already kept, checked after the fact). */
export async function photoUrlHasOutfit(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return true
    return photoHasOutfit(Buffer.from(await res.arrayBuffer()))
  } catch {
    return true
  }
}
