'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { getItem, getReadyAndLiveItems } from '@/lib/admin-queries'
import { pairCompat, slotForItemType, slotPlanForAnchor } from '@/lib/composer'
import { loadStyleModel } from '@/lib/style-brain-store'
import { blendedScore } from '@/lib/style-brain'

// Anchor garments we generate review outfits for.
const DRESS = new Set(['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress'])
const TOP = new Set(['shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit'])
const BOTTOM = new Set(['skirt', 'trousers', 'jeans'])
const ANCHOR_TYPES = new Set<string>([...DRESS, ...TOP, ...BOTTOM])
const OUTERWEAR = new Set(['coat', 'trench', 'jacket', 'blazer', 'gilet', 'cape'])

const TARGET = 3

function fmtPrice(price: string | null | undefined, currency: string | null | undefined): string {
  if (!price) return ''
  const sym: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥' }
  const s = sym[currency ?? 'GBP'] ?? ''
  const clean = String(price).replace(/\.00$/, '')
  return s ? `${s}${clean}` : clean
}

// price_tier 1 HIGH STREET · 2 CONTEMPORARY · 3 PREMIUM · 4 LUXURY · 5 ULTRA.
// Don't pair ≤2 with ≥4; premium (3) bridges.
function tierBandViolation(tiers: (number | null | undefined)[]): boolean {
  const t = tiers.filter((x): x is number => typeof x === 'number')
  return t.some((x) => x <= 2) && t.some((x) => x >= 4)
}

function anchorCategory(itemType: string): 'dress' | 'top' | 'bottom' {
  if (DRESS.has(itemType)) return 'dress'
  if (TOP.has(itemType)) return 'top'
  return 'bottom'
}

// Coherence of a combo: average pairwise compat, anchor pairs weighted 2×.
function comboScore(anchor: any, additions: any[]): number {
  let sum = 0
  let w = 0
  for (const it of additions) { sum += 2 * pairCompat(anchor, it).total; w += 2 }
  for (let i = 0; i < additions.length; i++) {
    for (let j = i + 1; j < additions.length; j++) { sum += pairCompat(additions[i], additions[j]).total; w += 1 }
  }
  return w ? sum / w : 0
}

export interface ReviewAnchor {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  item_type: string
  price: string
  existingCount: number
}

export interface ReviewItem {
  slot: string
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  price: string
  compat: number
}

export interface ReviewCandidate {
  candidateIndex: number
  score: number
  items: ReviewItem[]
}

export async function getReviewQueue(limit = 60, shuffle = false): Promise<{ anchors: ReviewAnchor[]; error?: string }> {
  try {
    const admin = createAdminClient()
    const library = await getReadyAndLiveItems()

    const { data: outfits } = await admin
      .from('outfit')
      .select('outfit_id, outfit_item(item_id, slot)')
      .neq('status', 'archived')

    const count = new Map<string, number>()
    for (const o of (outfits ?? []) as any[]) {
      const items = (o.outfit_item ?? []) as { item_id: string; slot: string }[]
      const bySlot = (s: string) => items.find((i) => i.slot === s)?.item_id
      const anchorId = bySlot('dress') || bySlot('top') || bySlot('bottom') || bySlot('outerwear') || items[0]?.item_id
      if (anchorId) count.set(anchorId, (count.get(anchorId) ?? 0) + 1)
    }

    const mapped: ReviewAnchor[] = (library as any[])
      .filter((it) => ANCHOR_TYPES.has(String(it.item_type)) && it.image_url)
      .map((it) => ({
        item_id: it.item_id,
        product_name: it.product_name,
        brand_name: it.brand?.name ?? null,
        image_url: it.image_url,
        item_type: String(it.item_type),
        price: fmtPrice(it.price, it.currency),
        existingCount: count.get(it.item_id) ?? 0,
      }))
      .filter((a) => a.existingCount < TARGET)

    // Refresh = reshuffle so different anchors surface each time. We still keep
    // most-needed (fewest existing outfits) first; the shuffle randomises ties,
    // and Array.sort is stable so that random order is preserved within a band.
    if (shuffle) {
      for (let i = mapped.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[mapped[i], mapped[j]] = [mapped[j], mapped[i]]
      }
    }
    const anchors = mapped
      .sort((a, b) => a.existingCount - b.existingCount || (shuffle ? 0 : a.product_name.localeCompare(b.product_name)))
      .slice(0, limit)

    return { anchors }
  } catch (err) {
    console.error('[getReviewQueue]', err)
    return { anchors: [], error: err instanceof Error ? err.message : 'Failed to load queue' }
  }
}

