// MYRA Mirror — MYRA's take on one piece, on the brand's own product page.
//
// One honest line and a number: "Works with 6 pieces you own · sleeve length
// you've swapped out twice · in your size (UK 10) — 74%". Every part comes
// from something MYRA already knows about her — brand signals, the composer's
// own item score (affinity, swap-outs, traits, authored prefs, price bands),
// her size profile and her wardrobe — and a negative is never dropped for a
// nicer sentence. Deterministic; the only model call is the one-time image
// scoring inside ensureMirrorItem.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { memberItemScore, personaFitScore, learnedRulePenalty, itemPriceVerdict } from '@/lib/pilot-composer'
import { lovedScore, avoidReasons, readStylePrefs } from '@/lib/pilot-stylist'
import { traitsOf, MIN_EVIDENCE } from '@/lib/member-traits'
import { whyThisSuitsHer } from '@/lib/look-why'
import { pairCompat, slotForItemType, slotPlanForAnchor } from '@/lib/composer'
import { listOwnedItems } from '@/lib/wardrobe/store'
import { ownerRefsForMember } from '@/lib/wardrobe/owned-items'
import { loadMemberTaste, loadPersonaLens } from '@/app/admin/private-stylist/actions'
import { memberBrandSignals, signalFor } from './brand-signals'
import { cachedGraph, fitFor, type SizeFit } from './rank'
import { loadMemberSizeProfile } from '@/lib/size-availability'
import { ensureMirrorItem, type SiteProduct } from './style'
import type { MirrorMember } from './auth'
import { blendConfidence } from './confidence'
export { blendConfidence }

export interface Take {
  item_id?: string
  confidence: number
  line: string
  parts: string[]
  fit: SizeFit
  herSize: string | null
  owns: { product_name: string; brand: string | null }[]
  components: { brand: number; piece: number; size: number | null; wardrobe: number | null }
  error?: string
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const COMPAT_MIN = 0.6

const SIZE_SCORE: Record<SizeFit, number> = { yes: 1, unknown: 0.7, sold_out: 0.4, no: 0.1 }
const humanTrait = (t: string) => t.replace(/[_:]+/g, ' ').replace(/\s+/g, ' ').trim()

export async function takeForMember(member: MirrorMember, product: SiteProduct): Promise<Take> {
  const admin = createAdminClient() as any
  const empty: Take = { confidence: 0, line: '', parts: [], fit: 'unknown', herSize: null, owns: [], components: { brand: 0, piece: 0, size: null, wardrobe: null } }
  const ensured = await ensureMirrorItem(product, member, admin)
  if (!ensured.item) return { ...empty, error: ensured.error ?? 'Could not read this piece' }
  const item = ensured.item

  const { data: memberRow } = await admin.from('pilot_member').select('*').eq('member_id', member.member_id).single()
  if (!memberRow) return { ...empty, error: 'Member not found' }

  const [taste, lens, graph, sizeCtx, owned] = await Promise.all([
    loadMemberTaste(admin, memberRow),
    loadPersonaLens(admin, member.member_id),
    cachedGraph(admin),
    loadMemberSizeProfile(member.member_id),
    listOwnedItems(ownerRefsForMember(memberRow)),
  ])
  const sig = await memberBrandSignals(member, graph, admin)
  const prefs = readStylePrefs(memberRow)

  // Brand
  const brandSig = signalFor(sig, graph, product.brand ?? item.brand?.name ?? '')
  const brand = clamp01(brandSig.score)

  // Piece — the composer's own view of it, normalised from its [-0.5, 1.4] range
  const raw = memberItemScore(taste, item) + personaFitScore(lens, item) - learnedRulePenalty(taste, item)
  const piece = clamp01((raw + 0.5) / 1.9)

  // Size
  const { fit, herSize } = fitFor({ key: item.item_id, brand: product.brand, title: product.title, type: product.type, price: product.price, url: product.url, sizes: product.sizes ?? null }, sizeCtx)
  const size = sizeCtx.hasProfile ? SIZE_SCORE[fit] : null

  // Wardrobe — how much of an outfit around it she already owns
  let wardrobe: number | null = null
  let goesWith = 0
  if (owned.length && item.item_type) {
    const plan = slotPlanForAnchor(slotForItemType(item.item_type))
    const slots = new Set([...plan.required, ...plan.optional])
    const okBySlot = new Map<string, number>()
    for (const o of owned) {
      const slot = o.item_type ? slotForItemType(o.item_type) : null
      if (!slot || !slots.has(slot)) continue
      try { if (pairCompat(item, o).total >= COMPAT_MIN) { goesWith++; okBySlot.set(slot, (okBySlot.get(slot) ?? 0) + 1) } } catch { /* unscored piece */ }
    }
    wardrobe = plan.required.length ? plan.required.filter((s) => (okBySlot.get(s) ?? 0) > 0).length / plan.required.length : (goesWith ? 1 : 0)
  }

  const components = { brand, piece, size, wardrobe }
  const confidence = blendConfidence(components)

  // The line — negatives first-class, never dropped.
  const parts: string[] = []
  if (owned.length && item.item_type) parts.push(goesWith ? `works with ${goesWith} piece${goesWith === 1 ? '' : 's'} you own` : 'nothing you own goes with it yet')
  const avoid = avoidReasons(prefs, item)
  if (avoid.length) parts.push(`${avoid[0].toLowerCase()} — you avoid`)
  if (taste.traits) {
    const mine = traitsOf({ ...item, brand_name: item.brand?.name } as any)
    const hit = mine.map((t) => [t, taste.traits!.stats.get(t)] as const)
      .filter(([, s]) => s && s.rejects >= MIN_EVIDENCE && s.rejects > s.accepts)
      .sort((a, b) => (b[1]!.rejects - b[1]!.accepts) - (a[1]!.rejects - a[1]!.accepts))[0]
    if (hit) parts.push(`${humanTrait(hit[0])} — you've swapped it out ${hit[1]!.rejects} times`)
  }
  const pv = itemPriceVerdict(taste, item)
  if (pv === 'over') parts.push(`over your usual ceiling for ${String(item.item_type ?? 'this').replace(/_/g, ' ')}`)
  else if (pv === 'under') parts.push('well under your usual spend')
  if (fit === 'yes') parts.push(`in your size${herSize ? ` (${herSize})` : ''}`)
  else if (fit === 'sold_out') parts.push('sold out in your size')
  else if (fit === 'no') parts.push('not your size')
  if (parts.length < 2 && lovedScore(prefs, item) > 0) parts.push(whyThisSuitsHer([{ ...item, product_name: item.product_name, owned: false }], prefs).replace(/\.$/, '').toLowerCase())
  if (!parts.length) parts.push(brandSig.trace || (brand >= 0.6 ? 'a brand you rate' : 'a brand MYRA has no read on yet'))

  const owns = owned
    .filter((o) => o.item_type === item.item_type && o.colour_family && o.colour_family === item.colour_family)
    .slice(0, 3).map((o) => ({ product_name: o.product_name, brand: o.brand?.name ?? null }))

  // Last viewed across sites — best effort, table arrives with migration 0060.
  try { await admin.from('recently_viewed').upsert({ member_id: member.member_id, item_id: item.item_id, host: new URL(product.url).host, viewed_at: new Date().toISOString() }, { onConflict: 'member_id,item_id' }) } catch { /* pre-0060 */ }

  return { item_id: item.item_id, confidence, line: parts.slice(0, 3).join(' · '), parts, fit, herSize, owns, components }
}
