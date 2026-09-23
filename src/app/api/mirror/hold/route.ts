import { NextRequest } from 'next/server'
import { adminFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { holdForMember } from '@/lib/mirror/hold'
import type { SiteProduct } from '@/lib/mirror/style'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST { product, look? } — stylist mode only. Holds the piece (or a composed
// look around it) in the member's open "held" delivery as an unapproved look.
export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const me = await adminFromRequest(req)
  if (!me) return mirrorJson({ error: 'stylist only' }, { status: 403 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const p = b?.product
  if (!p || typeof p.url !== 'string' || !/^https?:\/\//.test(p.url) || typeof p.title !== 'string') {
    return mirrorJson({ error: 'product.url and product.title required' }, { status: 400 })
  }
  const product: SiteProduct = {
    url: p.url.slice(0, 500), title: p.title.slice(0, 300),
    brand: typeof p.brand === 'string' ? p.brand.slice(0, 120) : null,
    type: typeof p.type === 'string' ? p.type.slice(0, 80) : null,
    price: typeof p.price === 'number' ? p.price : null,
    image: typeof p.image === 'string' && /^https?:\/\//.test(p.image) ? p.image.slice(0, 800) : null,
    available: typeof p.available === 'boolean' ? p.available : null,
  }
  const look = Array.isArray(b.look) ? b.look.slice(0, 8).filter((it: any) => it && typeof it.product_name === 'string') : null
  const res = await holdForMember(me, product, look)
  return mirrorJson(res, { status: res.error ? 400 : 200 })
}
