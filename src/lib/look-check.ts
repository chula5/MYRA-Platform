// THE LOOK CHECK — Claude looks at the outfit before anyone else does.
//
// Every piece's product photo is laid out side by side in one image, and
// Claude judges it the way Chloe does at a glance: do the colours work, do the
// pieces read as one outfit, does it break a house rule (white with cream,
// fuchsia, clashing colours), is it right for this client.
//
// Measured before building (2026-09-15, five of Alison's real looks): both
// white-with-cream looks came back "clashes" naming the blouse against the
// skirt; the two looks Chloe accepted straight away came back "works" 5/5 and
// 4/4. The history-based score, tested walk-forward on 60 of her looks, could
// not tell these apart (correlation 0.06) — so this is what the confidence
// number is built on.
//
// Server use only (reads ANTHROPIC_API_KEY). ~2p and 5–10s per look.

import { parseBrief, briefIsEmpty, briefText } from '@/lib/stylist-brief'
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { checkSizesForMember, type PieceSize } from '@/lib/look-size-check'
import { typeCounts } from '@/lib/reference-loves'

export type LookVerdict = 'works' | 'borderline' | 'clashes'

export interface LookCheck {
  verdict: LookVerdict
  colourHarmony: number
  piecesGoTogether: number
  issues: string[]
  /** 0..1 — how confident the check is that Chloe would accept the look as it is. */
  confidence: number
}

export interface CheckPiece {
  image_url?: string | null
  item_type?: string | null
  product_name?: string | null
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'colour_harmony', 'pieces_go_together', 'issues'],
  properties: {
    verdict: { type: 'string', enum: ['works', 'borderline', 'clashes'] },
    colour_harmony: { type: 'integer' },
    pieces_go_together: { type: 'integer' },
    issues: { type: 'array', items: { type: 'string' } },
  },
} as const

// Product photos are often worn on a model styled with OTHER clothes. On
// Alison's real looks the first version blamed a "cobalt shirt" and "navy
// scarf" that were not in the outfit at all — so the pieces are named, in
// order, and everything else in a photo is to be ignored.
const prompt = (client: string, pieces: CheckPiece[]) => `You are the final eye of a private stylist, checking one outfit before the client sees it. The image shows the outfit's ${pieces.length} pieces as product photos side by side, left to right:
${pieces.map((p, i) => `${i + 1}. ${p.product_name ?? 'piece'}${p.item_type ? ` (${String(p.item_type).replace(/_/g, ' ')})` : ''}`).join('\n')}

Product photos are often worn by a model with other clothes and accessories. Judge ONLY the ${pieces.length} pieces listed — in each photo, the piece named for that position — and ignore everything else the model is wearing or holding.

One exception: a CO-ORD or matching set. If a listed piece is one half of a set (its name says co-ord or set, or the photo plainly shows a matching top-and-bottom sold together) and the outfit pairs it with a DIFFERENT bottom or top instead of its own other half, that is a clash — it reads as two bottoms or two tops.

A layer must add something. A waistcoat or tailored vest is worn as a TOP, not a jacket. A sleeveless layer (gilet, waistcoat, vest) over a sleeveless dress or top repeats the same shape and adds nothing — that is a clash.

The client: ${client}

House rules for every client: white and cream (or ivory next to butter or ecru cream) never go together; no fuchsia or hot pink; no clashing colours; the pieces must read as one outfit; at most one statement print, pattern or strong texture — a look with too much going on (e.g. a mustard textured top, a patterned navy trouser and a grey tweed jacket together) clashes.

Judge only what you can see. Rate colour_harmony and pieces_go_together from 1 to 5. verdict: works (you would send it as it is), borderline (one piece needs changing — name it), clashes (breaks a rule or does not go together). issues: short and specific, naming the piece; empty when it works.`

