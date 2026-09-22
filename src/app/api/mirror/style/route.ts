import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { ensureMirrorItem, styleExternalPiece, type SiteProduct, type StyleMode, type StyleResult } from '@/lib/mirror/style'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST { url, title, brand, type, price, image, available, mode: 'wardrobe' | 'inspiration' }
// → { looks, hidden, hero, error }. Called by the /mirror/style pop-out page
// with the member token the extension handed it. Looks are composed fresh but
// cached ten minutes per (member, piece, mode) — a second look is instant.

const cache = new Map<string, { at: number; res: StyleResult }>()
const TTL = 10 * 60_000

export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const mode: StyleMode = b?.mode === 'wardrobe' ? 'wardrobe' : 'inspiration'
  if (typeof b?.url !== 'string' || !/^https?:\/\//.test(b.url) || typeof b?.title !== 'string') {
    return mirrorJson({ error: 'url and title required' }, { status: 400 })
  }
  const product: SiteProduct = {
    url: b.url.slice(0, 500), title: b.title.slice(0, 300),
    brand: typeof b.brand === 'string' ? b.brand.slice(0, 120) : null,
    type: typeof b.type === 'string' ? b.type.slice(0, 80) : null,
    price: typeof b.price === 'number' ? b.price : null,
    image: typeof b.image === 'string' && /^https?:\/\//.test(b.image) ? b.image.slice(0, 800) : null,
    available: typeof b.available === 'boolean' ? b.available : null,
  }
  const t0 = Date.now()
  const ensured = await ensureMirrorItem(product, member)
  if (!ensured.item) return mirrorJson({ looks: [], error: ensured.error ?? 'Could not read this piece' })
  const quick = b?.quick === true
  const key = `${member.member_id}|${ensured.item.item_id}|${mode}${quick ? '|quick' : ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return mirrorJson({ ...hit.res, cached: true, ms: Date.now() - t0 })
  const res = await styleExternalPiece(ensured.item, mode, member, undefined, { check: !quick })
  if (!res.error || res.looks.length) cache.set(key, { at: Date.now(), res })
  return mirrorJson({ ...res, ms: Date.now() - t0 })
}
