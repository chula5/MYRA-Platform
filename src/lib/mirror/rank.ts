// MYRA Mirror — rank a brand site's products for one member.
//
// The page is someone else's; we only decide ORDER. Brand-level first, because
// it needs no catalogue knowledge and so works on her very first visit to a
// retailer. The brand evidence — named, wardrobe, shopped, liked, learned,
// and neighbours of all of those — lives in brand-signals.ts. A size that
// cannot be hers demotes a one-of-one piece hard.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { SEED, brandKey, loadBrandGraph, type BrandGraph } from '@/lib/brand-affinity'
import { classifyExternalProduct } from '@/lib/brand-watch'
import { sizeCategoryFor } from '@/lib/size-canonical'
import { resolveAvailability, OUT_OF_SIZE_PENALTY } from '@/lib/size-match'
import { loadMemberSizeProfile, type ShopperSizeContext } from '@/lib/size-availability'
import { sizeRowsFor, type PageSize } from './sizes'
import { dominantBrand, readPieceFromText, readKnownItem, readStylePrefs, handleOf } from './single-brand'
import { loadStyleModel } from '@/lib/style-brain-store'
import type { StyleModel } from '@/lib/style-brain'
import { loadMemberTaste } from '@/app/admin/private-stylist/actions'
import type { MirrorMember } from './auth'

import { memberBrandSignals, signalFor, type BrandWhy, type BrandSignal } from './brand-signals'
export type { BrandWhy, BrandSignal }
export type BrandScore = BrandSignal

export interface PageProduct {
  key: string // the tile's handle / canonical key — echoed back so the client can find it
  brand?: string | null
  title?: string | null
  type?: string | null
  price?: number | null
  url?: string | null
  /** Shopify variants of the size option, collapsed per label. */
  sizes?: PageSize[] | null
  available?: boolean | null
}
export type SizeFit = 'yes' | 'no' | 'sold_out' | 'unknown'
export interface ProductScore { key: string; score: number; confidence: number; why: BrandWhy; fit: SizeFit; herSize: string | null; brand: string | null; reasons?: string[] }

// ── brand graph cache (10 min) — the rank call must feel instant ────────────
let graphCache: { at: number; graph: BrandGraph } | null = null
export async function cachedGraph(admin: any): Promise<BrandGraph> {
  if (graphCache && Date.now() - graphCache.at < 10 * 60_000) return graphCache.graph
  const graph = await loadBrandGraph(admin)
  graphCache = { at: Date.now(), graph }
  return graph
}

/** Every brand label on the page → her signal for it (see brand-signals.ts). */
export async function scoreBrandsForMember(
  member: MirrorMember, names: string[], adminIn?: any,
): Promise<Map<string, BrandScore>> {
  const admin = adminIn ?? (createAdminClient() as any)
  const graph = await cachedGraph(admin)
  const sig = await memberBrandSignals(member, graph, admin)
  const out = new Map<string, BrandScore>()
  for (const raw of names) {
    const key = brandKey(raw ?? '')
    if (!key || out.has(key)) continue
    out.set(key, signalFor(sig, graph, raw))
  }
  return out
}

// ── size fit — the feed's own machinery, fed from the page ──────────────────
// Pre-owned is one-of-one, so a wrong size is a wrong piece (×0.25). A
// replenishable piece sold out in her size sorts down but stays (×0.65,
// mirroring OUT_OF_SIZE_PENALTY). Unknown sizing never demotes.
const FIT_FACTOR: Record<SizeFit, number> = { yes: 1, unknown: 1, sold_out: +(1 - OUT_OF_SIZE_PENALTY).toFixed(2), no: 0.25 }

let sizeCache = new Map<string, { at: number; ctx: ShopperSizeContext }>()
async function cachedSizeProfile(memberId: string): Promise<ShopperSizeContext> {
  const hit = sizeCache.get(memberId)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.ctx
  const ctx = await loadMemberSizeProfile(memberId)
  sizeCache.set(memberId, { at: Date.now(), ctx })
  return ctx
}
export function forgetSizeProfile(memberId: string) { sizeCache.delete(memberId) }

// Her row + the composer's MemberTaste — only needed on single-brand pages.
const memberCache = new Map<string, { at: number; row: any; taste: any }>()
async function cachedMemberTaste(admin: any, memberId: string): Promise<{ row: any; taste: any } | null> {
  const hit = memberCache.get(memberId)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit
  const { data: row } = await admin.from('pilot_member').select('*').eq('member_id', memberId).single()
  if (!row) return null
  let taste: any = null
  try { taste = await loadMemberTaste(admin, row) } catch { taste = null }
  const v = { at: Date.now(), row, taste }
  memberCache.set(memberId, v)
  return v
}

