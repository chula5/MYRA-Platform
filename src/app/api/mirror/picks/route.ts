import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { picksForPage, type PickCandidate, type PicksResult } from '@/lib/mirror/picks'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST { host, products: [{ key, brand, title, type, price, url, image, available }] }
// → { picks: [{ url, title, image, reason, headline, note, confidence, look }], gaps }
//
// Her top picks off this page, each with one look around it. Asked for when
// she opens the panel, never on page load: composing means scoring pieces MYRA
// has never seen, which costs a vision call each.

const MAX_PRODUCTS = 300
const cache = new Map<string, { at: number; res: PicksResult }>()
const TTL = 15 * 60_000

function keyFor(memberId: string, host: string, products: PickCandidate[]): string {
  const s = products.map((p) => p.key).sort().join(',')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return `${memberId}|${host}|${h}`
}

export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }

  const host = typeof body?.host === 'string' ? body.host.slice(0, 200) : ''
  const raw: unknown[] = Array.isArray(body?.products) ? body.products.slice(0, MAX_PRODUCTS) : []
  const products: PickCandidate[] = raw
    .filter((p: any) => p && typeof p.key === 'string' && p.key.length <= 300)
    .map((p: any) => ({
      key: p.key,
      brand: typeof p.brand === 'string' ? p.brand.slice(0, 120) : null,
      title: typeof p.title === 'string' ? p.title.slice(0, 300) : null,
      type: typeof p.type === 'string' ? p.type.slice(0, 80) : null,
      price: typeof p.price === 'number' ? p.price : null,
      url: typeof p.url === 'string' ? p.url.slice(0, 500) : null,
      image: typeof p.image === 'string' && /^https?:\/\//.test(p.image) ? p.image.slice(0, 800) : null,
      available: typeof p.available === 'boolean' ? p.available : null,
      sizes: Array.isArray(p.sizes)
        ? p.sizes.slice(0, 60)
          .filter((s: any) => s && typeof s.label === 'string' && s.label.length <= 40)
          .map((s: any) => ({ label: s.label, available: !!s.available }))
        : null,
    }))
  if (!products.length) return mirrorJson({ picks: [], gaps: [], error: 'Nothing on this page MYRA can read' })

  const t0 = Date.now()
  const key = keyFor(member.member_id, host, products)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return mirrorJson({ ...hit.res, cached: true, ms: Date.now() - t0 })

  const res = await picksForPage(member, host || null, products)
  if (res.picks.length) cache.set(key, { at: Date.now(), res })
  return mirrorJson({ ...res, ms: Date.now() - t0 })
}
