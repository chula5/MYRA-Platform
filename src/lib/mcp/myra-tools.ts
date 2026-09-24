import 'server-only'

// WHAT MYRA CAN ANSWER FROM SOMEWHERE ELSE.
//
// The tools an assistant (Claude, ChatGPT) may call on a member's behalf. Each
// one reads or composes exactly what her own rooms do — the same composer, the
// same gates, the same look check — and answers in words, because that is what
// a chat can use. Nothing here writes a decision: an assistant may ask MYRA to
// style something, never to say she liked it.

import { createAdminClient } from '@/lib/supabase-server'
import { memberMemory } from '@/lib/member-memory'
import { listOwnedItems } from '@/lib/wardrobe/store'
import { ownerRefsForMember } from '@/lib/wardrobe/owned-items'
import { effectiveWeights, lookTasteVector, normalise, readStylePrefs } from '@/lib/pilot-stylist'
import { composeMemberLooks, composeMemberVariants, personaFitScore, toLookItem, type OccasionContext } from '@/lib/pilot-composer'
import type { LookItem } from '@/lib/pilot-stylist'
import { judgeAgainstBrief, briefAffinity, parseBrief, briefIsEmpty } from '@/lib/stylist-brief'
import { judgeLooksForMember, hasPieceOutOfSize } from '@/lib/look-check'
import { whyThisSuitsHer } from '@/lib/look-why'
import { CLIENT_OCCASIONS, ASK_KINDS, askKindForEvent } from '@/lib/client-occasions'
import {
  loadComposableLibrary, loadComposeHistory, loadMemberTaste, loadPersonaLens,
} from '@/app/admin/private-stylist/actions'

const LOOKS = 3

export interface OutfitAnswer {
  pieces: { name: string; brand: string; price_gbp: number | null; owned: boolean; url: string | null }[]
  why: string
  /** The same pieces with their pictures, for a surface that draws the look. */
  items?: LookItem[]
}

/** Which stylist's eye and nevers to style through — her assigned one by default. */
export interface ThroughStylist { stylistId?: string | null }

const answerFor = (items: LookItem[], why: string): OutfitAnswer => ({
  pieces: items.map((it) => ({ name: it.product_name, brand: it.brand, price_gbp: it.price_gbp ?? null, owned: !!it.owned, url: it.url ?? null })),
  why,
  items,
})

const lineFor = (p: OutfitAnswer['pieces'][number]) =>
  `${p.owned ? '◈ ' : ''}${p.brand} — ${p.name}${p.owned ? ' (hers already)' : p.price_gbp != null ? ` · £${Math.round(p.price_gbp)}` : ''}${p.url ? ` · ${p.url}` : ''}`

/** The occasion an assistant's words are asking for, in MYRA's own vocabulary. */
export function occasionFromWords(words: string): { occasion: string; label: string } {
  const t = (words ?? '').toLowerCase()
  // What she actually said, first: "dinner" is dinner, not "an occasion".
  const plain: [RegExp, string][] = [
    [/dinner|drinks|supper|restaurant|date night|bar\b|cocktail/, 'dinner_drinks'],
    [/wedding|christening|funeral|party|ball|gala|black tie|races|graduation|christmas do/, 'event'],
    [/interview|presentation|pitch|client|conference|board/, 'work_elevated'],
    [/work|office|desk/, 'work_standard'],
    [/holiday|trip|travel|flight|weekend away|city break|beach|ski/, 'travel'],
    [/school run|errand|everyday|day out|weekend|lunch|coffee|casual/, 'casual_day'],
  ]
  const hit = plain.find(([re]) => re.test(t))?.[1]
  const occasion = hit ?? ASK_KINDS.find((k) => k.id === askKindForEvent(words, null))?.occasion ?? 'dinner_drinks'
  const label = CLIENT_OCCASIONS.find((o) => o.id === occasion)?.label ?? 'Dinner or drinks'
  return { occasion, label }
}