// Library minus outerwear, the anchor, and any duplicate listing of it.
function styleLibrary(library: any[], anchor: any): any[] {
  const anchorImg = String(anchor.image_url ?? '')
  const anchorName = String(anchor.product_name ?? '').toLowerCase().trim()
  return library.filter(
    (it) =>
      !OUTERWEAR.has(String(it.item_type)) &&
      it.item_id !== anchor.item_id &&
      String(it.image_url) !== anchorImg &&
      String(it.product_name ?? '').toLowerCase().trim() !== anchorName,
  )
}

export async function composeForReview(anchorItemId: string): Promise<{
  anchor?: { item_id: string; product_name: string; brand_name: string | null; image_url: string; item_type: string; price: string }
  candidates?: ReviewCandidate[]
  error?: string
}> {
  try {
    const anchor: any = await getItem(anchorItemId)
    if (!anchor) return { error: 'Anchor not found' }
    const lib = styleLibrary(await getReadyAndLiveItems(), anchor)
    const anchorTier = anchor.brand?.price_tier ?? null
    const cat = anchorCategory(String(anchor.item_type))

    // Top-ranked, brand-tier-coherent items per slot.
    const pool = (slot: string) =>
      lib
        .filter((it: any) => slotForItemType(it.item_type) === slot && !tierBandViolation([anchorTier, it.brand?.price_tier ?? null]))
        .map((it: any) => ({ it, c: pairCompat(anchor, it).total }))
        .sort((a, b) => b.c - a.c)
        .slice(0, 5)
        .map((x) => x.it)

    // Required slots → complete outfit. Dress: shoes + bag. Separates: the other
    // garment + shoes + bag.
    const garmentSlot = cat === 'top' ? 'bottom' : cat === 'bottom' ? 'top' : null
    const slotPools: { slot: string; items: any[] }[] = []
    if (garmentSlot) slotPools.push({ slot: garmentSlot, items: pool(garmentSlot) })
    slotPools.push({ slot: 'shoe', items: pool('shoe') })
    slotPools.push({ slot: 'bag', items: pool('bag') })

    const pools = slotPools.filter((p) => p.items.length > 0) // best-effort if a slot is empty
    if (pools.length === 0) {
      return { anchor: anchorPayload(anchor), candidates: [] }
    }

    // Cartesian product of the slot pools.
    let combos: any[][] = [[]]
    for (const p of pools) {
      const next: any[][] = []
      for (const combo of combos) for (const it of p.items) next.push([...combo, it])
      combos = next
    }

    // Style Brain re-rank: blend Chloe's learned taste into the compose score
    // (safe no-op until there are decisions).
    const styleModel = await loadStyleModel()
    const feat = (it: any) => ({
      item_type: it.item_type, colour_family: it.colour_family ?? null, pattern: it.pattern ?? null,
      material_formality: it.material_formality ?? null, brand_name: it.brand?.name ?? null,
      price_tier: it.brand?.price_tier ?? null,
    })
    const scored = combos
      .filter((items) => !tierBandViolation([anchorTier, ...items.map((i) => i.brand?.price_tier ?? null)]))
      .map((items) => ({
        items,
        score: Math.max(0, Math.min(1, blendedScore(styleModel, comboScore(anchor, items), [feat(anchor), ...items.map(feat)]))),
      }))
      .sort((a, b) => b.score - a.score)

    // Diversity: no single item appears in more than 2 candidates.
    const use = new Map<string, number>()
    const picked: typeof scored = []
    for (const s of scored) {
      if (s.items.some((it) => (use.get(it.item_id) ?? 0) >= 2)) continue
      s.items.forEach((it) => use.set(it.item_id, (use.get(it.item_id) ?? 0) + 1))
      picked.push(s)
      if (picked.length >= 6) break
    }
    if (picked.length < 6) {
      for (const s of scored) {
        if (picked.includes(s)) continue
        picked.push(s)
        if (picked.length >= 6) break
      }
    }

    const candidates: ReviewCandidate[] = picked.map((s, idx) => ({
      candidateIndex: idx,
      score: Number(s.score.toFixed(3)),
      items: s.items.map((it: any) => ({
        slot: slotForItemType(it.item_type),
        item_id: it.item_id,
        product_name: it.product_name,
        brand_name: it.brand?.name ?? null,
        image_url: it.image_url,
        price: fmtPrice(it.price, it.currency),
        compat: Number(pairCompat(anchor, it).total.toFixed(3)),
      })),
    }))

    return { anchor: anchorPayload(anchor), candidates }
  } catch (err) {
    console.error('[composeForReview]', err)
    return { error: err instanceof Error ? err.message : 'Failed to compose' }
  }
}