/** The client, in the words the check needs — her own profile, never a guess. */
export function describeClientForCheck(member: {
  name?: string | null
  notes?: string | null
  persona_name?: string | null
  colours_loved?: string[] | null
  colours_avoided?: string[] | null
  shapes_loved?: string[] | null
  shapes_avoided?: string[] | null
  types_loved?: string[] | null
  types_avoided?: string[] | null
  /** Her own words about what she will not wear — read as a rule, not a hint. */
  never_wears?: string | null
}, houseStyle?: string | null, houseBrief?: string | null): string {
  const list = (label: string, xs?: string[] | null) => (xs?.length ? `${label}: ${xs.join(', ').replace(/_/g, ' ')}.` : '')
  return [
    houseStyle ? `Styled in the ${houseStyle} house style.` : '',
    // The stylist's brief: her nevers are rules here, exactly as the member's own are.
    houseBrief ? `The ${houseStyle} brief — ${houseBrief}` : '',
    member.notes ? `Stylist's notes: ${member.notes}` : '',
    list('Colours she loves', member.colours_loved),
    list('Colours she avoids', member.colours_avoided),
    list('Shapes she loves', member.shapes_loved),
    list('Shapes she avoids', member.shapes_avoided),
    list('Pieces she loves', member.types_loved),
    list('Pieces she never wears', member.types_avoided),
    member.never_wears ? `In her own words, she never wears: ${member.never_wears.trim()}. Treat this as a rule: a look that breaks it clashes.` : '',
  ].filter(Boolean).join(' ') || 'No profile yet — judge on the house rules alone.'
}

const clamp15 = (n: unknown) => Math.max(1, Math.min(5, Math.round(Number(n) || 1)))

/** How the verdict and ratings become one confidence number. */
export function confidenceFromCheck(verdict: LookVerdict, colourHarmony: number, piecesGoTogether: number): number {
  const ratings = (clamp15(colourHarmony) + clamp15(piecesGoTogether) - 2) / 8 // 0..1
  const cap = verdict === 'works' ? 1 : verdict === 'borderline' ? 0.6 : 0.3
  return Math.round(Math.min(cap, ratings) * 100) / 100
}

/** Lay the pieces' photos side by side on white, in a single image. */
async function lookSheet(pieces: CheckPiece[]): Promise<{ sheet: Buffer; shown: CheckPiece[] } | null> {
  const sharp = (await import('sharp')).default
  const TILE_W = 420, TILE_H = 560, GAP = 16
  const tiles: Buffer[] = []
  const shown: CheckPiece[] = []
  for (const p of pieces) {
    if (!p.image_url) continue
    const url = p.image_url.includes('res.cloudinary.com') ? p.image_url.replace('/upload/', '/upload/c_limit,w_700/') : p.image_url
    try {
      const r = await fetch(url)
      if (!r.ok) continue
      tiles.push(await sharp(Buffer.from(await r.arrayBuffer())).resize(TILE_W, TILE_H, { fit: 'contain', background: '#ffffff' }).jpeg().toBuffer())
      shown.push(p)
    } catch { /* a missing photo is left out, not fatal */ }
  }
  if (tiles.length < 2) return null
  const width = tiles.length * TILE_W + (tiles.length + 1) * GAP
  const sheet = await sharp({ create: { width, height: TILE_H + 2 * GAP, channels: 3, background: '#ffffff' } })
    .composite(tiles.map((input, i) => ({ input, left: GAP + i * (TILE_W + GAP), top: GAP })))
    .jpeg({ quality: 88 })
    .toBuffer()
  return { sheet, shown }
}

/** Check one outfit. Returns null when it cannot be checked (no photos, no key, API error). */
export async function checkLook(pieces: CheckPiece[], clientDescription: string): Promise<LookCheck | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  const built = await lookSheet(pieces)
  if (!built) return null
  const { sheet, shown } = built
  try {
    const client = new Anthropic({ apiKey })
    const res = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      // A declined request re-runs server-side on Anthropic's recommended fallback.
      betas: ['server-side-fallback-2026-07-01'],
      ...({ fallbacks: 'default' } as Record<string, unknown>),
      output_config: { format: { type: 'json_schema', schema: SCHEMA as any } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: sheet.toString('base64') } },
          { type: 'text', text: prompt(clientDescription, shown) },
        ],
      }],
    } as any) as Anthropic.Beta.BetaMessage
    if (res.stop_reason === 'refusal') return null
    const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text
    if (!text) return null
    const raw = JSON.parse(text) as { verdict: LookVerdict; colour_harmony: number; pieces_go_together: number; issues: string[] }
    const verdict: LookVerdict = raw.verdict === 'works' || raw.verdict === 'borderline' ? raw.verdict : 'clashes'
    const colourHarmony = clamp15(raw.colour_harmony)
    const piecesGoTogether = clamp15(raw.pieces_go_together)
    return {
      verdict,
      colourHarmony,
      piecesGoTogether,
      issues: (raw.issues ?? []).map(String).slice(0, 5),
      confidence: confidenceFromCheck(verdict, colourHarmony, piecesGoTogether),
    }
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.error('[checkLook]', err.status, err.message)
    else console.error('[checkLook]', err)
    return null
  }
}

