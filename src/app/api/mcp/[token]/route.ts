import { NextRequest } from 'next/server'
import { resolveMirrorToken } from '@/lib/mirror/auth'
import { createAdminClient } from '@/lib/supabase-server'
import { hashAssistantToken } from '@/lib/mcp/link'
import {
  brandsFor, modelShotsFor, outfitsAroundPiece, outfitsFor, savedFor, savedIdsFor, savedPiecesFor, setPieceSaved, styleFor, wardrobeFor, type OutfitAnswer,
} from '@/lib/mcp/myra-tools'
import { SHOW_PICTURES, lookPicture, outfitToText, picturesOf } from '@/lib/mcp/outfit-text'
import { pictureBlocks } from '@/lib/mcp/pictures'
import { APP_CALLABLE_META, APP_HTML, APP_MIME, APP_RESOURCE, APP_TOOL_META, APP_URI, appPicture, appPiece, type AppLooks, type AppPieces } from '@/lib/mcp/app'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// MYRA, from inside an assistant.
//
// An MCP server over plain HTTP: the assistant POSTs JSON-RPC, MYRA answers.
// Her identity is the token in the path — the same signed member token the
// mirror extension uses — so a connector that only takes a URL still knows
// whose wardrobe it is asking about. Nothing here records a decision: an
// assistant may ask MYRA to style something, never to say she liked it.
//
// Add in Claude or ChatGPT as a custom connector:
//   https://www.myraassistant.co.uk/api/mcp/<her token>
//
// An outfit is a picture, not a list. A look's picture is the piece it was
// built around, worn — the outfit styled, as her feed shows it. Every tool
// that returns looks sends that picture twice: as a markdown image line under
// the look's heading, for the assistant to copy into its reply above the
// pieces, and as an image block beside the text, so the tool result itself
// shows the look and the assistant can see it. And since 2026-10-18 a third
// way, the one that looks like her feed: the result carries structuredContent
// and names the MYRA app (lib/mcp/app), so a host that draws MCP Apps —
// Claude, ChatGPT — shows each look styled with its pieces under it and a
// heart on each. That heart is the one thing an assistant may write: it
// calls save_piece, the same save as the heart on her own pages.

const PROTOCOL = '2025-06-18'

const TOOLS = [
  {
    name: 'find_outfits',
    description:
      'Outfits MYRA would put together for her, for an occasion — "dinner", "a wedding in June", "work". Uses her own wardrobe, her brands, her sizes and her stylist\'s rules, and every look is checked before it is returned. Each look comes with its picture, the outfit styled: show it in your reply with the pieces listed under it, not just names and links.',
    inputSchema: {
      type: 'object',
      properties: {
        occasion: { type: 'string', description: 'What it is for, in her words: dinner, work, a wedding, a trip, everyday.' },
        count: { type: 'integer', description: 'How many outfits (1–5). Default 3.' },
      },
      required: ['occasion'],
    },
    _meta: APP_TOOL_META,
  },
  {
    name: 'style_a_piece',
    description: 'Ways to wear one piece she owns or has saved — name it however she would ("my navy blazer", "the cream lace dress"). Each look comes with its picture, the outfit styled: show it in your reply with the pieces listed under it, not just names and links.',
    inputSchema: {
      type: 'object',
      properties: { piece: { type: 'string', description: 'The piece, in her words.' } },
      required: ['piece'],
    },
    _meta: APP_TOOL_META,
  },
  {
    name: 'my_style',
    description: 'What MYRA knows about her: her house style, colours, shapes, sizes, what she dresses for, her brands, her pictures and her own wardrobe.',
    inputSchema: { type: 'object', properties: {} },
  },
  { name: 'my_wardrobe', description: 'The pieces she owns, as MYRA has them.', inputSchema: { type: 'object', properties: {} } },
  { name: 'my_brands', description: 'The brands she wears, in her order, and the ones MYRA never recommends back.', inputSchema: { type: 'object', properties: {} } },
  { name: 'my_saved_pieces', description: 'Pieces she saved while shopping, with pictures, prices, links and whether they have gone.', inputSchema: { type: 'object', properties: {} }, _meta: APP_TOOL_META },
  {
    name: 'save_piece',
    description: 'Save a piece from a MYRA look to her saved shelf (or remove it), by the item_id MYRA gave it. Only when she asks to save, like or keep a piece.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'The piece\'s item_id from a MYRA look.' },
        saved: { type: 'boolean', description: 'true to save, false to remove. Default true.' },
      },
      required: ['item_id'],
    },
    _meta: APP_CALLABLE_META,
  },
] as const

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const rpc = (id: unknown, result: unknown) => json({ jsonrpc: '2.0', id, result })
const rpcError = (id: unknown, code: number, message: string) => json({ jsonrpc: '2.0', id, error: { code, message } })
const text = (s: string) => ({ content: [{ type: 'text', text: s }] })

