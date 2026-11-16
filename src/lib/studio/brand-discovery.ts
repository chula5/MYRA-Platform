// BRANDS TO DISCOVER — an email with three labels she has not named, chosen
// from her own brand graph (user_brand_affinity rows MYRA expanded from the
// brands she loves), each with three pieces in her size and a short line on
// why MYRA thinks they are hers. Chloe's ask, 2026-11-15: "email for new brand
// to discover this week or maybe 3, a few items and a short description based
// on what they like".
//
// A brand is a candidate when it is an EXPANDED neighbour of her named brands
// (never one she named, marked Not for me, hid, or gave as input-only), its
// customer age reaches hers, and it has at least three sellable pieces in her
// size that pass the reach gate (nothing she avoids, nothing over her bands).
// Candidates run in affinity order, so the closest neighbour comes first.
//
// The why-line is Haiku's, from her brief + the brand's codes + the pieces;
// without a key it falls back to the expansion trace ("because you like X").

import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { loadAffinities, brandKey } from '@/lib/brand-affinity'
import { loadTasteGraph } from '@/lib/taste-graph'
import { sellable } from '@/lib/stock-sellable'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import { loadComposableLibrary } from '@/app/admin/private-stylist/actions'
import { loadMemberReach, forHer, herTaste, labelReachesHer, type MemberReach } from '@/lib/member-style-gate'
import { lovedScore } from '@/lib/pilot-stylist'
import { namedBrands, type NewInMember } from '@/lib/new-in'
import { memberMemory } from '@/lib/member-memory'
import { memberCardShell, siteUrl } from './email'
import { greetingName } from './black-friday-email'
import { esc, p, h, sectionLink, pieceLink, rows, price, isHomeware } from './monday-edit'

export const BRANDS_SHOWN = 3
export const PIECES_PER_BRAND = 3
const CANDIDATES = 14

export interface DiscoveryMember extends NewInMember { name: string | null; auth_user_id: string | null }
export interface DiscoveryPiece { item_id: string; name: string; image_url: string | null; price_gbp: number | null; item_type: string | null }
export interface DiscoveryBrand {
  brand_id: string
  name: string
  affinity: number
  trace: string | null
  why: string
  pieces: DiscoveryPiece[]
}
export interface BrandDiscovery { brands: DiscoveryBrand[]; considered: number }

export async function gatherBrandDiscovery(admin: any, m: DiscoveryMember): Promise<BrandDiscovery> {
  const [affinities, graph, reach] = await Promise.all([
    loadAffinities(admin, m.member_id),
    loadTasteGraph(admin, m.member_id),
    loadMemberReach(admin, m.member_id),
  ])
  const named = new Set(namedBrands(m).map(brandKey))
  const neverKeys = new Set([...(m.brands_never ?? []), ...(m.brands_input_only ?? [])].map(brandKey))

  // Her neighbours, closest first: expanded from what she loves, never named,
  // never refused, never hidden, and from a label whose customers reach her age.
  const rowsByAffinity = [...affinities.values()]
    .filter((r) => r.source === 'expanded' && !r.hidden && r.affinity > 0.1 && r.expansion_trace && r.expansion_trace !== 'baseline')
    .filter((r) => !graph.blocked.has(r.brand_id))
    .filter((r) => labelReachesHer(reach.ageRange, reach.registerOf(r.brand_id)))
    .sort((a, b) => b.affinity - a.affinity)
  if (!rowsByAffinity.length) return { brands: [], considered: 0 }

  const { data: brandRows } = await admin.from('brand').select('brand_id, name').in('brand_id', rowsByAffinity.map((r) => r.brand_id).slice(0, CANDIDATES * 3))
  const nameOf = new Map<string, string>(((brandRows ?? []) as any[]).map((b) => [b.brand_id, String(b.name ?? '')]))
  const candidates = rowsByAffinity
    .filter((r) => { const n = nameOf.get(r.brand_id); return n && !named.has(brandKey(n)) && !neverKeys.has(brandKey(n)) })
    .slice(0, CANDIDATES)
  if (!candidates.length) return { brands: [], considered: 0 }

  // Her size-gated library from the snapshot (seconds), not a size read per piece from the database (minutes).
  const wanted = new Set(candidates.map((r) => r.brand_id))
  const library = await loadComposableLibrary({ member_id: m.member_id, auth_user_id: m.auth_user_id })
  const stocked = (library as any[]).filter((it) => wanted.has(it.brand_id) && it.image_url && it.available !== false && sellable(it) && !isOwnedItem(it) && !isHomeware(it.product_name))
  const hers = forHer(reach, stocked)

  const byBrand = new Map<string, any[]>()
  for (const it of hers) { const list = byBrand.get(it.brand_id) ?? []; list.push(it); byBrand.set(it.brand_id, list) }

  const chosen: Omit<DiscoveryBrand, 'why'>[] = []
  for (const r of candidates) {
    const pool = byBrand.get(r.brand_id) ?? []
    if (pool.length < PIECES_PER_BRAND) continue
    chosen.push({ brand_id: r.brand_id, name: nameOf.get(r.brand_id)!, affinity: r.affinity, trace: r.expansion_trace, pieces: pickPieces(reach, pool) })
    if (chosen.length >= BRANDS_SHOWN) break
  }

  const brief = chosen.length ? await briefOf(m.member_id) : ''
  const brands = await Promise.all(chosen.map(async (c) => ({ ...c, why: await whyLine(admin, m, brief, c) })))
  return { brands, considered: candidates.length }
}

