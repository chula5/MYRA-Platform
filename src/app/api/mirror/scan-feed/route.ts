import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { createAdminClient } from '@/lib/supabase-server'
import { mirrorFedBrandFor, queueMirrorProducts, type MirrorSeenProduct } from '@/lib/mirror/watchlist'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST { host, products: [{ url, title, brand, type, price, image, available }] }
// → { received, queued, fed }
//
// A SCAN IN CHROME feeding a mirror-fed brand page by page. Unlike /rank this
// ranks nothing — a scan is not a page she is looking at — it only queues what
// Brand Watch would keep, exactly as /rank does for the page in front of her.
// Batches of a couple of hundred; the extension sends one per grid page.

const MAX_PRODUCTS = 300

export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const host = typeof body?.host === 'string' ? body.host.slice(0, 200) : null
  if (!host) return mirrorJson({ error: 'host required' }, { status: 400 })
  const raw: unknown[] = Array.isArray(body?.products) ? body.products.slice(0, MAX_PRODUCTS) : []
  const seen: MirrorSeenProduct[] = []
  for (const p of raw as any[]) {
    const url = typeof p?.url === 'string' && /^https?:\/\//.test(p.url) ? p.url.slice(0, 500) : null
    const title = typeof p?.title === 'string' ? p.title.slice(0, 300) : null
    const image = typeof p?.image === 'string' && /^https?:\/\//.test(p.image) ? p.image.slice(0, 800) : null
    if (!url || !title || !image) continue
    seen.push({
      url, title, image,
      brand: typeof p.brand === 'string' ? p.brand.slice(0, 120) : null,
      type: typeof p.type === 'string' ? p.type.slice(0, 80) : null,
      price: typeof p.price === 'number' && Number.isFinite(p.price) ? p.price : null,
      available: typeof p.available === 'boolean' ? p.available : null,
    })
  }
  const admin = createAdminClient() as any
  const fed = await mirrorFedBrandFor(admin, host)
  if (!fed) return mirrorJson({ received: seen.length, queued: 0, fed: null, error: 'not a mirror-fed brand' })
  let queued = 0
  try { queued = await queueMirrorProducts(admin, fed, seen, { limit: seen.length }) } catch { /* a bad page must not end the scan */ }
  return mirrorJson({ received: seen.length, queued, fed: fed.name })
}
