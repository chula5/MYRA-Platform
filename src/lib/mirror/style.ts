// MYRA Mirror — style a piece from someone else's site.
//
// Two asks on a brand site's product: WITH MY WARDROBE (looks around it from
// what she owns) and STYLE INSPIRATION (looks around it from MYRA's own
// pieces). Same composer, same look check, same "why" as the Dressing Room's
// STYLE THIS — see styleOwnedPiece in private-stylist/actions.ts. The only
// new work is letting the hero be a product MYRA has never seen: it becomes a
// draft item row (never in the feed), scored inline, then composed around.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { classifyExternalProduct } from '@/lib/brand-watch'
import { insertItemTolerantly } from '@/lib/wardrobe/store'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import { analyseProductImage } from '@/app/admin/items/analyse-image'
import { scoreUpdateFor } from '@/lib/item-scoring'
import { loadBrandGraph, resolveBrandNames } from '@/lib/brand-affinity'
import { composeMemberVariants } from '@/lib/pilot-composer'
import { judgeLooksForMember, hasPieceOutOfSize } from '@/lib/look-check'
import { whyThisSuitsHer } from '@/lib/look-why'
import { readStylePrefs } from '@/lib/pilot-stylist'
import {
  loadComposableLibrary, loadMemberTaste, loadPersonaLens, loadComposeHistory, type StyledLook,
} from '@/app/admin/private-stylist/actions'
import type { MirrorMember } from './auth'

export type StyleMode = 'wardrobe' | 'inspiration'
export interface SiteProduct {
  url: string
  title: string
  brand?: string | null
  type?: string | null
  price?: number | null
  image?: string | null
  available?: boolean | null
  sizes?: { label: string; available: boolean }[] | null
}
export interface StyleResult {
  looks: StyledLook[]
  hidden?: number
  error?: string
  hero?: { item_id: string; product_name: string; image_url: string | null }
  /** False when the looks have not been through MYRA's eye yet (the quick pass). */
  checked?: boolean
}

const LOOKS = 3
const MIN_WARDROBE = 6

