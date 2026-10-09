// NOT a 'use server' module, on purpose: every export of a 'use server' file is
// callable by anyone from the browser, and these run without an admin session
// (cron, src/lib pipelines, /me client actions). The admin UI calls the admin-gated
// wrappers in ./actions.gated.ts. Don't add 'use server' here.

import { createAdminClient } from '@/lib/supabase-server'
import { getItem, getReadyAndLiveItems } from '@/lib/admin-queries'
import { pairCompat, slotForItemType, slotPlanForAnchor, deriveSlotScores, deriveOutfitLevelScores } from '@/lib/composer'
import { loadStyleModel, recordStyleOffers } from '@/lib/style-brain-store'
import {
  formalityBand,
  deriveOccasionScores,
  confidenceGate,
} from '@/lib/pipeline'
import { loadLearnedMaterialPairs, recordHouseRejections } from '@/lib/house-style-store'
import { composeReviewLooks, reviewLibrary, reviewFeature, tierBandViolation, REVIEW_ANCHOR_TYPES } from '@/lib/review-compose'
import {
  loadEjectionConstraints,
  loadApprovedVectors,
  loadPipelineConfig,
  vectorForCandidate,
} from '@/lib/pipeline-store'

// Anchor garments we generate review outfits for (the shared review recipe).
const ANCHOR_TYPES = REVIEW_ANCHOR_TYPES

const TARGET = 3

function fmtPrice(price: string | null | undefined, currency: string | null | undefined): string {
  if (!price) return ''
  const sym: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥' }
  const s = sym[currency ?? 'GBP'] ?? ''
  const clean = String(price).replace(/\.00$/, '')
  return s ? `${s}${clean}` : clean
}

export interface ReviewAnchor {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  item_type: string
  price: string
  existingCount: number
  stock_status?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown' | null
  stock_sizes?: string[] | null
}

export interface ReviewItem {
  slot: string
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  price: string
  compat: number
  stock_status?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown' | null
  stock_sizes?: string[] | null
}

export interface ReviewCandidate {
  candidateIndex: number
  score: number
  // Confidence gate (see pipeline.ts): similarity to approved history minus
  // ejection / colour / brand penalties, with the reasons it scored low.
  similarity: number
  confidence: number
  lane: 'fast' | 'standard'
  reasons: string[]
  // House Style Constitution read-out.
  statement: string | null
  echoes: string[]
  items: ReviewItem[]
}

// mode 'needs-more' → anchors with fewer than TARGET outfits (default Review).
// mode 'exactly-one' → anchors styled into exactly ONE outfit so far (the "Extra
// Style Outfits" area: give already-started pieces more looks).
export async function getReviewQueue(
  limit = 60,
  shuffle = false,
  mode: 'needs-more' | 'exactly-one' = 'needs-more',
  brand: string | null = null,
): Promise<{ anchors: ReviewAnchor[]; brands: { name: string; count: number }[]; error?: string }> {
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
        stock_status: it.stock_status ?? null,
        stock_sizes: it.stock_sizes ?? null,
      }))
      .filter((a) => (mode === 'exactly-one' ? a.existingCount === 1 : a.existingCount < TARGET))

    // Brand list (with counts) across ALL anchors that still need outfits —
    // computed before the brand filter + limit so the chips + counts are complete.
    const brandCounts = new Map<string, number>()
    for (const a of mapped) {
      const name = a.brand_name?.trim()
      if (name) brandCounts.set(name, (brandCounts.get(name) ?? 0) + 1)
    }
    const brands = [...brandCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

    // Narrow to a single brand's items when a brand is selected.
    const pool = brand ? mapped.filter((a) => (a.brand_name ?? '') === brand) : mapped

    // Refresh = reshuffle so different anchors surface each time. We still keep
    // most-needed (fewest existing outfits) first; the shuffle randomises ties,
    // and Array.sort is stable so that random order is preserved within a band.
    if (shuffle) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
      }
    }
    const anchors = pool
      .sort((a, b) => a.existingCount - b.existingCount || (shuffle ? 0 : a.product_name.localeCompare(b.product_name)))
      .slice(0, limit)

    return { anchors, brands }
  } catch (err) {
    console.error('[getReviewQueue]', err)
    return { anchors: [], brands: [], error: err instanceof Error ? err.message : 'Failed to load queue' }
  }
}

