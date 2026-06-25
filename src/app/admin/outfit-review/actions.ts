'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { getItem, getReadyAndLiveItems } from '@/lib/admin-queries'
import { generateCandidates } from '@/lib/composer'

// Anchor garments we generate review outfits for.
const DRESS = ['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress']
const TOP = ['shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit']
const BOTTOM = ['skirt', 'trousers', 'jeans']
const ANCHOR_TYPES = new Set<string>([...DRESS, ...BOTTOM, ...TOP])

// How many outfits an anchor should have before it's "covered".
const TARGET = 3

export interface ReviewAnchor {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  item_type: string
  existingCount: number
}

export interface ReviewCandidate {
  candidateIndex: number
  score: number
  items: Array<{
    slot: string
    item_id: string
    product_name: string
    brand_name: string | null
    image_url: string
    compat: number
  }>
}

// Brand-tier rule: price_tier 1 HIGH STREET · 2 CONTEMPORARY · 3 PREMIUM ·
// 4 LUXURY · 5 ULTRA-LUXURY. Don't pair high-street/contemporary (≤2) with
// luxury/ultra (≥4). Premium (3) bridges both bands.
function tierBandViolation(tiers: (number | null | undefined)[]): boolean {
  const t = tiers.filter((x): x is number => typeof x === 'number')
  const hasLow = t.some((x) => x <= 2)
  const hasHigh = t.some((x) => x >= 4)
  return hasLow && hasHigh
}

// Anchor items that don't yet have TARGET outfits built around them.
export async function getReviewQueue(limit = 40): Promise<{ anchors: ReviewAnchor[]; error?: string }> {
  try {
    const admin = createAdminClient()
    const library = await getReadyAndLiveItems()

    // Tally each live/draft outfit's hero garment (same anchor rule as the feed).
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

// Generate brand-tier-coherent candidate outfits for one anchor.
export async function composeForReview(anchorItemId: string): Promise<{
  anchor?: { item_id: string; product_name: string; brand_name: string | null; image_url: string; item_type: string }
  candidates?: ReviewCandidate[]
  error?: string
}> {
  try {
    const anchor: any = await getItem(anchorItemId)
    if (!anchor) return { error: 'Anchor not found' }
    const library = await getReadyAndLiveItems()
    if (library.length < 3) return { error: 'Not enough items in the library yet' }

    const raw = generateCandidates({ anchor, library, maxCandidates: 12 })
    const anchorTier = anchor.brand?.price_tier ?? null

    const passing = raw
      .filter(
        (c) =>
          !tierBandViolation([anchorTier, ...c.items.map((ci: any) => ci.item.brand?.price_tier ?? null)]),
      )
      .slice(0, 3)

    const candidates: ReviewCandidate[] = passing.map((c, idx) => ({
      candidateIndex: idx,
      score: Number(c.score.toFixed(3)),
      items: c.items.map(({ item, slot }: any) => ({
        slot,
        item_id: item.item_id,
        product_name: item.product_name,
        brand_name: item.brand?.name ?? null,
        image_url: item.image_url,
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
      },
      candidates,
    }
  } catch (err) {
    console.error('[composeForReview]', err)
    return { error: err instanceof Error ? err.message : 'Failed to compose' }
  }
}
