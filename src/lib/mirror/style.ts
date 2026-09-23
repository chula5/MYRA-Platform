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
import { readStylePrefs, effectiveWeights, normalise, lookTasteVector } from '@/lib/pilot-stylist'
import { occasionsForMember, OCCASION_LABEL } from '@/lib/client-occasions'
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
  // ONE PIECE, THREE LIVES. A blazer she is looking at is worth having only if
  // she can see where she would wear it, so the panel answers in her own
  // occasions — the ones she actually dresses for, most often first — rather
  // than three variations on the same afternoon.
  const occasionIds = occasionsForMember(row.occasions).filter((id) => id !== 'kids').slice(0, LOOKS)
  const ownedMode = mode === 'wardrobe' ? 'blend' : 'retail_only'
  const perOccasion: { id: string | null; label: string; look: any }[] = []
  for (const id of occasionIds.length ? occasionIds : [null]) {
    const occ = id
      ? { id: id as any, vector: lookTasteVector(normalise(effectiveWeights(row.room_weights, id as any, row.work_dress_code))), climate: null }
      : undefined
    for (const look of composeMemberVariants(taste, pool as any, hero.item_id, 2, occ, lens, history, { ownedMode })) {
      perOccasion.push({ id, label: id ? (OCCASION_LABEL[id] ?? id) : '', look })
    }
  }
  const composed = perOccasion.map((p) => p.look)
  if (!composed.length) {
    return { looks: [], hero: heroView, error: mode === 'wardrobe' ? 'Nothing in your wardrobe goes with this piece yet' : 'Nothing in MYRA goes with this piece in your size right now' }
  }
  /**
   * One look per occasion, best first — each occasion composes a pair, so the
   * second is its reserve. Two occasions that would show her the same outfit
   * are not two answers: the later one takes its reserve instead.
   */
  const sigOf = (i: number) => composed[i].items.map((x: any) => x.item_id).sort().join('|')
  const oneEach = (order: number[]) => {
    const takenOcc = new Set<string>()
    const takenLook = new Set<string>()
    const out: number[] = []
    for (const i of order) {
      const occ = perOccasion[i].id ?? ''
      if (takenOcc.has(occ) || takenLook.has(sigOf(i))) continue
      takenOcc.add(occ)
      takenLook.add(sigOf(i))
      out.push(i)
    }
    // Room left over (she dresses for fewer occasions than we show): fill it
    // with the reserves rather than showing her two looks when three passed.
    for (const i of order) {
      if (out.length >= LOOKS) break
      if (out.includes(i) || takenLook.has(sigOf(i))) continue
      takenLook.add(sigOf(i))
      out.push(i)
    }
    return out
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
      looks: oneEach(composed.map((_, i) => i)).slice(0, LOOKS).map((i) => ({
        look_id: null,
        image_url: null,
        occasion_id: perOccasion[i].id,
        occasion_label: perOccasion[i].label,
        items: withImages(composed[i].items),
        why: whyThisSuitsHer(composed[i].items.map((it) => ({ ...(dimsAll.get(it.item_id ?? '') ?? {}), product_name: it.product_name, owned: !!it.owned })), prefsAll),
      })),
    }
  }
  const judged = await judgeLooksForMember(admin, member.member_id, composed, 'unknown')
  const rank = (i: number) => (judged[i].check?.verdict === 'works' ? 0 : judged[i].check ? 1 : 2)
  const survived = composed.map((_, i) => i)
    .filter((i) => judged[i].check?.verdict !== 'clashes' && !hasPieceOutOfSize(judged[i]))
    .sort((a, b) => rank(a) - rank(b) || a - b)
  const passing = oneEach(survived)
  const dims = new Map<string, any>(pool.map((i) => [i.item_id, i]))
  const prefs = readStylePrefs(row)
  return {
    hero: heroView,
    checked: true,
    hidden: composed.length - survived.length,
    looks: passing.slice(0, LOOKS).map((i) => ({
      look_id: null,
      image_url: null,
      occasion_id: perOccasion[i].id,
      occasion_label: perOccasion[i].label,
      // Each piece carries its picture: the pop-out and the extension's panel
      // both show the look, and a composed LookItem has no image of its own.
      items: composed[i].items.map((it) => ({ ...it, image_url: dims.get(it.item_id ?? '')?.image_url ?? null })),
      why: whyThisSuitsHer(composed[i].items.map((it) => ({ ...(dims.get(it.item_id ?? '') ?? {}), product_name: it.product_name, owned: !!it.owned })), prefs),
    })),
    ...(passing.length ? {} : { error: 'Nothing passed the check for this piece right now' }),
  }
}
