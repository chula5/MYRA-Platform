// HER SALE — what is marked down at the brands she shops, and what to buy first.
//
// For the BLACK FRIDAY section on For You and the notes that open it. Only
// brands in her taste graph that are ON SALE (lib/sales/detect, never one
// Chloe paused); only pieces she could buy today in her size, under her
// ceiling at the SALE price, never her own. Then in the order a stylist would
// put them:
//
//   1. pieces that fill a gap in her wardrobe (lib/mirror/gaps) — "You own one coat"
//   2. pieces she rang WAIT FOR SALE on
//   3. pieces one of her saved searches found
//   4. the rest: her named labels first, then the deepest markdown
//
// A member whose wardrobe MYRA has not seen is never told she is short of
// anything — gaps are only claimed from a wardrobe that is there.

import 'server-only'
import { loadTasteGraph, overHerBudget } from '@/lib/taste-graph'
import { sellable } from '@/lib/stock-sellable'
import { filterItemsForShopper, loadMemberSizeProfile } from '@/lib/size-availability'
import { ownerRefsForMember } from '@/lib/wardrobe/owned-items'
import { wardrobeGaps, gapForItemType, gapSentence, type WardrobeGap } from '@/lib/mirror/gaps'
import { percentOff, saleLine } from './detect'

const SHOWABLE = ['ready', 'live', 'draft']
const CARD = 'item_id, product_name, image_url, price_gbp, was_price_gbp, retailer_url, item_type, colour_family, status, stock_status, stock_class, available, ownership, owner_kind, brand_id, brand:brand_id(name, source_type, size_offset)'
const NAMED = 0.8
/** Pieces one gap may show before the other brands get their turn. */
const GAP_SHOWN = 6

/** Round-robin across groups, the groups in `rank` order, each group in its own order (optionally re-ordered). */
function takeTurns<T>(list: T[], key: (x: T) => string, rank: (k: string) => number, inner?: (q: T[]) => T[]): T[] {
  const queues = new Map<string, T[]>()
  for (const x of list) { const k = key(x); queues.set(k, [...(queues.get(k) ?? []), x]) }
  const order = Array.from(queues.keys()).sort((a, b) => rank(a) - rank(b))
  const qs = order.map((k) => (inner ? inner(queues.get(k)!) : queues.get(k)!))
  const out: T[] = []
  for (let round = 0; out.length < list.length; round++) for (const q of qs) if (q[round]) out.push(q[round])
  return out
}

export interface SalePiece {
  item_id: string
  product_name: string
  brand: string | null
  image_url: string | null
  url: string | null
  price_gbp: number
  was_price_gbp: number
  off: number
  /** Why it is here, in her terms: "YOU OWN ONE COAT", "YOU WERE WAITING FOR THIS". */
  reason: string | null
  why: 'gap' | 'waiting' | 'search' | 'brand'
}

export interface SaleBrand { brand_id: string; name: string; line: string; count: number; named: boolean; started_at: string | null }

export interface SaleView {
  brands: SaleBrand[]
  pieces: SalePiece[]
  /** Her thinnest slots, for the heading: "YOUR WARDROBE IS SHORT OF COATS AND BOOTS". */
  gaps: WardrobeGap[]
}

const EMPTY: SaleView = { brands: [], pieces: [], gaps: [] }