/** The site's URL without query/hash — how we recognise the same piece next time. */
function baseUrl(url: string): string {
  try { const u = new URL(url); return `${u.origin}${u.pathname}` } catch { return url.split(/[?#]/)[0] }
}

/**
 * The item row for a site product — found by URL, or created and scored. A
 * mirror item is `draft` with `source = 'mirror'`: it can be composed around
 * for her, and it never enters the feed or the library.
 */
export async function ensureMirrorItem(p: SiteProduct, member: MirrorMember, adminIn?: any, opts: { score?: boolean } = {}): Promise<{ item?: any; error?: string }> {
  const admin = adminIn ?? (createAdminClient() as any)
  const base = baseUrl(p.url)
  const { data: existing } = await admin.from('item').select('*, brand(*)').like('retailer_url', `${base}%`).neq('status', 'archived').limit(1)
  let item = existing?.[0] ?? null

  if (!item) {
    if (!p.image) return { error: 'No picture of this piece to work from' }
    const scanned = classifyExternalProduct({
      url: p.url, title: p.title, description: '', category: p.type ?? '', brand: p.brand ?? null,
      price: p.price ?? null, currency: null, images: [p.image], available: p.available !== false,
    })
    if (!scanned.itemType) return { error: "MYRA can't tell what kind of piece this is yet" }
    if (scanned.nonFashion) return { error: 'Not a piece MYRA styles' }
    const graph = await loadBrandGraph(admin)
    const brand = p.brand ? resolveBrandNames(graph, [p.brand]).matched[0] : undefined
    const host = (() => { try { return new URL(p.url).host } catch { return '' } })()
    const ins = await insertItemTolerantly(admin, {
      brand_id: brand?.brand_id ?? null,
      item_type: scanned.itemType,
      product_name: p.title.slice(0, 200),
      retailer_url: base,
      image_url: p.image,
      price: p.price ?? null,
      currency: 'GBP',
      price_gbp: p.price ?? null,
      colour_family: scanned.colourFamily,
      material_category: scanned.materialCategory,
      material_primary: scanned.materialPrimary,
      stock_status: p.available === false ? 'out_of_stock' : 'in_stock',
      available: p.available !== false,
      status: 'draft',
      source: 'retailer_api', // item_source_enum has no 'mirror' — discovery_source + admin_notes carry the provenance
      in_inventory: false,
      discovery_source: 'mirror',
      admin_notes: `MYRA Mirror — ${member.name} asked to style this on ${host}${brand ? '' : p.brand ? ` (brand "${p.brand}" not in MYRA)` : ''}`,
    })
    if (!ins.itemId) return { error: ins.error ?? 'Could not keep a note of this piece' }
    const { data: created } = await admin.from('item').select('*, brand(*)').eq('item_id', ins.itemId).single()
    item = created
  }

  // Score it so the composer can read its shape, structure and colour depth.
  // A save skips this (it must be instant); the first take or style scores it.
  if (opts.score !== false && item && item.structure == null && item.image_url) {
    const read = await analyseProductImage(String(item.image_url))
    if (read.data) {
      const update = scoreUpdateFor(item, read.data as any)
      if (Object.keys(update).length) {
        await admin.from('item').update({ ...update, scored_at: new Date().toISOString() }).eq('item_id', item.item_id)
        item = { ...item, ...update }
      }
    }
  }
  return { item }
}

/** Looks around a mirror item, in her wardrobe or in MYRA's pieces — the STYLE THIS pipeline with a foreign hero. */
export async function styleExternalPiece(
  hero: any,
  mode: StyleMode,
  member: MirrorMember,
  adminIn?: any,
  opts: { check?: boolean } = {},
): Promise<StyleResult> {
  const admin = adminIn ?? (createAdminClient() as any)
  const { data: row } = await admin.from('pilot_member').select('*').eq('member_id', member.member_id).single()
  if (!row) return { looks: [], error: 'Member not found' }
  const heroView = { item_id: hero.item_id, product_name: hero.product_name, image_url: hero.image_url ?? null }

  const library = await loadComposableLibrary(row)
  let pool: any[]
  if (mode === 'wardrobe') {
    const owned = library.filter((i) => isOwnedItem(i as any))
    if (owned.length < MIN_WARDROBE) return { looks: [], hero: heroView, error: 'Import your wardrobe in MYRA to style with it' }
    pool = [...owned, hero]
  } else {
    pool = [...library.filter((i) => !isOwnedItem(i as any)), hero]
  }

  const [taste, lens, history] = await Promise.all([
    loadMemberTaste(admin, row),
    loadPersonaLens(admin, member.member_id),
    loadComposeHistory(admin, member.member_id),
  ])
  const composed = composeMemberVariants(taste, pool as any, hero.item_id, LOOKS + 2, undefined, lens, history, { ownedMode: mode === 'wardrobe' ? 'blend' : 'retail_only' })
  if (!composed.length) {
    return { looks: [], hero: heroView, error: mode === 'wardrobe' ? 'Nothing in your wardrobe goes with this piece yet' : 'Nothing in MYRA goes with this piece in your size right now' }
  }
  const dimsAll = new Map<string, any>((pool as any[]).map((i) => [i.item_id, i]))
  const prefsAll = readStylePrefs(row)
  const withImages = (items: any[]) => items.map((it) => ({ ...it, image_url: dimsAll.get(it.item_id ?? '')?.image_url ?? null }))
  // The quick pass: what MYRA composed, before its eye has been over it. The
  // panel shows these in a few seconds and replaces them with the checked set.
  if (opts.check === false) {
    return {
      hero: heroView,
      checked: false,
      looks: composed.slice(0, LOOKS).map((c) => ({
        look_id: null,
        image_url: null,
        items: withImages(c.items),
        why: whyThisSuitsHer(c.items.map((it) => ({ ...(dimsAll.get(it.item_id ?? '') ?? {}), product_name: it.product_name, owned: !!it.owned })), prefsAll),
      })),
    }
  }
  const judged = await judgeLooksForMember(admin, member.member_id, composed, 'unknown')
  const rank = (i: number) => (judged[i].check?.verdict === 'works' ? 0 : judged[i].check ? 1 : 2)
  const passing = composed.map((_, i) => i)
    .filter((i) => judged[i].check?.verdict !== 'clashes' && !hasPieceOutOfSize(judged[i]))
    .sort((a, b) => rank(a) - rank(b) || a - b)
  const dims = new Map<string, any>(pool.map((i) => [i.item_id, i]))
  const prefs = readStylePrefs(row)
  return {
    hero: heroView,
    checked: true,
    hidden: composed.length - passing.length,
    looks: passing.slice(0, LOOKS).map((i) => ({
      look_id: null,
      image_url: null,
      // Each piece carries its picture: the pop-out and the extension's panel
      // both show the look, and a composed LookItem has no image of its own.
      items: composed[i].items.map((it) => ({ ...it, image_url: dims.get(it.item_id ?? '')?.image_url ?? null })),
      why: whyThisSuitsHer(composed[i].items.map((it) => ({ ...(dims.get(it.item_id ?? '') ?? {}), product_name: it.product_name, owned: !!it.owned })), prefs),
    })),
    ...(passing.length ? {} : { error: 'Nothing passed the check for this piece right now' }),
  }
}
