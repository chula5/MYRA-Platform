import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { saveForMember, unsaveForMember } from '@/lib/mirror/save'
import type { SiteProduct } from '@/lib/mirror/style'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// POST { product } saves; DELETE { url } unsaves.
export async function OPTIONS() { return mirrorOptions() }

function productFrom(p: any): SiteProduct | null {
  if (!p || typeof p.url !== 'string' || !/^https?:\/\//.test(p.url) || typeof p.title !== 'string') return null
  return {
    url: p.url.slice(0, 500), title: p.title.slice(0, 300),
    brand: typeof p.brand === 'string' ? p.brand.slice(0, 120) : null,
    type: typeof p.type === 'string' ? p.type.slice(0, 80) : null,
    price: typeof p.price === 'number' ? p.price : null,
    image: typeof p.image === 'string' && /^https?:\/\//.test(p.image) ? p.image.slice(0, 800) : null,
    available: typeof p.available === 'boolean' ? p.available : null,
    sizes: Array.isArray(p.sizes) ? p.sizes.slice(0, 60).filter((s: any) => s && typeof s.label === 'string').map((s: any) => ({ label: String(s.label).slice(0, 40), available: !!s.available })) : null,
  }
}

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const product = productFrom(b?.product)
  if (!product) return mirrorJson({ error: 'product.url and product.title required' }, { status: 400 })
  const res = await saveForMember(member, product)
  return mirrorJson(res, { status: res.error ? 400 : 200 })
}

export async function DELETE(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  if (typeof b?.url !== 'string') return mirrorJson({ error: 'url required' }, { status: 400 })
  return mirrorJson(await unsaveForMember(member, b.url))
}
