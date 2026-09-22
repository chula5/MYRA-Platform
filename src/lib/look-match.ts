import 'server-only'

// MATCH — find what is closest to a picture.
//
// Every outfit MYRA knows lives in the same 34-number space: the pictures she
// keeps, the photographs of what she wears, the looks MYRA composes, and (built
// from its scored dimensions) every item in the library. So "find me pieces
// like this" is one cosine away, and it is the same maths the composer uses to
// decide whether a piece belongs in one of her looks.
//
// Matching reads; it never writes and never learns. What she does with a match
// is what teaches.

import { createAdminClient } from '@/lib/supabase-server'
import { itemPseudoVector } from '@/lib/brand-affinity'
import { cosine } from '@/lib/taste-vector'
import type { ItemWithBrand } from '@/lib/admin-queries'

export interface MatchedItem {
  item_id: string
  product_name: string
  brand: string | null
  item_type: string | null
  colour_family: string | null
  image_url: string | null
  price_gbp: number | null
  retailer_url: string | null
  owned: boolean
  /** 0..1 — how close this piece sits to the picture. */
  closeness: number
}

export interface MatchedOutfit {
  outfit_id: string
  image_url: string | null
  closeness: number
}

export interface MatchFilters {
  /** Only these kinds of piece (item_type values). */
  types?: string[]
  /** Her own wardrobe as well as the library. Owned pieces are marked. */
  owners?: string[]
  limit?: number
}

const parseVector = (v: unknown): number[] | null => {
  if (Array.isArray(v)) return v as number[]
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : null } catch { return null }
  }
  return null
}

/** The vector behind one of her pictures — an inspiration image or an archival look. */
export async function vectorForPicture(kind: 'inspiration' | 'archival', id: string): Promise<number[] | null> {
  const admin = createAdminClient() as any
  if (kind === 'inspiration') {
    const { data } = await admin.from('inspiration_image').select('vector').eq('image_id', id).maybeSingle()
    return parseVector(data?.vector)
  }
  const { data } = await admin.from('archival_look').select('taste_vector').eq('look_id', id).maybeSingle()
  return parseVector(data?.taste_vector)
}

/** The pieces closest to a picture, best first. */
export async function matchItems(vector: number[], f: MatchFilters = {}): Promise<MatchedItem[]> {
  if (!vector?.length) return []
  const admin = createAdminClient() as any
  const limit = Math.max(1, Math.min(f.limit ?? 24, 60))

  let q = admin.from('item').select('*, brand(name)').in('status', ['ready', 'live']).not('image_url', 'is', null).limit(2000)
  if (f.types?.length) q = q.in('item_type', f.types)
  const [{ data: library }, ownedRes] = await Promise.all([
    q,
    f.owners?.length
      ? admin.from('item').select('*, brand(name)').eq('ownership', 'owned').in('owner_user_id', f.owners).neq('status', 'archived').limit(500)
      : Promise.resolve({ data: [] }),
  ])

  const rows = [...((library ?? []) as any[]), ...((ownedRes?.data ?? []) as any[])]
  const seen = new Set<string>()
  const scored: MatchedItem[] = []
  for (const it of rows) {
    if (seen.has(it.item_id)) continue
    seen.add(it.item_id)
    const v = itemPseudoVector(it as ItemWithBrand)
    if (v.length !== vector.length) continue
    scored.push({
      item_id: it.item_id,
      product_name: it.product_name ?? 'Piece',
      brand: it.brand?.name ?? null,
      item_type: it.item_type ?? null,
      colour_family: it.colour_family ?? null,
      image_url: it.image_url ?? null,
      price_gbp: it.price_gbp ?? null,
      retailer_url: it.retailer_url ?? null,
      owned: it.ownership === 'owned',
      closeness: cosine(v, vector),
    })
  }
  return scored.sort((a, b) => b.closeness - a.closeness).slice(0, limit)
}

/** The outfits MYRA has already made that are closest to a picture. */
export async function matchOutfits(vector: number[], limit = 8): Promise<MatchedOutfit[]> {
  if (!vector?.length) return []
  const admin = createAdminClient() as any
  const { data } = await admin.from('outfit').select('outfit_id, image_url, taste_vector').not('taste_vector', 'is', null).limit(2000)
  return ((data ?? []) as any[])
    .map((o) => ({ outfit_id: o.outfit_id, image_url: o.image_url ?? null, v: parseVector(o.taste_vector) }))
    .filter((o) => o.v && o.v.length === vector.length)
    .map((o) => ({ outfit_id: o.outfit_id, image_url: o.image_url, closeness: cosine(o.v!, vector) }))
    .sort((a, b) => b.closeness - a.closeness)
    .slice(0, Math.max(1, Math.min(limit, 24)))
}