/**
 * OUTFITS FOR SOMETHING — the delivery composer, run for a member without
 * saving anything. Checked by MYRA's eye before it is returned, exactly as a
 * look on her own page is.
 */
export async function outfitsFor(
  memberId: string,
  opts: { occasion?: string | null; words?: string | null; count?: number } & ThroughStylist = {},
): Promise<{ looks: OutfitAnswer[]; occasionLabel: string; error?: string }> {
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', memberId).maybeSingle()
  if (!member) return { looks: [], occasionLabel: '', error: 'No MYRA account behind this link' }

  const asked = opts.occasion
    ? { occasion: opts.occasion, label: CLIENT_OCCASIONS.find((o) => o.id === opts.occasion)?.label ?? opts.occasion }
    : occasionFromWords(opts.words ?? '')

  const [taste, library, lens, history] = await Promise.all([
    loadMemberTaste(admin, member, { personaId: opts.stylistId }),
    loadComposableLibrary(member),
    loadPersonaLens(admin, memberId, opts.stylistId),
    loadComposeHistory(admin, memberId),
  ])
  const mix = normalise(effectiveWeights(member.room_weights, asked.occasion as any, member.work_dress_code))
  const occ: OccasionContext = { id: asked.occasion, vector: lookTasteVector(mix), climate: null }
  const want = Math.max(1, Math.min(opts.count ?? LOOKS, 5))
  const composed = composeMemberLooks(taste, library as any, want + 2, occ, lens, history, { ownedMode: 'blend' })
  if (!composed.length) return { looks: [], occasionLabel: asked.label, error: 'Nothing in her size goes together for that right now' }

  const judged = await judgeLooksForMember(admin, memberId, composed, 'unknown')
  const rank = (i: number) => (judged[i].check?.verdict === 'works' ? 0 : judged[i].check ? 1 : 2)
  const passing = composed.map((_, i) => i)
    .filter((i) => judged[i].check?.verdict !== 'clashes' && !hasPieceOutOfSize(judged[i]))
    .sort((a, b) => rank(a) - rank(b) || a - b)
  const dims = new Map<string, any>((library as any[]).map((i) => [i.item_id, i]))
  const prefs = readStylePrefs(member)
  const chosen = (passing.length ? passing : composed.map((_, i) => i)).slice(0, want)

  return {
    occasionLabel: asked.label,
    looks: chosen.map((i) => answerFor(
      composed[i].items,
      whyThisSuitsHer(
        composed[i].items.map((it) => ({ ...(dims.get(it.item_id ?? '') ?? {}), product_name: it.product_name, owned: !!it.owned })),
        prefs,
      ),
    )),
  }
}