/** Three pieces she would pick up first: what she loves, then her taste, one of each type where possible. */
function pickPieces(reach: MemberReach, pool: any[]): DiscoveryPiece[] {
  const ranked = [...pool].sort((a, b) => lovedScore(reach.prefs, b) - lovedScore(reach.prefs, a) || herTaste(reach, b) - herTaste(reach, a))
  const out: any[] = []
  const types = new Set<string>()
  for (const it of ranked) { if (types.has(it.item_type)) continue; types.add(it.item_type); out.push(it); if (out.length >= PIECES_PER_BRAND) break }
  for (const it of ranked) { if (out.length >= PIECES_PER_BRAND) break; if (!out.includes(it)) out.push(it) }
  return out.map((it) => ({ item_id: it.item_id, name: it.product_name ?? 'Piece', image_url: it.image_url ?? null, price_gbp: it.price_gbp ?? null, item_type: it.item_type ?? null }))
}

async function briefOf(memberId: string): Promise<string> {
  try { return (await memberMemory(memberId)).text.slice(0, 1800) } catch { return '' }
}

const BANNED = /\b(effortless|timeless|chic|elevated|curated|considered)\b/i

async function whyLine(admin: any, m: DiscoveryMember, brief: string, c: Omit<DiscoveryBrand, 'why'>): Promise<string> {
  // Traces read "vector 0.94 via Isabel Marant" or "because you like X"; the member sees the brand, never the number.
  const via = c.trace?.match(/via (.+)$/i)?.[1] ?? c.trace?.match(/because you like (.+)$/i)?.[1] ?? null
  const fallback = via ? `MYRA placed it next to ${via} from how it cuts and colours its clothes, and it sits at prices like yours.` : `A label next to the ones you named, at prices like yours.`
  const near = via ? `it sits next to ${via} in her graph` : (c.trace ?? 'a neighbour of the brands she named')
  const { data: brand } = await admin.from('brand').select('name, price_tier, era_orientation, aesthetic_output, cultural_legibility, creative_behaviour').eq('brand_id', c.brand_id).single()
  const prompt = `You are MYRA, a private stylist, writing one short note to ${greetingName(m.name) || 'your client'} introducing a brand she has not tried.

Write "why": two plain sentences in the second person on why this label is hers — what it does that matches how she dresses, and what to go to it for. Specific, like a good stylist talking; no sales voice, no exclamation marks, never the words effortless, timeless, chic, elevated, curated or considered. Name the brand once. Do not list the pieces; they are shown under the note.

The brand: ${brand?.name ?? c.name}
Its codes (MYRA's own reading of the label): ${JSON.stringify({ price_tier: brand?.price_tier, era: brand?.era_orientation, aesthetic: brand?.aesthetic_output, legibility: brand?.cultural_legibility, creative: brand?.creative_behaviour })}
Why MYRA put it next to her brands: ${near}
The pieces chosen for her: ${c.pieces.map((p) => `${p.name} (${p.item_type ?? 'piece'}, £${Math.round(Number(p.price_gbp) || 0)})`).join('; ')}
The brands she named: ${namedBrands(m).slice(0, 8).join(', ') || 'unknown'}

How she dresses (MYRA's brief on her):
${brief || '(nothing on file yet)'}`

  const accept = (why: string, who: string): string | null => {
    const t = why.trim()
    if (!t || BANNED.test(t) || t.includes('!')) { console.warn(`[brand-discovery] why-line refused (${who}) for ${c.name}: ${t ? `"${t.slice(0, 120)}"` : 'empty'}`); return null }
    return t
  }
  // Haiku first; when the Anthropic key is capped (monthly limit) the same note comes from OpenAI; else the trace line.
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    try {
      const client = new Anthropic({ apiKey: anthropicKey })
      const res = await client.messages.create({
        model: 'claude-haiku-5-5',
        max_tokens: 200,
        thinking: { type: 'disabled' },
        output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { why: { type: 'string' } }, required: ['why'], additionalProperties: false } } },
        messages: [{ role: 'user', content: prompt }],
      } as any) as Anthropic.Message
      const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
      const why = accept(block ? String(JSON.parse(block.text).why ?? '') : '', 'haiku')
      if (why) return why
    } catch (err) { console.warn(`[brand-discovery] why-line failed (haiku) for ${c.name}:`, err instanceof Error ? err.message.slice(0, 200) : err) }
  }
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.BRAND_WATCH_OPENAI_MODEL || 'gpt-6-luna', max_completion_tokens: 220, reasoning_effort: 'none', messages: [{ role: 'user', content: `${prompt}\n\nAnswer with the two sentences only, no JSON, no quotes.` }] }),
      })
      const j: any = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(j?.error?.message ?? '').slice(0, 160)}`)
      const why = accept(String(j.choices?.[0]?.message?.content ?? '').replace(/^"|"$/g, ''), 'openai')
      if (why) return why
    } catch (err) { console.warn(`[brand-discovery] why-line failed (openai) for ${c.name}:`, err instanceof Error ? err.message : err) }
  }
  return fallback
}

const listOf = (parts: string[]) => parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`

