// TALKING TO A STYLIST.
//
// One stylist, one member, one turn. The stylist answers in her own voice
// (her brief, her voice notes) about THIS member (her MYRA brief), and when
// she needs pieces or outfits she asks MYRA for them — the same composer,
// the same gates, the same look check as every other room, seen through her
// own eye and her own nevers. She never invents a piece: everything she shows
// came back from a tool.
//
// Sciura, the chief, has one tool: route. She reads the member and says who
// should dress her, in the reason line the router wrote — nothing generated
// on top of it, so she does not waffle.

import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { Stylist } from '@/lib/stylist-store'
import { briefText } from '@/lib/stylist-brief'
import { memberMemory } from '@/lib/member-memory'
import { outfitsFor, outfitsAroundPiece, findItems, type OutfitAnswer, type ItemAnswer } from '@/lib/mcp/myra-tools'
import { routeMember } from '@/lib/chief-stylist'
import type { LookItem } from '@/lib/pilot-stylist'
import { CLIENT_OCCASIONS } from '@/lib/client-occasions'

export interface ChatLook {
  look_id: string
  image_url: null
  items: LookItem[]
  why: string
  occasion_label?: string
}

export interface ChatTurn {
  role: 'member' | 'stylist'
  body: string
  looks?: ChatLook[]
  items?: ItemAnswer[]
}

export interface ChatReply {
  body: string
  looks: ChatLook[]
  items: ItemAnswer[]
  error?: string
}

const MODEL = 'claude-sonnet-4-6'
const MAX_ROUNDS = 4
const MEMORY_CHARS = 3000

const OCCASION_IDS = CLIENT_OCCASIONS.map((o) => o.id)

function toolsFor(stylist: Stylist): Anthropic.Messages.Tool[] {
  if (stylist.role === 'chief') {
    return [{
      name: 'route',
      description: 'Read what she has shown MYRA — her pictures, her dressing room, her brands — and decide which stylist should dress her, with a blend and the reason.',
      input_schema: { type: 'object', properties: {} },
    }]
  }
  return [
    {
      name: 'find_outfits',
      description: 'Compose whole outfits for her for an occasion, in her size, through your eye and your nevers. Use for "what do I wear to…", "dress me for…", "an outfit for…".',
      input_schema: {
        type: 'object',
        properties: {
          occasion: { type: 'string', enum: OCCASION_IDS, description: 'MYRA occasion id; omit to read it from words' },
          words: { type: 'string', description: 'What she said, verbatim' },
          count: { type: 'integer', minimum: 1, maximum: 4 },
        },
        required: ['words'],
      },
    },
    {
      name: 'find_items',
      description: 'Find single pieces in her size that match words — a kind of piece, a colour, a material, a brand — through your eye. Use for "find me a…", "show me…", "do you have…".',
      input_schema: {
        type: 'object',
        properties: {
          words: { type: 'string', description: 'What to look for, e.g. "camel wool coat"' },
          brand: { type: 'string', description: 'Limit to one brand' },
          type: { type: 'string', description: 'Limit to a kind of piece, e.g. "coat", "loafer"' },
          count: { type: 'integer', minimum: 1, maximum: 12 },
        },
        required: ['words'],
      },
    },
    {
      name: 'style_a_piece',
      description: 'Build outfits around one piece she owns or has saved, named in words. Use for "style my…", "what goes with my…".',
      input_schema: { type: 'object', properties: { piece: { type: 'string' } }, required: ['piece'] },
    },
  ]
}

function systemFor(stylist: Stylist, memberName: string, memory: string): string {
  const b = stylist.brief
  const who = b.public_name || stylist.name
  const persona = stylist.role === 'chief'
    ? `You are ${who}, MYRA's chief stylist. ${b.tagline}. You style nothing yourself: you decide which of the house's stylists should dress a member, and you say so in one or two plain sentences. ${b.how_she_routes ?? ''} When she asks who should dress her, or anything about her style direction, call route and then answer with the router's reason in your own words — keep its facts exactly, add nothing it did not say. If she asks for actual outfits or pieces, tell her which stylist to ask and why in one line.`
    : `You are ${who}, a stylist at MYRA. Your brief: ${briefText(stylist.name, b)}${stylist.voice_notes ? ` Your voice: ${stylist.voice_notes}` : ''} You dress ${memberName} only in your own way — your signature pieces, your palette, your brands, and never anything on your never list. If she asks for something that breaks a never, say so in one line and offer what you would do instead.`
  return [
    persona,
    `About her, from MYRA: ${memory.slice(0, MEMORY_CHARS) || 'nothing yet.'}`,
    'How you speak: British English, sentence case, warm and exact, two or three short sentences at most, no bullet points unless she asks for a list, no exclamation marks, no emoji. Name a piece as brand — piece. Never describe a piece you did not get back from a tool; when a tool returns outfits or pieces, they are shown to her beside your words, so do not list them out — say why they are right in a sentence. If a tool returns nothing, say so plainly and ask one question that would help.',
  ].join('\n\n')
}

