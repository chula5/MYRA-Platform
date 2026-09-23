// MYRA Mirror — what a member's history says about brands.
//
// The order a brand site takes for her comes from four kinds of evidence,
// strongest wins per brand:
//   named     she told us (pilot_member.brands, ranked)
//   wardrobe  she owns it (owned item rows — a brand she wears is a brand she buys)
//   shopped   she bought or clicked out to it (pilot_taste_event purchase /
//             click_out through the look's pieces; the click table by item)
//   liked     she saved or said yes to a look built on it (pilot_taste_event
//             save / yes) or her learned affinity says so — and, for the
//             curator, every brand she has KEPT in MYRA's inventory: three
//             thousand approved pieces are three thousand likes
//   similar   family / vector neighbours of ANY of the above, via the brand graph
// then a neutral baseline. Input-only brands (the Zara rule) are never lifted.
// Cached per member for five minutes: the page must not wait on five queries.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import {
  SEED, brandKey, resolveBrandNames, computeSimilarBrands, type BrandGraph,
} from '@/lib/brand-affinity'
import type { MirrorMember } from './auth'
import { houseForLine, LINE_FACTOR } from './diffusion'

export type BrandWhy = 'named' | 'wardrobe' | 'shopped' | 'liked' | 'learned' | 'similar' | 'baseline' | 'input_only'
export interface BrandSignal { score: number; why: BrandWhy; trace: string; brandId?: string }

export interface MemberBrandSignals {
  byKey: Map<string, BrandSignal> // brandKey(label as seen) → signal
  byBrandId: Map<string, BrandSignal> // graph brand → signal (catches aliases / accents)
  /** Display names of every brand she has real evidence for — the houses a retailer's line label may belong to. */
  houses: string[]
  inputOnly: Set<string>
  counts: Record<Exclude<BrandWhy, 'baseline' | 'input_only'>, number>
}

const TTL_MS = 5 * 60_000
const cache = new Map<string, { at: number; value: MemberBrandSignals }>()
export function forgetMemberSignals(memberId: string) { cache.delete(memberId) }

/** Rank 1 → 1.0, easing to 0.6 by rank 9 — a named brand always beats a learned one. */
const namedScore = (rank: number) => Math.max(0.6, +(1 - (Math.max(1, rank) - 1) * 0.05).toFixed(3))
/** Repeat evidence counts, gently: base + 0.05 per further occurrence, capped. */
const repeat = (base: number, n: number, cap: number) => Math.min(cap, +(base + 0.05 * Math.max(0, n - 1)).toFixed(3))

const WEIGHT = {
  wardrobe: { base: 0.7, cap: 0.9 },
  purchase: { base: 0.95, cap: 0.98 },
  click_out: { base: 0.75, cap: 0.9 },
  save: { base: 0.75, cap: 0.9 },
  yes: { base: 0.65, cap: 0.85 },
} as const

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