const baseOf = (url: string) => { try { const u = new URL(url); return `${u.origin}${u.pathname}` } catch { return url.split(/[?#]/)[0] } }

// Style Brain — the curator's own YES / SKIP history, one model site-wide.
let brainCache: { at: number; model: StyleModel | null } | null = null
async function cachedStyleModel(): Promise<StyleModel | null> {
  if (brainCache && Date.now() - brainCache.at < 10 * 60_000) return brainCache.model
  let model: StyleModel | null = null
  try { model = await loadStyleModel() } catch { model = null }
  brainCache = { at: Date.now(), model }
  return model
}

/** MYRA's item type for a page product — the same rules Brand Watch uses on a scan. */
export function itemTypeFor(p: PageProduct): string | null {
  try {
    return classifyExternalProduct({
      url: p.url ?? 'https://x/products/x', title: p.title ?? '', description: '', category: p.type ?? '',
      brand: p.brand ?? null, price: p.price ?? null, currency: null, images: [], available: true,
    }).itemType
  } catch { return null }
}

export function fitFor(p: PageProduct, ctx: ShopperSizeContext): { fit: SizeFit; herSize: string | null } {
  if (!ctx.hasProfile) return { fit: 'unknown', herSize: null }
  const itemType = itemTypeFor(p)
  const category = sizeCategoryFor(itemType)
  const { rows, unique } = sizeRowsFor(p.sizes, p.title, category)
  if (!rows.length) return { fit: 'unknown', herSize: null }
  const a = resolveAvailability({ item_type: itemType, stock_class: unique ? 'unique' : 'replenishable' }, rows, ctx.profile)
  if (a.quality === 'unknown') return { fit: 'unknown', herSize: null }
  if (a.wearable) return { fit: 'yes', herSize: a.herSizeLabel }
  return { fit: unique ? 'no' : 'sold_out', herSize: a.herSizeLabel }
}

/** One call per page: brand scores + a per-tile score the client sorts by. */
export async function rankPageForMember(member: MirrorMember, products: PageProduct[], host?: string | null) {
  const admin = createAdminClient() as any
  const [brandScores, sizeCtx] = await Promise.all([
    scoreBrandsForMember(member, products.map((p) => p.brand ?? ''), admin),
    cachedSizeProfile(member.member_id),
  ])

  // A page that is all one brand: rank the pieces, not the label.
  const single = dominantBrand(products)
  let pieceOf = new Map<string, { piece: number | null; text: number; reasons: string[] }>()
  if (single) {
    const mt = await cachedMemberTaste(admin, member.member_id)
    if (mt) {
      const prefs = readStylePrefs(mt.row)
      const tasteVector: number[] | null = Array.isArray(mt.row.taste_vector) ? mt.row.taste_vector.map(Number) : null
      const curator = !!member.auth_user_id && member.auth_user_id === process.env.ADMIN_USER_ID
      const graph = await cachedGraph(admin)
      const brain = curator ? { model: await cachedStyleModel(), priceTier: graph.byId.get(brandScores.get(single)?.brandId ?? '')?.price_tier ?? null } : undefined
      // Layer 2: tiles MYRA already knows as items — matched by Shopify handle,
      // so www. and ?variant= never hide a match. The brand's own items first
      // (one query), else anything on this host.
      const known = new Map<string, any>()
      const brandId = brandScores.get(single)?.brandId ?? null
      const hostLike = host ? `%${host.replace(/^www\./, '')}/products/%` : null
      const q = admin.from('item').select('*, brand(*)').neq('status', 'archived').limit(2000)
      const { data: rows } = brandId ? await q.eq('brand_id', brandId) : hostLike ? await q.ilike('retailer_url', hostLike) : { data: [] }
      for (const it of rows ?? []) { const h = handleOf(it.retailer_url); if (h && !known.has(h)) known.set(h, it) }
      const unknown: PageProduct[] = []
      for (const p of products) {
        const b = brandScores.get(brandKey(p.brand ?? ''))
        const text = readPieceFromText(p, prefs, mt.taste, b?.brandId, brain)
        const item = known.get(handleOf(p.url) ?? p.key)
        if (item && mt.taste && (item.structure != null || item.status === 'ready' || item.status === 'live')) {
          const k = readKnownItem(item, mt.taste, tasteVector, { curator })
          pieceOf.set(p.key, { piece: 0.6 * k.piece + 0.4 * Math.max(0, Math.min(1, 0.5 + text.text)), text: text.text, reasons: [...k.reasons, ...text.reasons.filter((r) => !k.reasons.includes(r))].slice(0, 3) })
        } else {
          pieceOf.set(p.key, { piece: null, text: text.text, reasons: text.reasons })
          if (p.url && p.title && !item) unknown.push(p)
        }
      }
      // Queue the unknown for the nightly pass — best effort, table arrives with 0060.
      if (unknown.length) {
        try {
          await admin.from('mirror_page_product').upsert(unknown.slice(0, 200).map((p) => ({
            host: host ?? (p.url ? new URL(p.url).host : 'unknown'), url: baseOf(p.url!), brand_name: p.brand ?? null, title: p.title,
            product_type: p.type ?? null, price_gbp: p.price ?? null, member_id: member.member_id,
          })), { onConflict: 'url', ignoreDuplicates: true })
        } catch { /* pre-0060 */ }
      }
    }
  }

  const scored: ProductScore[] = products.map((p) => {
    const b = brandScores.get(brandKey(p.brand ?? '')) ?? { score: SEED.baseline, why: 'baseline' as BrandWhy }
    const { fit, herSize } = fitFor(p, sizeCtx)
    let base = b.score
    let reasons: string[] | undefined
    const pr = pieceOf.get(p.key)
    if (pr) {
      // Brand is the floor everyone on the page shares; the piece decides the order.
      base = pr.piece != null ? Math.max(0.02, Math.min(1, 0.5 * b.score + 0.5 * pr.piece)) : Math.max(0.02, Math.min(1, b.score * (1 + pr.text)))
      reasons = pr.reasons
    }
    const score = +(base * FIT_FACTOR[fit]).toFixed(4)
    // What she sees as "MYRA 92%": the same number the sort uses, nothing hidden behind it.
    return { key: p.key, score, confidence: Math.round(score * 100), why: b.why, fit, herSize, brand: p.brand ?? null, ...(reasons ? { reasons } : {}) }
  })
  const brands = Object.fromEntries([...brandScores.entries()].map(([k, v]) => [k, v]))
  return { brands, products: scored, sizes: { hasProfile: sizeCtx.hasProfile }, singleBrand: single }
}