export async function composeForReview(anchorItemId: string): Promise<{
  anchor?: { item_id: string; product_name: string; brand_name: string | null; image_url: string; item_type: string; price: string; stock_status?: string | null; stock_sizes?: string[] | null }
  candidates?: ReviewCandidate[]
  error?: string
}> {
  try {
    const anchor: any = await getItem(anchorItemId)
    if (!anchor) return { error: 'Anchor not found' }
    const [constraints, approvedVectors, config, learnedPairs, styleModel, library] = await Promise.all([
      loadEjectionConstraints(),
      loadApprovedVectors(500),
      loadPipelineConfig(),
      loadLearnedMaterialPairs(),
      loadStyleModel(),
      getReadyAndLiveItems(),
    ])

    // THE REVIEW RECIPE (lib/review-compose): brand-tier-coherent slot pools,
    // House Style Constitution gate, Style Brain blend, diversity cap. Shared
    // with the Quality Lab so both surfaces compose the same way.
    const { picks, rejectionHits } = composeReviewLooks({
      anchor,
      library: reviewLibrary(library, anchor, constraints),
      styleModel,
      learnedPairs,
    })
    void recordHouseRejections(rejectionHits, anchorItemId)

    const feat = reviewFeature
    const candidates: ReviewCandidate[] = picks.map((s, idx) => {
      // Vector + confidence gate at composition time.
      const entries = [
        { item: anchor, slot: slotForItemType(anchor.item_type) },
        ...s.items.map(({ item }) => ({ item, slot: slotForItemType(item.item_type) })),
      ]
      const occasion = deriveOccasionScores(entries)
      const vector = vectorForCandidate(
        entries,
        occasion,
        deriveOutfitLevelScores(anchor, entries.slice(1)),
        deriveSlotScores(entries),
      )
      const gate = confidenceGate({
        vector,
        approvedVectors,
        items: entries.map((e) => feat(e.item)),
        itemIds: entries.map((e) => e.item.item_id),
        itemLabels: entries.map((e) => [e.item.brand?.name, e.item.product_name].filter(Boolean).join(' ')),
        slotByItemId: Object.fromEntries(entries.map((e) => [e.item.item_id, e.slot])),
        band: formalityBand(entries.map((e) => e.item)),
        constraints,
        model: styleModel,
      })
      // House verdict: soft penalties fold into confidence; statement + echoes
      // travel with the candidate for display.
      const hv = s.verdict
      const confidence = gate.confidence - hv.penaltyTotal
      const statementIt = hv.statement
        ? [anchor, ...s.items.map((i) => i.item)].find((i: any) => i.item_id === hv.statement!.itemId)
        : null
      return {
        candidateIndex: idx,
        score: Number(s.score.toFixed(3)),
        similarity: Number(gate.similarity.toFixed(3)),
        confidence: Number(confidence.toFixed(3)),
        lane: confidence >= config.fast_lane_threshold ? 'fast' as const : 'standard' as const,
        reasons: [...gate.reasons, ...hv.penalties.map((p) => p.message)],
        statement: statementIt
          ? `${[statementIt.brand?.name, statementIt.product_name].filter(Boolean).join(' ')} (${hv.statement!.kind})`
          : null,
        echoes: hv.echoes,
        items: s.items.map(({ item: it }: any) => ({
          slot: slotForItemType(it.item_type),
          item_id: it.item_id,
          product_name: it.product_name,
          brand_name: it.brand?.name ?? null,
          image_url: it.image_url,
          price: fmtPrice(it.price, it.currency),
          compat: Number(pairCompat(anchor, it).total.toFixed(3)),
          stock_status: it.stock_status ?? null,
          stock_sizes: it.stock_sizes ?? null,
        })),
      }
    })

    // Every shown candidate is an OFFER — the denominator of approval rates.
    void recordStyleOffers(
      picks.map((s) => ({
        items: [feat(anchor), ...s.items.map((i) => feat(i.item))],
        anchorItemId,
        itemIds: [anchor.item_id, ...s.items.map((i) => i.item.item_id)],
      })),
      'review',
    )

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
    stock_status: anchor.stock_status ?? null,
    stock_sizes: anchor.stock_sizes ?? null,
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
  brand: string | null = null,
  filters: PickerFilters = {},
): Promise<{ options: ReviewItem[]; missingSlots: string[]; brands: { name: string; count: number }[] }> {
  try {
    const anchor: any = await getItem(anchorItemId)
    if (!anchor) return { options: [], missingSlots: [], brands: [] }
    const anchorTier = anchor.brand?.price_tier ?? null
    const exclude = new Set(excludeItemIds)
    const q = query.trim().toLowerCase()

    const plan = slotPlanForAnchor(slotForItemType(anchor.item_type))
    const valid = new Set<string>([...plan.required, ...plan.optional])
    const present = new Set(presentSlots)
    const missing = Array.from(valid).filter((s) => !present.has(s))

    let pool = reviewLibrary(await getReadyAndLiveItems(), anchor).filter((it: any) => !exclude.has(it.item_id))
    if (q) {
      pool = pool.filter((it: any) =>
        `${it.product_name} ${it.brand?.name ?? ''} ${String(it.item_type).replace(/_/g, ' ')}`.toLowerCase().includes(q),
      )
    } else if (!filters.itemType) {
      pool = pool.filter((it: any) => missing.includes(slotForItemType(it.item_type)))
    }
    pool = applyPickerFilters(pool, filters)
    pool = pool.filter((it: any) => !tierBandViolation([anchorTier, it.brand?.price_tier ?? null]))

    const brands = brandsFromPool(pool)
    const bf = (brand ?? '').trim().toLowerCase()
    const filtered = bf ? pool.filter((it: any) => (it.brand?.name ?? '').trim().toLowerCase() === bf) : pool

    const options: ReviewItem[] = filtered
      .map((it: any) => ({
        slot: slotForItemType(it.item_type),
        item_id: it.item_id,
        product_name: it.product_name,
        brand_name: it.brand?.name ?? null,
        image_url: it.image_url,
        price: fmtPrice(it.price, it.currency),
        compat: Number(pairCompat(anchor, it).total.toFixed(3)),
        stock_status: it.stock_status ?? null,
        stock_sizes: it.stock_sizes ?? null,
      }))
      .sort((a, b) => b.compat - a.compat)
      .slice(0, 30)

    return { options, missingSlots: missing, brands }
  } catch (err) {
    console.error('[getReviewAddOptions]', err)
    return { options: [], missingSlots: [], brands: [] }
  }
}

/** The picker's one-tap colour and type chips. */
export interface PickerFilters {
  colour?: string
  itemType?: string
}

// The picker always sent colour and type, but nothing read them, so those
// chips did nothing. A chosen type widens past the slot (sneakers from a
// heel's slot); colour narrows whatever the pool is.
function applyPickerFilters(pool: any[], filters: PickerFilters): any[] {
  return pool.filter((it: any) =>
    (!filters.itemType || it.item_type === filters.itemType) &&
    (!filters.colour || String(it.colour_family ?? '').toLowerCase() === filters.colour))
}

// Distinct brands present in a pool, with counts, alphabetically. Used to
// populate the swap/add brand filter dropdown.
function brandsFromPool(pool: any[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const it of pool) {
    const b = (it.brand?.name ?? '').trim()
    if (b) counts.set(b, (counts.get(b) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function getReviewSwapOptions(
  anchorItemId: string,
  slot: string,
  excludeItemIds: string[],
  query: string,
  brand: string | null = null,
  filters: PickerFilters = {},
): Promise<{ options: ReviewItem[]; brands: { name: string; count: number }[] }> {
  try {
    const anchor: any = await getItem(anchorItemId)
    if (!anchor) return { options: [], brands: [] }
    const exclude = new Set(excludeItemIds)
    const anchorTier = anchor.brand?.price_tier ?? null
    const q = query.trim().toLowerCase()

    let pool = reviewLibrary(await getReadyAndLiveItems(), anchor).filter((it: any) => !exclude.has(it.item_id))

    if (q) {
      pool = pool.filter((it: any) =>
        `${it.product_name} ${it.brand?.name ?? ''} ${String(it.item_type).replace(/_/g, ' ')}`.toLowerCase().includes(q),
      )
    } else if (!filters.itemType) {
      pool = pool.filter((it: any) => slotForItemType(it.item_type) === slot)
    }
    pool = applyPickerFilters(pool, filters)

    pool = pool.filter((it: any) => !tierBandViolation([anchorTier, it.brand?.price_tier ?? null]))

    // Brand list from the full (pre brand-filter) pool, so every brand stays
    // selectable; then narrow to the chosen brand if one is set.
    const brands = brandsFromPool(pool)
    const bf = (brand ?? '').trim().toLowerCase()
    const filtered = bf ? pool.filter((it: any) => (it.brand?.name ?? '').trim().toLowerCase() === bf) : pool

    const options: ReviewItem[] = filtered
      .map((it: any) => ({
        slot: slotForItemType(it.item_type),
        item_id: it.item_id,
        product_name: it.product_name,
        brand_name: it.brand?.name ?? null,
        image_url: it.image_url,
        price: fmtPrice(it.price, it.currency),
        compat: Number(pairCompat(anchor, it).total.toFixed(3)),
        stock_status: it.stock_status ?? null,
        stock_sizes: it.stock_sizes ?? null,
      }))
      .sort((a, b) => b.compat - a.compat)
      .slice(0, 30)

    return { options, brands }
  } catch (err) {
    console.error('[getReviewSwapOptions]', err)
    return { options: [], brands: [] }
  }
}