const text = (blocks: Anthropic.Messages.ContentBlock[]) =>
  blocks.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim()

const toChatLooks = (looks: OutfitAnswer[], prefix: string, occasionLabel?: string): ChatLook[] =>
  looks.filter((l) => l.items?.length).map((l, i) => ({
    look_id: `${prefix}-${i}`, image_url: null, items: l.items!, why: l.why, occasion_label: occasionLabel,
  }))

/** One turn of the conversation. */
export async function replyAsStylist(
  memberId: string,
  memberName: string,
  stylist: Stylist,
  history: ChatTurn[],
  message: string,
): Promise<ChatReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { body: '', looks: [], items: [], error: 'ANTHROPIC_API_KEY not configured' }
  const client = new Anthropic({ apiKey })
  const memory = await memberMemory(memberId).then((m) => m.text).catch(() => '')

  const messages: Anthropic.Messages.MessageParam[] = [
    ...history.slice(-12).map((t) => ({ role: (t.role === 'member' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.body || '…' })),
    { role: 'user', content: message },
  ]
  const looks: ChatLook[] = []
  const items: ItemAnswer[] = []
  const tools = toolsFor(stylist)
  const system = systemFor(stylist, memberName, memory)

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await client.messages.create({ model: MODEL, max_tokens: 1200, system, tools, messages })
      const uses = res.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use')
      if (!uses.length || res.stop_reason !== 'tool_use') {
        return { body: text(res.content) || 'I have nothing to add to that.', looks, items }
      }
      messages.push({ role: 'assistant', content: res.content })
      const results: Anthropic.Messages.ToolResultBlockParam[] = []
      for (const u of uses) {
        const out = await runTool(memberId, stylist, u.name, (u.input ?? {}) as Record<string, unknown>, looks, items, `${round}-${u.id}`)
        results.push({ type: 'tool_result', tool_use_id: u.id, content: out })
      }
      messages.push({ role: 'user', content: results })
    }
    return { body: 'Here is what I found.', looks, items }
  } catch (err) {
    console.error('[stylist-chat]', err)
    return { body: '', looks: [], items: [], error: 'The stylist could not answer just now' }
  }
}

async function runTool(
  memberId: string, stylist: Stylist, name: string, input: Record<string, unknown>,
  looks: ChatLook[], items: ItemAnswer[], key: string,
): Promise<string> {
  const through = stylist.role === 'chief' ? {} : { stylistId: stylist.stylist_id }
  if (name === 'route') {
    const r = await routeMember(memberId)
    if ('error' in r) return r.error
    return r.reason
  }
  if (name === 'find_outfits') {
    const r = await outfitsFor(memberId, {
      occasion: typeof input.occasion === 'string' ? input.occasion : null,
      words: String(input.words ?? ''), count: Number(input.count) || 3, ...through,
    })
    if (r.error) return r.error
    const got = toChatLooks(r.looks, `look-${key}`, r.occasionLabel)
    looks.push(...got)
    return got.length
      ? `${got.length} outfit(s) for ${r.occasionLabel}, shown to her:\n${got.map((l, i) => `${i + 1}. ${l.items.map((it) => `${it.brand} — ${it.product_name}${it.owned ? ' (hers)' : ''}`).join(', ')}. Why: ${l.why}`).join('\n')}`
      : 'No outfit passed the check for that.'
  }
  if (name === 'find_items') {
    const r = await findItems(memberId, {
      words: String(input.words ?? ''), brand: typeof input.brand === 'string' ? input.brand : null,
      type: typeof input.type === 'string' ? input.type : null, count: Number(input.count) || 8, ...through,
    })
    if (r.error) return r.error
    items.push(...r.items.filter((i) => !items.some((x) => x.item_id === i.item_id)))
    return r.items.length
      ? `${r.items.length} piece(s) shown to her${r.removed ? ` (${r.removed} removed by your nevers)` : ''}:\n${r.items.map((i) => `· ${i.brand} — ${i.name}${i.price_gbp != null ? ` £${Math.round(i.price_gbp)}` : ''}${i.owned ? ' (hers)' : ''}`).join('\n')}`
      : `Nothing in her size matches that${r.removed ? ` — ${r.removed} piece(s) were on your never list` : ''}.`
  }
  if (name === 'style_a_piece') {
    const r = await outfitsAroundPiece(memberId, String(input.piece ?? ''), through)
    if (r.error) return r.error
    const got = toChatLooks(r.looks, `piece-${key}`)
    looks.push(...got)
    return got.length
      ? `${got.length} outfit(s) around her ${r.piece}, shown to her:\n${got.map((l, i) => `${i + 1}. ${l.items.map((it) => `${it.brand} — ${it.product_name}`).join(', ')}`).join('\n')}`
      : `Nothing goes with her ${r.piece ?? 'piece'} right now.`
  }
  return `Unknown tool ${name}`
}