function anchorPayload(anchor: any) {
  return {
    item_id: anchor.item_id,
    product_name: anchor.product_name,
    brand_name: anchor.brand?.name ?? null,
    image_url: anchor.image_url,
    item_type: String(anchor.item_type),
    price: fmtPrice(anchor.price, anchor.currency),
  }
}

// Swap options (with price), brand-tier-coherent, no outerwear.
// ADD an item to a candidate: returns the best items for the slots NOT yet
// filled for this anchor (e.g. add a bag, shoes, jewellery, or a bottom),
// ranked by compatibility. A query searches the whole library instead.
export async function getReviewAddOptions(
  anchorItemId: string,
  presentSlots: string[],
  excludeItemIds: string[],
  query: string,
): Promise<{ options: ReviewItem[]; missingSlots: string[] }> {
  try {
    const anchor: any = await getItem(anchorItemId)
    if (!anchor) return { options: [], missingSlots: [] }
    const anchorTier = anchor.brand?.price_tier ?? null
    const exclude = new Set(excludeItemIds)
    const q = query.trim().toLowerCase()

    const plan = slotPlanForAnchor(slotForItemType(anchor.item_type))
    const valid = new Set<string>([...plan.required, ...plan.optional])
    const present = new Set(presentSlots)
    const missing = Array.from(valid).filter((s) => !present.has(s))

    let pool = styleLibrary(await getReadyAndLiveItems(), anchor).filter((it: any) => !exclude.has(it.item_id))
    if (q) {
      pool = pool.filter((it: any) =>
        `${it.product_name} ${it.brand?.name ?? ''} ${String(it.item_type).replace(/_/g, ' ')}`.toLowerCase().includes(q),
      )
    } else {
      pool = pool.filter((it: any) => missing.includes(slotForItemType(it.item_type)))
    }
    pool = pool.filter((it: any) => !tierBandViolation([anchorTier, it.brand?.price_tier ?? null]))

    const options: ReviewItem[] = pool
      .map((it: any) => ({
        slot: slotForItemType(it.item_type),
        item_id: it.item_id,
        product_name: it.product_name,
        brand_name: it.brand?.name ?? null,
        image_url: it.image_url,
        price: fmtPrice(it.price, it.currency),
        compat: Number(pairCompat(anchor, it).total.toFixed(3)),
      }))
      .sort((a, b) => b.compat - a.compat)
      .slice(0, 30)

    return { options, missingSlots: missing }
  } catch (err) {
    console.error('[getReviewAddOptions]', err)
    return { options: [], missingSlots: [] }
  }
}

export async function getReviewSwapOptions(
  anchorItemId: string,
  slot: string,
  excludeItemIds: string[],
  query: string,
): Promise<{ options: ReviewItem[] }> {
  try {
    const anchor: any = await getItem(anchorItemId)
    if (!anchor) return { options: [] }
    const exclude = new Set(excludeItemIds)
    const anchorTier = anchor.brand?.price_tier ?? null
    const q = query.trim().toLowerCase()

    let pool = styleLibrary(await getReadyAndLiveItems(), anchor).filter((it: any) => !exclude.has(it.item_id))

    if (q) {
      pool = pool.filter((it: any) =>
        `${it.product_name} ${it.brand?.name ?? ''} ${String(it.item_type).replace(/_/g, ' ')}`.toLowerCase().includes(q),
      )
    } else {
      pool = pool.filter((it: any) => slotForItemType(it.item_type) === slot)
    }

    pool = pool.filter((it: any) => !tierBandViolation([anchorTier, it.brand?.price_tier ?? null]))

    const options: ReviewItem[] = pool
      .map((it: any) => ({
        slot: slotForItemType(it.item_type),
        item_id: it.item_id,
        product_name: it.product_name,
        brand_name: it.brand?.name ?? null,
        image_url: it.image_url,
        price: fmtPrice(it.price, it.currency),
        compat: Number(pairCompat(anchor, it).total.toFixed(3)),
      }))
      .sort((a, b) => b.compat - a.compat)
      .slice(0, 30)

    return { options }
  } catch (err) {
    console.error('[getReviewSwapOptions]', err)
    return { options: [] }
  }
}