/** Outfits around one piece she owns or has saved, found by name. */
export async function outfitsAroundPiece(memberId: string, query: string, opts: ThroughStylist = {}): Promise<{ piece?: string; looks: OutfitAnswer[]; error?: string }> {
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', memberId).maybeSingle()
  if (!member) return { looks: [], error: 'No MYRA account behind this link' }

  const owners = ownerRefsForMember({ member_id: memberId, auth_user_id: member.auth_user_id })
  const owned = await listOwnedItems(owners).catch(() => [])
  const { data: saved } = await admin.from('member_saved_item')
    .select('item:item_id(item_id, product_name, image_url, brand:brand_id(name))').eq('member_id', memberId).limit(60)
  const savedRows = ((saved ?? []) as any[]).map((r) => r.item).filter(Boolean)

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const score = (name: string) => words.filter((w) => name.toLowerCase().includes(w)).length
  const candidates = [...owned, ...savedRows].map((i: any) => ({ i, s: score(String(i.product_name ?? '')) }))
    .sort((a, b) => b.s - a.s)
  const hit = candidates[0]?.s ? candidates[0].i : null
  if (!hit) return { looks: [], error: `Nothing in her wardrobe or saved pieces matches “${query}”` }

  const [taste, library, lens, history] = await Promise.all([
    loadMemberTaste(admin, member, { personaId: opts.stylistId }),
    loadComposableLibrary(member),
    loadPersonaLens(admin, memberId, opts.stylistId),
    loadComposeHistory(admin, memberId),
  ])
  const pool = (library as any[]).some((i) => i.item_id === hit.item_id) ? library : [...(library as any[]), hit]
  const composed = composeMemberVariants(taste, pool as any, hit.item_id, LOOKS + 2, undefined, lens, history, { ownedMode: 'blend' })
  if (!composed.length) return { piece: hit.product_name, looks: [], error: 'Nothing goes with it in her size right now' }
  const judged = await judgeLooksForMember(admin, memberId, composed, 'unknown')
  const passing = composed.map((_, i) => i).filter((i) => judged[i].check?.verdict !== 'clashes' && !hasPieceOutOfSize(judged[i]))
  const dims = new Map<string, any>((pool as any[]).map((i) => [i.item_id, i]))
  const prefs = readStylePrefs(member)
  return {
    piece: hit.product_name,
    looks: (passing.length ? passing : composed.map((_, i) => i)).slice(0, LOOKS).map((i) => answerFor(
      composed[i].items,
      whyThisSuitsHer(composed[i].items.map((it) => ({ ...(dims.get(it.item_id ?? '') ?? {}), product_name: it.product_name, owned: !!it.owned })), prefs),
    )),
  }
}

/** A piece found for her, with its picture. */
export interface ItemAnswer {
  item_id: string
  name: string
  brand: string
  price_gbp: number | null
  url: string | null
  image_url: string | null
  owned: boolean
  item_type: string | null
}

/**
 * PIECES IN HER SIZE that match some words — a brand, a kind of piece, a
 * colour, a material — seen through a stylist: her nevers remove pieces, her
 * brands and signature pieces lift them, her eye orders the rest.
 */
