'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { getItem, getReadyAndLiveItems } from '@/lib/admin-queries'
import { generateCandidates, pairCompat, slotForItemType } from '@/lib/composer'

// Anchor garments we generate review outfits for.
const DRESS = ['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress']
const TOP = ['shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit']
const BOTTOM = ['skirt', 'trousers', 'jeans']
const ANCHOR_TYPES = new Set<string>([...DRESS, ...BOTTOM, ...TOP])

// Outerwear is excluded from review candidates (no forcing a jacket/cape).
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

// Anchor items that don't yet have TARGET outfits built around them.
export async function getReviewQueue(limit = 60): Promise<{ anchors: ReviewAnchor[]; error?: string }> {
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
      const anchorId =
        bySlot('dress') || bySlot('top') || bySlot('bottom') || bySlot('outerwear') || items[0]?.item_id
      if (anchorId) count.set(anchorId, (count.get(anchorId) ?? 0) + 1)
    }

    const anchors: ReviewAnchor[] = (library as any[])
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
      .sort((a, b) => a.existingCount - b.existingCount || a.product_name.localeCompare(b.product_name))
      .slice(0, limit)

    return { anchors }
  } catch (err) {
    console.error('[getReviewQueue]', err)
    return { anchors: [], error: err instanceof Error ? err.message : 'Failed to load queue' }
  }
}

// Library minus outerwear, the anchor itself, and any duplicate listing of it.
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
    const library = styleLibrary(await getReadyAndLiveItems(), anchor)
    if (library.length < 2) return { error: 'Not enough compatible items in the library yet' }

    const raw = generateCandidates({ anchor, library, maxCandidates: 18 })
    const anchorTier = anchor.brand?.price_tier ?? null

    // Tier rule + diversity: unique addition sets, and cap reuse of any single
    // item so candidates aren't all the same shoe/bag.
    const seenSets = new Set<string>()
    const itemUse = new Map<string, number>()
    const picked: typeof raw = []
    for (const c of raw) {
      if (tierBandViolation([anchorTier, ...c.items.map((ci: any) => ci.item.brand?.price_tier ?? null)])) continue
      const ids = c.items.map((i: any) => i.item.item_id).sort()
      const key = ids.join('|')
      if (seenSets.has(key)) continue
      // Skip if every item in this combo is already used twice elsewhere.
      const overused = ids.length > 0 && ids.every((id: string) => (itemUse.get(id) ?? 0) >= 2)
      if (overused) continue
      seenSets.add(key)
      ids.forEach((id: string) => itemUse.set(id, (itemUse.get(id) ?? 0) + 1))
      picked.push(c)
      if (picked.length >= 6) break
    }

    const candidates: ReviewCandidate[] = picked.map((c, idx) => ({
      candidateIndex: idx,
      score: Number(c.score.toFixed(3)),
      items: c.items.map(({ item, slot }: any) => ({
        slot,
        item_id: item.item_id,
        product_name: item.product_name,
        brand_name: item.brand?.name ?? null,
        image_url: item.image_url,
        price: fmtPrice(item.price, item.currency),
        compat: Number((c.breakdown.find((b: any) => b.itemId === item.item_id)?.compatWithAnchor ?? 0).toFixed(3)),
      })),
    }))

    return {
      anchor: {
        item_id: anchor.item_id,
        product_name: anchor.product_name,
        brand_name: anchor.brand?.name ?? null,
        image_url: anchor.image_url,
        item_type: String(anchor.item_type),
        price: fmtPrice(anchor.price, anchor.currency),
      },
      candidates,
    }
  } catch (err) {
    console.error('[composeForReview]', err)
    return { error: err instanceof Error ? err.message : 'Failed to compose' }
  }
}

// Swap options (with price), brand-tier-coherent, no outerwear.
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

    // Brand-tier coherent only.
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
