import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { takeForMember } from '@/lib/mirror/take'
import type { SiteProduct } from '@/lib/mirror/style'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST { product } → MYRA's take: { confidence, line, parts, fit, herSize, owns }.
export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const p = b?.product ?? b
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
    sizes: Array.isArray(p.sizes) ? p.sizes.slice(0, 60).filter((s: any) => s && typeof s.label === 'string').map((s: any) => ({ label: String(s.label).slice(0, 40), available: !!s.available })) : null,
  }
  const t0 = Date.now()
  const take = await takeForMember(member, product)
  return mirrorJson({ ...take, ms: Date.now() - t0 }, { status: take.error ? 400 : 200 })
}