export function discoverySubject(d: BrandDiscovery): string {
  const names = d.brands.map((b) => b.name)
  if (names.length === 1) return `A brand to discover this week: ${names[0]}`
  return `${names.length === 3 ? 'Three' : names.length === 2 ? 'Two' : names.length} brands to discover this week: ${listOf(names)}`
}

export function discoveryHtml(member: DiscoveryMember, d: BrandDiscovery, site?: string): string {
  const base = site ?? siteUrl('')
  const first = greetingName(member.name)
  const parts: string[] = []
  parts.push(p(`${first ? `${esc(first)}, ` : ''}${d.brands.length === 1 ? 'a label' : `${d.brands.length === 3 ? 'three' : 'two'} labels`} you have not named yet. Each sits next to the brands you love, and every piece below is in your size and at your prices.`))
  for (const b of d.brands) {
    parts.push(h(esc(b.name.toUpperCase())))
    parts.push(p(esc(b.why), 'margin-top:8px;'))
    parts.push(rows(b.pieces.map((pc) => ({
      href: pieceLink(pc.item_id, base), image_url: pc.image_url, brand: null, name: pc.name,
      priceHtml: pc.price_gbp != null ? price(pc.price_gbp) : '', action: 'SEE THE PIECE',
    }))))
  }
  parts.push(h('YOUR BRANDS'))
  parts.push(p('Love one of these? Add it to your brands and MYRA styles with it from now on. Not for you? Say so there and it will not come back.'))
  parts.push(sectionLink(`${base}/me/profile`, 'YOUR BRANDS'))
  parts.push(p('Reply to this email and it comes straight to Chloe.', 'margin-top:26px;'))
  return memberCardShell('Brands to discover', parts.join('\n'))
}

/** Kept for the route: a member with no neighbour that stocks three pieces for her gets no email. */
export const noDiscovery = (d: BrandDiscovery) => !d.brands.length
