import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { rankPageForMember, type PageProduct } from '@/lib/mirror/rank'

export const dynamic = 'force-dynamic'

// POST { host, products: [{ key, brand, title, type, price, url }] }
// → { member: { name }, brands: { <brandKey>: { score, why } }, products: [{ key, score, why, fit }] }
// Brand-level only in Phase 0: answers in one round trip with no catalogue
// knowledge, which is what makes a first visit to a retailer work.

const MAX_PRODUCTS = 600

export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const raw: unknown[] = Array.isArray(body?.products) ? body.products.slice(0, MAX_PRODUCTS) : []
  const products: PageProduct[] = raw
    .filter((p: any) => p && typeof p.key === 'string' && p.key.length <= 300)
    .map((p: any) => ({
      key: p.key,
      brand: typeof p.brand === 'string' ? p.brand.slice(0, 120) : null,
      title: typeof p.title === 'string' ? p.title.slice(0, 300) : null,
      type: typeof p.type === 'string' ? p.type.slice(0, 80) : null,
      price: typeof p.price === 'number' ? p.price : null,
      url: typeof p.url === 'string' ? p.url.slice(0, 500) : null,
      available: typeof p.available === 'boolean' ? p.available : null,
      sizes: Array.isArray(p.sizes)
        ? p.sizes.slice(0, 60)
          .filter((s: any) => s && typeof s.label === 'string' && s.label.length <= 40)
          .map((s: any) => ({ label: s.label, available: !!s.available }))
        : null,
    }))
  const t0 = Date.now()
  const ranked = await rankPageForMember(member, products, typeof body?.host === 'string' ? body.host.slice(0, 200) : null)
  return mirrorJson({ member: { name: member.name }, ...ranked, ms: Date.now() - t0 })
}
