// NEW BRANDS INTO THE BRAND PICKER — so onboarding keeps up with what MYRA stocks.
//
// The picker's groups (src/app/onboarding/brand-groups.ts) are written by hand,
// so a brand Brand Watch brought in last week was never offered to a new member
// unless someone remembered to add it. On 2026-11-01, 45 stocked brands with
// pieces were missing — The Kooples, Bellerose, Boden, Weekend Max Mara, Frame…
//
// Once a day, every stocked brand with enough pieces to judge that the picker
// does not name is filed into ONE group, stored on brand.picker_group, and the
// picker adds it to that group's "+ more" (me/brand-actions buildGroups).
//
// WHO FILES IT. Claude, reading the groups as Chloe wrote them (name, blurb,
// every brand in each) and a sample of the new brand's pieces with prices.
// Not the taste vectors: measured 2026-11-01, filing each already-placed brand
// by its nearest group centroid got 23 of 148 right — the vectors place a
// piece, not a label's world.
//
// Claude may also answer 'none': a misspelt duplicate of a brand already there
// ("Isbael Marant"), a multi-brand shop, or nothing a member would recognise as
// a label. A second-hand source (brand.source_type set) goes straight to
// Second-hand & vintage without a call.
//
// Fails closed: no key, no credit, a reply that is not a known group — the
// brand stays unfiled and is tried again tomorrow. A brand Chloe files by hand
// (or a name added to brand-groups.ts) is never touched.

import Anthropic from '@anthropic-ai/sdk'
import { BRAND_GROUPS } from '@/app/onboarding/brand-groups'
import { brandKey, THIN_VECTOR_ITEMS } from '@/lib/brand-affinity'

export const PICKER_NONE = 'none'
const MODEL = 'claude-sonnet-5-5'
const SAMPLE_PIECES = 14

const GROUP_KEYS = new Set(BRAND_GROUPS.map((g) => g.key))

/** Every name the hand-written groups already offer, folded. */
export function namedInPicker(): Set<string> {
  const keys = new Set<string>()
  for (const g of BRAND_GROUPS) for (const n of [...g.brands, ...(g.more ?? [])]) keys.add(brandKey(n))
  return keys
}

export interface Placement {
  brand: string
  group: string
  note: string
}

let client: Anthropic | null = null
function anthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  client ??= new Anthropic({ apiKey })
  return client
}

const groupsBrief = () =>
  BRAND_GROUPS.map((g) => `- ${g.key} — "${g.name}": ${g.blurb}\n  brands: ${[...g.brands, ...(g.more ?? [])].join(', ')}`).join('\n')

async function askClaude(name: string, pieces: string[]): Promise<{ group: string; note: string } | null> {
  const c = anthropic()
  if (!c) return null
  const prompt = `MYRA is a private stylist for women. New members pick the brands they love from groups. A new brand needs filing into exactly one group, the one a member would look for it in — by the label's world and price, as the brands already in each group show.

GROUPS
${groupsBrief()}

NEW BRAND: ${name}
Some of its pieces (type · name · £):
${pieces.join('\n') || '(none read)'}

Answer "none" instead of a group when the brand is a misspelling or duplicate of a brand already listed above, a multi-brand shop or department store, or not a label a member would recognise.

Reply with JSON only: {"group": "<key or none>", "note": "<under 15 words: why>"}`
  // Room to think first: at 200 tokens Sonnet spent them all thinking and most
  // replies came back empty.
  const res = await c.messages.create({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] })
  const text = res.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    const group = String(j.group ?? '').trim()
    if (group !== PICKER_NONE && !GROUP_KEYS.has(group)) return null
    return { group, note: String(j.note ?? '').slice(0, 200) }
  } catch {
    return null
  }
}

/** The group one brand belongs in, or null when it cannot be read today. */
export async function fileBrand(
  admin: any,
  b: { brand_id: string; name: string; source_type?: string | null },
): Promise<{ group: string; note: string } | null> {
  if (b.source_type) return { group: 'preloved', note: 'second-hand source' }
  const { data: items } = await admin
    .from('item')
    .select('item_type, product_name, price_gbp')
    .eq('brand_id', b.brand_id)
    .order('created_at', { ascending: false })
    .limit(SAMPLE_PIECES)
  const pieces = ((items ?? []) as any[]).map((i) =>
    `${i.item_type ?? '?'} · ${i.product_name ?? '?'} · ${i.price_gbp != null ? Math.round(Number(i.price_gbp)) : '?'}`)
  try {
    return await askClaude(b.name, pieces)
  } catch (err) {
    console.error('[fileBrand]', b.name, err)
    return null
  }
}

/**
 * File every unfiled stocked brand the picker does not name. Returns what it
 * filed (or would file, with dry) and any it could not.
 */
export async function placeNewBrands(admin: any, opts: { dry?: boolean; limit?: number } = {}): Promise<{ placed: Placement[]; failed: string[] }> {
  const { data, error } = await admin
    .from('brand')
    .select('brand_id, name, aliases, source_type, vector_item_count')
    .eq('status', 'stocked')
    .is('picker_group', null)
    .gte('vector_item_count', THIN_VECTOR_ITEMS)
    .order('vector_item_count', { ascending: false })
  if (error) throw new Error(error.message)

  const named = namedInPicker()
  const todo = ((data ?? []) as any[])
    .filter((b) => ![b.name, ...((b.aliases ?? []) as string[])].some((n) => named.has(brandKey(n))))
    .slice(0, opts.limit ?? 60)

  const placed: Placement[] = []
  const failed: string[] = []
  for (const b of todo) {
    const result = await fileBrand(admin, b)
    if (!result) { failed.push(b.name); continue }
    placed.push({ brand: b.name, ...result })
    if (opts.dry) continue
    await admin.from('brand')
      .update({ picker_group: result.group, picker_group_note: result.note, picker_group_at: new Date().toISOString() })
      .eq('brand_id', b.brand_id)
  }
  return { placed, failed }
}
