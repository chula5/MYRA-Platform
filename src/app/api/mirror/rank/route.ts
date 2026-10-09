import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { rankPageForMember, type PageProduct } from '@/lib/mirror/rank'
import { createAdminClient } from '@/lib/supabase-server'
import { mirrorFedBrandFor, queueMirrorProducts, type MirrorSeenProduct } from '@/lib/mirror/watchlist'

export const dynamic = 'force-dynamic'

// POST { host, products: [{ key, brand, title, type, price, url }] }
// → { member: { name }, brands: { <brandKey>: { score, why } }, products: [{ key, score, why, fit }] }
// Brand-level only in Phase 0: answers in one round trip with no catalogue
// knowledge, which is what makes a first visit to a retailer work.
//
// This is also where a watchlist brand no server can read is fed: the same
// tiles, with their pictures, ride along into the brand watch queue
// (src/lib/mirror/watchlist.ts) — her browser is already past the walls.

const MAX_PRODUCTS = 600

export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const host = typeof body?.host === 'string' ? body.host.slice(0, 200) : null
  const raw: unknown[] = Array.isArray(body?.products) ? body.products.slice(0, MAX_PRODUCTS) : []
  const products: PageProduct[] = []
  const seen: MirrorSeenProduct[] = [] // the feed's payload: a tile with its picture
  for (const p of raw as any[]) {
    if (!(p && typeof p.key === 'string' && p.key.length <= 300)) continue
    const url = typeof p.url === 'string' ? p.url.slice(0, 500) : null
    const title = typeof p.title === 'string' ? p.title.slice(0, 300) : null
    const image = typeof p.image === 'string' && /^https?:\/\//.test(p.image) ? p.image.slice(0, 800) : null
    const brand = typeof p.brand === 'string' ? p.brand.slice(0, 120) : null
    const type = typeof p.type === 'string' ? p.type.slice(0, 80) : null
    const price = typeof p.price === 'number' ? p.price : null
    const available = typeof p.available === 'boolean' ? p.available : null
    const sizes = Array.isArray(p.sizes)
      ? p.sizes.slice(0, 60)
        .filter((s: any) => s && typeof s.label === 'string' && s.label.length <= 40)
        .map((s: any) => ({ label: s.label, available: !!s.available }))
      : null
    products.push({ key: p.key, brand, title, type, price, url, available, sizes })
    if (url && title && image) seen.push({ url, title, brand, type, price, image, available })
  }

  const t0 = Date.now()
  const ranked = await rankPageForMember(member, products, host)

  // A shop on the watchlist that no server can read: queue what she is
  // looking at, as she looks at it. The feed never throws and never lets the
  // queue break the ranking she is waiting on.
  // The count comes back with the ranking so a SCAN IN CHROME can say what
  // it has queued as it goes.
  let queued = 0
  let fedName: string | null = null
  if (host && seen.length) {
    try {
      const admin = createAdminClient() as any
      const fed = await mirrorFedBrandFor(admin, host)
      // A SCAN IN CHROME reading a grid that only scrolls (no page URLs) comes
      // through here too, and a scan wants everything on the page, not a visit's 40.
      if (fed) { fedName = fed.name; queued = await queueMirrorProducts(admin, fed, seen, body?.scan === true ? { limit: seen.length } : {}) }
    } catch { /* the queue is a passenger, never the driver */ }
  }

  return mirrorJson({ member: { name: member.name }, ...ranked, queued, fed: fedName, ms: Date.now() - t0 })
}
