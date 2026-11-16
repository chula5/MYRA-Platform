// THE OTHER PICTURES OF A PIECE — what the sheet shows beside the one photo
// the library keeps.
//
// The library holds one picture per piece. The shop usually has more (the
// back, the detail, on a model), and MYRA may have shot it on a model for the
// Mirror. When she opens a piece in the mirror those pictures are fetched
// once, kept in memory for a while, and drawn as a strip under the piece —
// so she sees it properly before she ever leaves MYRA (Chloe, 2026-11-11).
//
// Shopify shops answer <product page>.json with every picture of the product;
// anything else (bot-walled brands, other platforms) simply shows the one
// picture. A fetch that fails or dawdles costs her nothing: the sheet has
// already drawn.

import 'server-only'
import { readModelShot } from '@/lib/mirror/model-shot'

const TTL_MS = 6 * 60 * 60_000
const FETCH_MS = 5_000
const MAX_PHOTOS = 8

interface Kept { at: number; photos: string[] }
const g = globalThis as unknown as { __myraPieceGallery?: Map<string, Kept> }
const kept = (g.__myraPieceGallery ??= new Map())

export interface PieceGallery {
  /** The piece on a model, shot by MYRA for the Mirror — drawn first when it exists. */
  model_shot: string | null
  /** The shop's own pictures of it, the library's one first. */
  photos: string[]
}

function sameImage(a: string, b: string): boolean {
  const strip = (u: string) => u.replace(/^https?:/, '').split('?')[0].replace(/_(\d+x\d*|\d*x\d+|small|medium|large|grande|master|original)(?=\.[a-z]+$)/i, '')
  return strip(a) === strip(b)
}

/** A Shopify product page → its JSON twin, or null when the URL is not shaped like one. */
function shopifyJsonUrl(productUrl: string): string | null {
  try {
    const u = new URL(productUrl)
    const m = u.pathname.match(/^(.*\/products\/[^/]+?)(?:\.json)?\/?$/)
    if (!m) return null
    return `${u.origin}${m[1]}.json`
  } catch { return null }
}

async function shopPhotos(productUrl: string | null): Promise<string[]> {
  if (!productUrl) return []
  const json = shopifyJsonUrl(productUrl)
  if (!json) return []
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), FETCH_MS)
  try {
    const res = await fetch(json, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) MYRA-BrandWatch/1.0', Accept: 'application/json' },
      cache: 'no-store',
      signal: ctl.signal,
    })
    if (!res.ok) return []
    const body: any = await res.json().catch(() => null)
    const images: any[] = Array.isArray(body?.product?.images) ? body.product.images : []
    const out: string[] = []
    for (const im of images) {
      const src = typeof im?.src === 'string' ? im.src : typeof im === 'string' ? im : null
      if (!src) continue
      const abs = src.startsWith('//') ? `https:${src}` : src
      if (/^https?:\/\//.test(abs) && !out.some((x) => sameImage(x, abs))) out.push(abs)
      if (out.length >= MAX_PHOTOS) break
    }
    return out
  } catch {
    return []
  } finally { clearTimeout(t) }
}

/**
 * Every picture MYRA can show of one piece: her model shot if there is one,
 * then the shop's photos with the library's picture first. Shop photos are
 * remembered for six hours per piece.
 */
export async function pieceGallery(piece: { item_id: string; image_url: string | null; url: string | null }): Promise<PieceGallery> {
  const now = Date.now()
  const had = kept.get(piece.item_id)
  const photosP = had && now - had.at < TTL_MS
    ? Promise.resolve(had.photos)
    : shopPhotos(piece.url).then((photos) => { kept.set(piece.item_id, { at: now, photos }); return photos })
  const shotP = readModelShot(piece.item_id).catch(() => null)
  const photos: string[] = await photosP
  const shot = await shotP
  const all = piece.image_url ? [piece.image_url, ...photos.filter((p) => !sameImage(p, piece.image_url as string))] : photos
  return {
    model_shot: shot?.status === 'done' && shot.imageUrl ? shot.imageUrl : null,
    photos: all.slice(0, MAX_PHOTOS + 1),
  }
}