export async function salePicksFor(admin: any, memberId: string, opts: { limit?: number; brandId?: string } = {}): Promise<SaleView> {
  const { data: sales } = await admin.from('brand_sale')
    .select('brand_id, max_off_pct, started_at, brand:brand_id(name)').eq('active', true).eq('paused', false)
  if (!sales?.length) return EMPTY

  const graph = await loadTasteGraph(admin, memberId)
  const mine = ((sales ?? []) as any[]).filter((s) => graph.weights.has(s.brand_id) && !graph.blocked.has(s.brand_id))
    .filter((s) => !opts.brandId || s.brand_id === opts.brandId)
  if (!mine.length) return EMPTY

  const { data: rows } = await admin.from('item').select(CARD)
    .in('brand_id', mine.map((s) => s.brand_id)).in('status', SHOWABLE)
    .not('was_price_gbp', 'is', null).not('image_url', 'is', null).limit(3000)
  const marked = ((rows ?? []) as any[]).filter((it) =>
    it.available !== false && sellable(it) && it.ownership !== 'owned'
    && percentOff(Number(it.price_gbp), Number(it.was_price_gbp)) != null
    && !overHerBudget(graph, it))
  const sizeCtx = await loadMemberSizeProfile(memberId)
  const buyable = await filterItemsForShopper(marked, sizeCtx, { strict: true })
  if (!buyable.length) return EMPTY

  // Her wardrobe, her waiting list, her searches — the three reasons a piece leads.
  const { data: m } = await admin.from('pilot_member').select('member_id, auth_user_id').eq('member_id', memberId).maybeSingle()
  const refs = m ? ownerRefsForMember(m) : []
  const ids = buyable.map((it) => it.item_id)
  const [owned, waiting, searched] = await Promise.all([
    refs.length
      ? admin.from('item').select('item_id, item_type').eq('ownership', 'owned').in('owner_user_id', refs.map((r) => r.id)).limit(2000)
      : Promise.resolve({ data: [] }),
    admin.from('member_saved_item').select('item_id').eq('member_id', memberId).eq('price_watch', true).in('item_id', ids),
    admin.from('saved_search_hit').select('item_id, saved_search!inner(member_id, query)').eq('saved_search.member_id', memberId).in('item_id', ids),
  ])
  const ownedRows = ((owned.data ?? []) as any[])
  const gaps = ownedRows.length ? wardrobeGaps(ownedRows) : []
  const waitingIds = new Set(((waiting.data ?? []) as any[]).map((r) => r.item_id))
  const searchOf = new Map(((searched.data ?? []) as any[]).map((r) => [r.item_id, r.saved_search?.query as string]))

  const pieces: SalePiece[] = buyable.map((it) => {
    const now = Number(it.price_gbp)
    const was = Number(it.was_price_gbp)
    const gap = gapForItemType(it.item_type, gaps)
    const why: SalePiece['why'] = gap ? 'gap' : waitingIds.has(it.item_id) ? 'waiting' : searchOf.has(it.item_id) ? 'search' : 'brand'
    const reason = why === 'gap' ? gapSentence(gap!).toUpperCase()
      : why === 'waiting' ? 'YOU WERE WAITING FOR THIS'
      : why === 'search' ? `FOR YOUR SEARCH “${String(searchOf.get(it.item_id)).toUpperCase()}”`
      : null
    return {
      item_id: it.item_id, product_name: it.product_name ?? 'Piece', brand: it.brand?.name ?? null,
      image_url: it.image_url ?? null, url: it.retailer_url ?? null,
      price_gbp: now, was_price_gbp: was, off: percentOff(now, was) ?? 0, reason, why,
    }
  })

  const rank: Record<SalePiece['why'], number> = { gap: 0, waiting: 1, search: 2, brand: 3 }
  const gapRank = new Map(gaps.map((g, i) => [g.slot, i]))
  const brandOf = new Map(buyable.map((it) => [it.item_id, it.brand_id]))
  const typeOf = new Map(buyable.map((it) => [it.item_id, it.item_type]))
  pieces.sort((a, b) =>
    rank[a.why] - rank[b.why]
    || (a.why === 'gap' ? (gapRank.get(gapForItemType(typeOf.get(a.item_id), gaps)!.slot) ?? 9) - (gapRank.get(gapForItemType(typeOf.get(b.item_id), gaps)!.slot) ?? 9) : 0)
    || Number((graph.weights.get(brandOf.get(b.item_id)!) ?? 0) >= NAMED) - Number((graph.weights.get(brandOf.get(a.item_id)!) ?? 0) >= NAMED)
    || b.off - a.off)

  // Nothing takes over the page. Within each reason the pieces take turns —
  // gap by gap (a coat, boots, a coat…) and brand by brand in her order — and
  // one gap shows six at most before the rest of her brands get a turn. Each
  // queue keeps its deepest markdown first.
  const brandRank = (id: string) => -(graph.weights.get(id) ?? 0)
  const slotOfPiece = (p: SalePiece) => gapForItemType(typeOf.get(p.item_id), gaps)?.slot ?? ''
  const gapPieces = takeTurns(pieces.filter((p) => p.why === 'gap'), slotOfPiece, (k) => gapRank.get(k as any) ?? 9, (q) => takeTurns(q, (p) => brandOf.get(p.item_id)!, brandRank))
  const perSlot = new Map<string, number>()
  const lead: SalePiece[] = []
  const spill: SalePiece[] = []
  for (const p of gapPieces) {
    const k = slotOfPiece(p)
    perSlot.set(k, (perSlot.get(k) ?? 0) + 1)
    ;((perSlot.get(k) ?? 0) <= GAP_SHOWN ? lead : spill).push(p)
  }
  for (const why of ['waiting', 'search'] as const) lead.push(...pieces.filter((p) => p.why === why))
  const rest = takeTurns([...pieces.filter((p) => p.why === 'brand'), ...spill].sort((a, b) => b.off - a.off), (p) => brandOf.get(p.item_id)!, brandRank)
  const capped = [...lead, ...rest]

  const perBrand = new Map<string, number>()
  for (const it of buyable) perBrand.set(it.brand_id, (perBrand.get(it.brand_id) ?? 0) + 1)
  const brands: SaleBrand[] = mine
    .filter((s) => perBrand.get(s.brand_id))
    .map((s) => ({
      brand_id: s.brand_id, name: s.brand?.name ?? 'Your brand', line: saleLine(s.max_off_pct),
      count: perBrand.get(s.brand_id) ?? 0, named: (graph.weights.get(s.brand_id) ?? 0) >= NAMED, started_at: s.started_at ?? null,
    }))
    .sort((a, b) => Number(b.named) - Number(a.named) || (graph.weights.get(b.brand_id) ?? 0) - (graph.weights.get(a.brand_id) ?? 0))

  return { brands, pieces: capped.slice(0, opts.limit ?? 48), gaps }
}