export async function findItems(
  memberId: string,
  opts: { words: string; brand?: string | null; type?: string | null; count?: number } & ThroughStylist,
): Promise<{ items: ItemAnswer[]; removed: number; error?: string }> {
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', memberId).maybeSingle()
  if (!member) return { items: [], removed: 0, error: 'No MYRA account behind this link' }

  const [library, lens, stylistRow] = await Promise.all([
    loadComposableLibrary(member),
    loadPersonaLens(admin, memberId, opts.stylistId),
    opts.stylistId ? admin.from('stylist').select('name, brief').eq('stylist_id', opts.stylistId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const parsed = stylistRow?.data ? parseBrief(stylistRow.data.brief, stylistRow.data.name ?? '') : null
  const brief = parsed && !briefIsEmpty(parsed) ? parsed : null

  const words = (opts.words ?? '').toLowerCase().split(/[^a-z0-9&+é]+/).filter((w) => w.length > 1)
  const brand = opts.brand?.toLowerCase() ?? null
  const type = opts.type?.toLowerCase() ?? null
  const textOf = (it: any) => [it.product_name, it.item_type, it.colour_family, it.material_primary, it.material_category, it.brand?.name]
    .filter(Boolean).join(' ').toLowerCase().replace(/_/g, ' ')
  const piece = (it: any) => ({
    product_name: it.product_name, item_type: it.item_type, material_primary: it.material_primary, material_category: it.material_category,
    colour_family: it.colour_family, print_flag: it.print_flag, brand_name: it.brand?.name ?? null,
  })

  let removed = 0
  const scored = (library as any[]).map((it) => {
    const text = textOf(it)
    if (brand && !(it.brand?.name ?? '').toLowerCase().includes(brand)) return null
    if (type && !text.includes(type)) return null
    const wordHits = words.filter((w) => text.includes(w)).length
    if (words.length && !wordHits && !brand && !type) return null
    if (brief) {
      const j = judgeAgainstBrief([piece(it)], brief)
      if (j.blocked && !it.owned) { removed++; return null }
    }
    const fit = lens ? personaFitScore(lens, it) : 0
    const lift = brief ? briefAffinity(piece(it), brief) : 0
    return { it, s: wordHits * 2 + lift + fit }
  }).filter(Boolean) as { it: any; s: number }[]
  scored.sort((a, b) => b.s - a.s)

  const want = Math.max(1, Math.min(opts.count ?? 8, 12))
  return {
    removed,
    items: scored.slice(0, want).map(({ it }) => {
      const li = toLookItem(it)
      return {
        item_id: it.item_id, name: li.product_name, brand: li.brand, price_gbp: li.price_gbp ?? null,
        url: li.url ?? null, image_url: li.image_url ?? null, owned: li.owned, item_type: it.item_type ?? null,
      }
    }),
  }
}

/** Her wardrobe, in a line each. */
export async function wardrobeFor(memberId: string): Promise<string> {
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('auth_user_id, name').eq('member_id', memberId).maybeSingle()
  const owners = ownerRefsForMember({ member_id: memberId, auth_user_id: member?.auth_user_id })
  const owned = await listOwnedItems(owners).catch(() => [])
  if (!owned.length) return 'Her wardrobe is empty in MYRA — nothing has been added yet.'
  return [`${owned.length} pieces of her own:`, ...owned.slice(0, 80).map((i: any) => `· ${i.brand?.name ?? 'her own'} — ${i.product_name}${i.colour_family ? ` (${i.colour_family})` : ''}`)].join('\n')
}

/** The brands she wears, and the ones MYRA never recommends. */
export async function brandsFor(memberId: string): Promise<string> {
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('brands, brands_input_only').eq('member_id', memberId).maybeSingle()
  const named = ((member?.brands ?? []) as any[]).map((b) => (typeof b === 'string' ? b : b?.name)).filter(Boolean)
  const inputOnly = (member?.brands_input_only ?? []) as string[]
  if (!named.length) return 'She has not named any brands in MYRA yet.'
  return [
    `Brands she wears, her order: ${named.join(', ')}.`,
    inputOnly.length ? `Worn but never recommended back to her: ${inputOnly.join(', ')}.` : '',
  ].filter(Boolean).join('\n')
}

/** The pieces she saved while shopping. */
export async function savedFor(memberId: string): Promise<string> {
  const admin = createAdminClient() as any
  const { data } = await admin.from('member_saved_item')
    .select('saved_at, source_host, item:item_id(product_name, price_gbp, retailer_url, stock_status, brand:brand_id(name))')
    .eq('member_id', memberId).order('saved_at', { ascending: false }).limit(40)
  const rows = ((data ?? []) as any[]).filter((r) => r.item)
  if (!rows.length) return 'She has not saved anything from the shops yet.'
  return [`${rows.length} pieces saved from the shops:`, ...rows.map((r) => {
    const i = r.item
    return `· ${i.brand?.name ?? r.source_host ?? ''} — ${i.product_name}${i.price_gbp ? ` · £${Math.round(Number(i.price_gbp))}` : ''}${i.stock_status === 'out_of_stock' ? ' (gone)' : ''}${i.retailer_url ? ` · ${i.retailer_url}` : ''}`
  })].join('\n')
}

/** Everything MYRA knows about her, in words. */
export async function styleFor(memberId: string): Promise<string> {
  const m = await memberMemory(memberId)
  return m.text || 'MYRA has not learned anything about her yet.'
}

/** An outfit, written out. */
export const outfitToText = (o: OutfitAnswer, i: number): string =>
  [`Look ${i + 1}`, ...o.pieces.map((p) => `  ${lineFor(p)}`), o.why ? `  Why: ${o.why}` : ''].filter(Boolean).join('\n')
