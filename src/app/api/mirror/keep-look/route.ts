import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { productFrom } from '@/lib/mirror/product'
import { keepLookForMember, type KeptLookItem } from '@/lib/mirror/keep-look'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST { product, look: [{ item_id, product_name, brand, image_url, url, owned }] }
// — "Save this look to MYRA" from the Mirror's panel. The piece and the look
// around it land in her saved pieces and her own outfits.
export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const product = productFrom(b?.product)
  if (!product) return mirrorJson({ error: 'product.url and product.title required' }, { status: 400 })
  const look: KeptLookItem[] = (Array.isArray(b?.look) ? b.look : []).slice(0, 12)
    .filter((it: any) => it && typeof it === 'object')
    .map((it: any) => ({
      item_id: typeof it.item_id === 'string' ? it.item_id.slice(0, 40) : null,
      product_name: typeof it.product_name === 'string' ? it.product_name.slice(0, 200) : null,
      brand: typeof it.brand === 'string' ? it.brand.slice(0, 120) : null,
      image_url: typeof it.image_url === 'string' && /^https?:\/\//.test(it.image_url) ? it.image_url.slice(0, 800) : null,
      url: typeof it.url === 'string' && /^https?:\/\//.test(it.url) ? it.url.slice(0, 500) : null,
      owned: !!it.owned,
    }))
  const res = await keepLookForMember(member, product, look)
  return mirrorJson(res, { status: res.error && !res.saved ? 400 : 200 })
}