/**
 * Looks, as text with each look's picture beside it. The text (with one
 * markdown image line per look) is what the assistant writes from; the image
 * blocks — one per look, the outfit styled — are what the tool result shows
 * and what the assistant sees. A picture that will not fetch is left out of
 * the blocks; its line is still in the text. The structuredContent is the
 * same looks for the app, with which pieces she has saved already.
 */
async function looksAnswer(memberId: string, intro: string, raw: OutfitAnswer[]) {
  const itemIds = raw.flatMap((l) => l.pieces.map((p) => p.item_id ?? ''))
  const [shots, saved] = await Promise.all([
    modelShotsFor(itemIds).catch(() => new Map<string, string>()),
    savedIdsFor(memberId, itemIds).catch(() => new Set<string>()),
  ])
  // A look leads with a piece already shot on a model where it has one.
  const looks = raw.map((l) => ({ ...l, picture_url: l.pieces.map((p) => (p.item_id ? shots.get(p.item_id) : null)).find(Boolean) ?? null }))
  const body = [intro, SHOW_PICTURES, '', ...looks.map(outfitToText)].join('\n')
  const heroes = picturesOf(looks)
  const blocks = await pictureBlocks(heroes.map((p) => p.url))
  const pictures = heroes.flatMap((p, i) => (blocks[i] ? [{ type: 'text', text: p.caption }, blocks[i]] : []))
  const structuredContent: AppLooks = {
    kind: 'looks', title: intro.replace(/ — ◈.*$/, ''),
    looks: looks.map((l) => ({
      image_url: appPicture(lookPicture(l)?.image_url, 828),
      pieces: l.pieces.map((p) => appPiece(p, !!p.item_id && saved.has(p.item_id))),
      why: l.why,
    })),
  }
  return { content: [{ type: 'text', text: body }, ...pictures], structuredContent }
}

/** Her saved pieces: the text as before, and the cards for a host that draws them. */
async function savedAnswer(memberId: string) {
  const [text, rows] = await Promise.all([savedFor(memberId), savedPiecesFor(memberId).catch(() => [])])
  const structuredContent: AppPieces = {
    kind: 'pieces', title: rows.length ? `${rows.length} saved from the shops` : 'Nothing saved yet',
    pieces: rows.map((r) => appPiece({ ...r, name: r.gone ? `${r.name} (gone)` : r.name }, true)),
  }
  return { content: [{ type: 'text', text }], structuredContent }
}

export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }) }

/** A connector that probes with GET gets told plainly what this is. */
export async function GET() {
  return json({ name: 'MYRA', protocol: PROTOCOL, transport: 'streamable-http', note: 'POST JSON-RPC here. Add this URL as a custom connector.' })
}

/**
 * A link she has turned off stops working, even though it is still signed.
 * Before migration 0068 there is nothing to check against, and the token's own
 * signature and expiry still stand.
 */
