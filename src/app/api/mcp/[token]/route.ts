import { NextRequest } from 'next/server'
import { resolveMirrorToken } from '@/lib/mirror/auth'
import {
  brandsFor, outfitToText, outfitsAroundPiece, outfitsFor, savedFor, styleFor, wardrobeFor,
} from '@/lib/mcp/myra-tools'

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

const PROTOCOL = '2025-06-18'

const TOOLS = [
  {
    name: 'find_outfits',
    description:
      'Outfits MYRA would put together for her, for an occasion — "dinner", "a wedding in June", "work". Uses her own wardrobe, her brands, her sizes and her stylist\'s rules, and every look is checked before it is returned.',
    inputSchema: {
      type: 'object',
      properties: {
        occasion: { type: 'string', description: 'What it is for, in her words: dinner, work, a wedding, a trip, everyday.' },
        count: { type: 'integer', description: 'How many outfits (1–5). Default 3.' },
      },
      required: ['occasion'],
    },
  },
  {
    name: 'style_a_piece',
    description: 'Ways to wear one piece she owns or has saved — name it however she would ("my navy blazer", "the cream lace dress").',
    inputSchema: {
      type: 'object',
      properties: { piece: { type: 'string', description: 'The piece, in her words.' } },
      required: ['piece'],
    },
  },
  {
    name: 'my_style',
    description: 'What MYRA knows about her: her house style, colours, shapes, sizes, what she dresses for, her brands, her pictures and her own wardrobe.',
    inputSchema: { type: 'object', properties: {} },
  },
  { name: 'my_wardrobe', description: 'The pieces she owns, as MYRA has them.', inputSchema: { type: 'object', properties: {} } },
  { name: 'my_brands', description: 'The brands she wears, in her order, and the ones MYRA never recommends back.', inputSchema: { type: 'object', properties: {} } },
  { name: 'my_saved_pieces', description: 'Pieces she saved while shopping, with prices, links and whether they have gone.', inputSchema: { type: 'object', properties: {} } },
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

export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }) }

/** A connector that probes with GET gets told plainly what this is. */
export async function GET() {
  return json({ name: 'MYRA', protocol: PROTOCOL, transport: 'streamable-http', note: 'POST JSON-RPC here. Add this URL as a custom connector.' })
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const claim = resolveMirrorToken(decodeURIComponent(params.token ?? ''))
  let body: any
  try { body = await req.json() } catch { return rpcError(null, -32700, 'Parse error') }

  const messages = Array.isArray(body) ? body : [body]
  const answers: unknown[] = []

  for (const m of messages) {
    const { id, method } = m ?? {}
    // A notification (no id) expects no answer at all.
    if (id === undefined || id === null) continue

    if (!claim) { answers.push({ jsonrpc: '2.0', id, error: { code: -32001, message: 'This MYRA link has expired — get a new one from YOU in MYRA.' } }); continue }

    switch (method) {
      case 'initialize':
        answers.push({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'MYRA', version: '1.0.0' },
            instructions:
              'MYRA is her private stylist. Ask find_outfits for an occasion, style_a_piece to wear something she owns, or my_style to know her taste before advising. Outfits are composed from pieces MYRA can actually source in her size; a piece marked ◈ is already hers.',
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
        answers.push({ jsonrpc: '2.0', id, result: { resources: [] } })
        break
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
      return text([`${r.looks.length} outfit${r.looks.length === 1 ? '' : 's'} for ${r.occasionLabel.toLowerCase()} — ◈ is a piece she already owns.`, '', ...r.looks.map(outfitToText)].join('\n'))
    }
    case 'style_a_piece': {
      const r = await outfitsAroundPiece(memberId, String(args?.piece ?? '').slice(0, 200))
      if (r.error) return { ...text(r.error), isError: true }
      return text([`Ways to wear ${r.piece}:`, '', ...r.looks.map(outfitToText)].join('\n'))
    }
    case 'my_style': return text(await styleFor(memberId))
    case 'my_wardrobe': return text(await wardrobeFor(memberId))
    case 'my_brands': return text(await brandsFor(memberId))
    case 'my_saved_pieces': return text(await savedFor(memberId))
    default: return { ...text(`MYRA has no tool called ${name}.`), isError: true }
  }
}
