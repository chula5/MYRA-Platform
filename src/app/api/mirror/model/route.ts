import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { requestModelShot, readModelShot } from '@/lib/mirror/model-shot'
import type { SiteProduct } from '@/lib/mirror/style'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// SEE ON A MODEL, for the Mirror's card.
//   POST { url, title, brand, type, price, image }  → the piece's shot, made
//        here when the renderer is on this machine, else queued for the Mac.
//   GET  ?item=<item_id>                            → the same row, for polling.
// Both answer { itemId, status: queued|rendering|done|failed, imageUrl, error, renderer }.

export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
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
  const res = await requestModelShot(product, member)
  return mirrorJson({ ...res, ms: Date.now() - t0 })
}

export async function GET(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  const item = req.nextUrl.searchParams.get('item') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(item)) return mirrorJson({ error: 'item required' }, { status: 400 })
  const shot = await readModelShot(item)
  if (!shot) return mirrorJson({ error: 'no ask for this piece' }, { status: 404 })
  return mirrorJson(shot)
}