/** Her profile and house style, read fresh, as the check's description of her. */
export async function loadClientDescription(admin: any, memberId: string): Promise<string> {
  const [{ data: member }, { data: assignment }] = await Promise.all([
    admin.from('pilot_member').select('*').eq('member_id', memberId).maybeSingle(),
    admin.from('user_persona').select('persona_id').eq('user_id', memberId).maybeSingle(),
  ])
  let houseStyle: string | null = null
  let houseBrief: string | null = null
  if (assignment?.persona_id) {
    const { data: persona } = await admin.from('stylist').select('name, brief').eq('stylist_id', assignment.persona_id).maybeSingle()
    houseStyle = persona?.name ?? null
    const brief = parseBrief(persona?.brief, persona?.name ?? '')
    houseBrief = briefIsEmpty(brief) ? null : briefText(persona?.name ?? '', brief)
  }
  // What her own reference pictures keep showing — her taste in her pictures,
  // not only in the words on her profile.
  const owners = [memberId, member?.auth_user_id].filter(Boolean)
  const { data: pics } = await admin.from('inspiration_image')
    .select('scores').in('user_id', owners).in('status', ['scored', 'confirmed'])
  const scored = ((pics ?? []) as any[]).map((p) => p.scores).filter(Boolean)
  let pictures = ''
  if (scored.length >= 3) {
    const counts = typeCounts(scored.map((s) => s.item_types ?? []))
    const NOISE = new Set(['ring', 'earrings', 'bracelet', 'necklace', 'sunglasses', 'brooch'])
    const common = Array.from(counts.entries())
      .filter(([t, n]) => !NOISE.has(t) && n / scored.length >= 0.3)
      .sort((a, b) => b[1] - a[1]).map(([t]) => t.replace(/_/g, ' '))
    const avg = (k: string) => (scored.reduce((s, x) => s + (Number(x[k]) || 0), 0) / scored.length).toFixed(1)
    pictures = ` Her own reference pictures (${scored.length} outfits) mostly show: ${common.join(', ')}; formality ${avg('formality')}/5, pattern ${avg('pattern')}/5, volume ${avg('volume')}/5.`
  }
  return describeClientForCheck(member ?? {}, houseStyle, houseBrief) + pictures
}

export interface JudgedLook {
  check: LookCheck | null
  /** Size verdict per piece, by item_id. */
  sizes: Record<string, PieceSize>
}

/** Any piece confirmed as not in her size. */
export const hasPieceOutOfSize = (j: JudgedLook): boolean =>
  Object.values(j.sizes).some((s) => s.verdict === 'not_in_size')

/**
 * Everything checked before a look is shown: Claude's eye on the photos, and
 * every piece's size read against the retailer. Looks are checked in parallel.
 */
export async function judgeLooksForMember(
  admin: any,
  memberId: string,
  looks: { items: any[] }[],
  sizeRefresh: 'none' | 'unknown' | 'all' = 'unknown',
): Promise<JudgedLook[]> {
  // Everything MYRA knows about her, not only her profile: her pictures, her
  // archival looks, the looks she kept and her own wardrobe (lib/member-memory).
  const { memberMemory } = await import('@/lib/member-memory')
  const [description, sizeMap] = await Promise.all([
    memberMemory(memberId).then((m) => m.text).catch(() => loadClientDescription(admin, memberId)),
    checkSizesForMember(admin, memberId, looks.flatMap((l) => l.items), sizeRefresh),
  ])
  const checks = await Promise.all(looks.map((l) => checkLook(l.items, description)))
  return looks.map((l, i) => ({
    check: checks[i],
    sizes: Object.fromEntries(
      l.items.filter((it) => it.item_id && sizeMap.has(it.item_id)).map((it) => [it.item_id as string, sizeMap.get(it.item_id)!]),
    ),
  }))
}