export async function memberBrandSignals(member: MirrorMember, graph: BrandGraph, adminIn?: any): Promise<MemberBrandSignals> {
  const hit = cache.get(member.member_id)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const admin = adminIn ?? (createAdminClient() as any)

  const byKey = new Map<string, BrandSignal>()
  const counts = { named: 0, wardrobe: 0, shopped: 0, liked: 0, learned: 0, similar: 0 }
  const put = (label: string | null | undefined, s: BrandSignal) => {
    const key = brandKey(label ?? '')
    if (!key) return
    const prev = byKey.get(key)
    if (!prev || s.score > prev.score) byKey.set(key, s)
  }

  // 1. named
  for (const b of member.brands) if (b?.name) { put(b.name, { score: namedScore(Number(b.rank) || 99), why: 'named', trace: 'one of your brands' }); counts.named++ }

  // 2. wardrobe — brand label = brand row if matched, else what she typed
  const owners = [member.member_id, member.auth_user_id].filter(Boolean) as string[]
  try {
    const { data } = await admin.from('item').select('owned_metadata, brand:brand_id(name)')
      .eq('ownership', 'owned').in('owner_user_id', owners).neq('status', 'archived').limit(2000)
    const n = new Map<string, number>()
    for (const r of data ?? []) {
      const label = r.brand?.name ?? r.owned_metadata?.brand_label
      if (label) n.set(label, (n.get(label) ?? 0) + 1)
    }
    for (const [label, c] of n) put(label, { score: repeat(WEIGHT.wardrobe.base, c, WEIGHT.wardrobe.cap), why: 'wardrobe', trace: c === 1 ? 'in your wardrobe' : `${c} pieces in your wardrobe` })
    counts.wardrobe = n.size
  } catch { /* pre-0046: no wardrobe yet */ }

  // 2b. kept in MYRA — the curator's inventory is her liking history, weighted
  // by how many pieces of a brand she has approved. Clients' taste is their
  // own, so this applies to the admin member only.
  if (member.auth_user_id && member.auth_user_id === process.env.ADMIN_USER_ID) {
    try {
      const n = new Map<string, number>()
      for (let from = 0; from < 8000; from += 1000) {
        const { data } = await admin.from('item').select('brand:brand_id(name)')
          .in('status', ['ready', 'live']).eq('ownership', 'retail').range(from, from + 999)
        for (const r of data ?? []) { const label = r.brand?.name; if (label) n.set(label, (n.get(label) ?? 0) + 1) }
        if (!data || data.length < 1000) break
      }
      for (const [label, c] of n) {
        const score = Math.min(0.85, +(0.6 + 0.02 * (c - 1)).toFixed(3))
        put(label, { score, why: 'liked', trace: c === 1 ? 'a piece you kept in MYRA' : `${c} pieces you kept in MYRA` })
      }
      counts.liked += n.size
    } catch { /* inventory unavailable */ }
  }

  // 3 + 4. shopped / liked through her pilot looks
  try {
    const { data: events } = await admin.from('pilot_taste_event').select('event_type, look_id')
      .eq('member_id', member.member_id).in('event_type', ['purchase', 'click_out', 'save', 'yes']).not('look_id', 'is', null).limit(3000)
    const lookIds = [...new Set((events ?? []).map((e: any) => e.look_id as string))]
    const lookBrands = new Map<string, string[]>()
    for (const ids of chunk(lookIds, 200)) {
      const { data: looks } = await admin.from('pilot_look').select('look_id, items').in('look_id', ids)
      for (const l of looks ?? []) lookBrands.set(l.look_id, (Array.isArray(l.items) ? l.items : []).map((it: any) => it?.brand).filter(Boolean))
    }
    const tally: Record<'purchase' | 'click_out' | 'save' | 'yes', Map<string, number>> = { purchase: new Map(), click_out: new Map(), save: new Map(), yes: new Map() }
    for (const e of events ?? []) for (const b of lookBrands.get(e.look_id) ?? []) {
      const m = tally[e.event_type as keyof typeof tally]
      if (m) m.set(b, (m.get(b) ?? 0) + 1)
    }
    const shopped = new Set<string>(), liked = new Set<string>()
    for (const [label, c] of tally.purchase) { put(label, { score: repeat(WEIGHT.purchase.base, c, WEIGHT.purchase.cap), why: 'shopped', trace: c === 1 ? 'you bought from them' : `you bought from them ${c} times` }); shopped.add(brandKey(label)) }
    for (const [label, c] of tally.click_out) { put(label, { score: repeat(WEIGHT.click_out.base, c, WEIGHT.click_out.cap), why: 'shopped', trace: 'you went to shop them' }); shopped.add(brandKey(label)) }
    for (const [label, c] of tally.save) { put(label, { score: repeat(WEIGHT.save.base, c, WEIGHT.save.cap), why: 'liked', trace: 'you saved a look with them' }); liked.add(brandKey(label)) }
    for (const [label, c] of tally.yes) { put(label, { score: repeat(WEIGHT.yes.base, c, WEIGHT.yes.cap), why: 'liked', trace: 'you said yes to a look with them' }); liked.add(brandKey(label)) }
    counts.shopped += shopped.size
    counts.liked += liked.size
  } catch { /* no pilot history */ }

  // 3b. shopped — tracked click-outs from the main app (by item)
  if (member.auth_user_id) {
    try {
      const { data } = await admin.from('click').select('item:item_id(brand:brand_id(name))')
        .eq('user_id', member.auth_user_id).eq('is_bot', false).limit(2000)
      const n = new Map<string, number>()
      for (const r of data ?? []) { const label = r.item?.brand?.name; if (label) n.set(label, (n.get(label) ?? 0) + 1) }
      for (const [label, c] of n) put(label, { score: repeat(WEIGHT.click_out.base, c, WEIGHT.click_out.cap), why: 'shopped', trace: 'you went to shop them' })
      counts.shopped += n.size
    } catch { /* click table absent */ }
  }

  // 4b. learned affinities (the feed's own learning loop)
  const byBrandId = new Map<string, BrandSignal>()
  try {
    const { data } = await admin.from('user_brand_affinity').select('brand_id, affinity, source, hidden, positive_count').eq('user_id', member.member_id).limit(3000)
    for (const a of data ?? []) {
      if (a.hidden) continue
      const b = graph.byId.get(a.brand_id)
      if (!b) continue
      const score = +Number(a.affinity).toFixed(3)
      const s: BrandSignal = a.source === 'onboarded' ? { score, why: 'named', trace: 'one of your brands', brandId: b.brand_id }
        : a.source === 'learned' || (a.positive_count ?? 0) > 0 ? { score, why: 'learned', trace: 'learned from your decisions', brandId: b.brand_id }
        : { score, why: 'similar', trace: a.expansion_trace ?? 'close to your brands', brandId: b.brand_id }
      if (s.why !== 'similar' || score > SEED.baseline) { put(b.name, s); if (s.why === 'learned') counts.learned++ }
    }
  } catch { /* 0032 not run */ }

  // Resolve every labelled signal onto the graph so aliases/accents on the page still match.
  for (const [key, s] of byKey) {
    const { matched } = resolveBrandNames(graph, [key])
    const b = matched[0]
    if (!b) continue
    s.brandId = b.brand_id
    const prev = byBrandId.get(b.brand_id)
    if (!prev || s.score > prev.score) byBrandId.set(b.brand_id, s)
  }

  // 5. similar — neighbours of everything she has real evidence for
  for (const [brandId, seed] of [...byBrandId]) {
    if (seed.why === 'similar' || seed.score < 0.6) continue
    const seedBrand = graph.byId.get(brandId)
    for (const sim of computeSimilarBrands(brandId, graph)) {
      const mech = sim.mechanism === 'core_family' ? SEED.coreFamily : sim.mechanism === 'adjacent_family' ? SEED.adjacentFamily : SEED.vectorOnly * (sim.score ?? 1)
      const score = +(mech * seed.score).toFixed(3)
      const prev = byBrandId.get(sim.brand_id)
      if (prev && prev.score >= score) continue
      const s: BrandSignal = { score, why: 'similar', brandId: sim.brand_id, trace: `${sim.mechanism.replace('_', ' ')} of ${seedBrand?.name ?? 'your brands'}${sim.family_name ? ` (${sim.family_name})` : ''}` }
      byBrandId.set(sim.brand_id, s)
      const nb = graph.byId.get(sim.brand_id)
      if (nb) { put(nb.name, s); for (const a of nb.aliases) put(a, s) }
      counts.similar++
    }
  }

  const houses = [...new Set([
    ...member.brands.map((b) => b?.name).filter(Boolean) as string[],
    ...[...byBrandId.entries()].filter(([, s]) => s.why !== 'similar' && s.score >= 0.6).map(([id]) => graph.byId.get(id)?.name).filter(Boolean) as string[],
    ...[...byKey.entries()].filter(([, s]) => s.why !== 'similar' && s.score >= 0.6).map(([k]) => k),
  ])]
  const value: MemberBrandSignals = { byKey, byBrandId, houses, inputOnly: new Set(member.brands_input_only.map(brandKey)), counts }
  cache.set(member.member_id, { at: Date.now(), value })
  return value
}