async function linkLive(memberId: string, token: string): Promise<boolean> {
  const admin = createAdminClient() as any
  try {
    const { data, error } = await admin.from('member_assistant_link').select('token_hash, uses').eq('member_id', memberId).maybeSingle()
    if (error) return true
    if (!data) return false
    if (data.token_hash !== hashAssistantToken(token)) return false
    void admin.from('member_assistant_link')
      .update({ last_used_at: new Date().toISOString(), uses: (data.uses ?? 0) + 1 })
      .eq('member_id', memberId)
      .then(() => undefined, () => undefined)
    return true
  } catch {
    return true
  }
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const raw = decodeURIComponent(params.token ?? '')
  const signed = resolveMirrorToken(raw)
  const claim = signed && (await linkLive(signed.memberId, raw)) ? signed : null
  let body: any
  try { body = await req.json() } catch { return rpcError(null, -32700, 'Parse error') }

  const messages = Array.isArray(body) ? body : [body]
  const answers: unknown[] = []

  for (const m of messages) {
    const { id, method } = m ?? {}
    // A notification (no id) expects no answer at all.
    if (id === undefined || id === null) continue

    if (!claim) { answers.push({ jsonrpc: '2.0', id, error: { code: -32001, message: 'This MYRA link is not live any more — make a new one under YOU in MYRA.' } }); continue }

    switch (method) {
      case 'initialize':
        answers.push({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL,
            capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
            serverInfo: { name: 'MYRA', version: '1.0.0' },
            instructions:
              'MYRA is her private stylist. Ask find_outfits for an occasion, style_a_piece to wear something she owns, or my_style to know her taste before advising. Outfits are composed from pieces MYRA can actually source in her size; a piece marked ◈ is already hers. Every look comes with one picture — the outfit styled — as a markdown image line under its heading: copy that line into your reply, then list the look\'s pieces under it. Never answer with names and links alone. If she asks to save or keep a piece, call save_piece with its item_id.',
          },
        })
        break
      case 'ping':
        answers.push({ jsonrpc: '2.0', id, result: {} })
        break
      case 'tools/list':
        answers.push({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
        break
      case 'resources/list':
        answers.push({ jsonrpc: '2.0', id, result: { resources: [APP_RESOURCE] } })
        break
      case 'resources/templates/list':
        answers.push({ jsonrpc: '2.0', id, result: { resourceTemplates: [] } })
        break
      case 'resources/read': {
        const uri = m?.params?.uri
        if (uri !== APP_URI) { answers.push({ jsonrpc: '2.0', id, error: { code: -32002, message: `Resource not found: ${uri}` } }); break }
        answers.push({ jsonrpc: '2.0', id, result: { contents: [{ uri: APP_URI, mimeType: APP_MIME, text: APP_HTML, _meta: APP_RESOURCE._meta }] } })
        break
      }
      case 'prompts/list':
        answers.push({ jsonrpc: '2.0', id, result: { prompts: [] } })
        break
      case 'tools/call': {
        const name = m?.params?.name
        const args = m?.params?.arguments ?? {}
        try {
          answers.push({ jsonrpc: '2.0', id, result: await callTool(claim.memberId, name, args) })
        } catch (err) {
          answers.push({ jsonrpc: '2.0', id, result: { ...text(`MYRA could not answer that: ${err instanceof Error ? err.message : String(err)}`), isError: true } })
        }
        break
      }
      default:
        answers.push({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
    }
  }

  if (!answers.length) return new Response(null, { status: 202, headers: CORS })
  return json(Array.isArray(body) ? answers : answers[0])
}

async function callTool(memberId: string, name: string, args: any) {
  switch (name) {
    case 'find_outfits': {
      const asked = String(args?.occasion ?? '').slice(0, 200)
      const r = await outfitsFor(memberId, { words: asked, count: Number(args?.count) || 3 })
      if (r.error) return { ...text(r.error), isError: true }
      return looksAnswer(memberId, `${r.looks.length} outfit${r.looks.length === 1 ? '' : 's'} for ${r.occasionLabel.toLowerCase()} — ◈ is a piece she already owns.`, r.looks)
    }
    case 'style_a_piece': {
      const r = await outfitsAroundPiece(memberId, String(args?.piece ?? '').slice(0, 200))
      if (r.error) return { ...text(r.error), isError: true }
      return looksAnswer(memberId, `Ways to wear ${r.piece}:`, r.looks)
    }
    case 'save_piece': {
      const itemId = String(args?.item_id ?? '').trim()
      if (!/^[0-9a-f-]{36}$/i.test(itemId)) return { ...text('save_piece needs the item_id MYRA gave the piece.'), isError: true }
      const want = args?.saved !== false
      const r = await setPieceSaved(memberId, itemId, want)
      if (r.error) return { ...text(r.error), isError: true }
      return { ...text(want ? 'Saved to her MYRA shelf.' : 'Removed from her saved shelf.'), structuredContent: { kind: 'saved', item_id: itemId, saved: r.saved } }
    }
    case 'my_style': return text(await styleFor(memberId))
    case 'my_wardrobe': return text(await wardrobeFor(memberId))
    case 'my_brands': return text(await brandsFor(memberId))
    case 'my_saved_pieces': return savedAnswer(memberId)
    default: return { ...text(`MYRA has no tool called ${name}.`), isError: true }
  }
}