/** Look one page label up: exact label, then graph resolution, then baseline. */
export function signalFor(sig: MemberBrandSignals, graph: BrandGraph, label: string | null | undefined): BrandSignal {
  const key = brandKey(label ?? '')
  if (!key) return { score: SEED.baseline, why: 'baseline', trace: '' }
  if (sig.inputOnly.has(key)) return { score: 0, why: 'input_only', trace: 'input only — never recommended' }
  const direct = sig.byKey.get(key)
  if (direct) return direct
  const { matched } = resolveBrandNames(graph, [label as string])
  const b = matched[0]
  if (b) {
    if (sig.inputOnly.has(brandKey(b.name))) return { score: 0, why: 'input_only', trace: 'input only — never recommended' }
    const s = sig.byBrandId.get(b.brand_id)
    if (s) return s
  }
  // A line of a house she has signal for: "Isabel Marant Etoile", "Polo Ralph Lauren".
  const line = houseForLine(label as string, sig.houses)
  if (line) {
    const parent = sig.byKey.get(brandKey(line.house))
    if (parent && (parent.why !== 'similar' || line.via === 'same')) {
      return line.via === 'same' ? parent : { ...parent, score: +(parent.score * LINE_FACTOR).toFixed(3), trace: `line of ${line.house}` }
    }
  }
  if (b) return { score: SEED.baseline, why: 'baseline', trace: '', brandId: b.brand_id }
  // Same house under a shorter name anywhere in MYRA's graph: "DA LUNA" is "DA LUNA London".
  const same = houseForLine(label as string, graph.brands.map((g) => g.name))
  if (same?.via === 'same') {
    const g = graph.brands.find((x) => x.name === same.house)
    if (g) return sig.byBrandId.get(g.brand_id) ?? { score: SEED.baseline, why: 'baseline', trace: '', brandId: g.brand_id }
  }
  return { score: SEED.baseline, why: 'baseline', trace: '' }
}
