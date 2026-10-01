import { NextRequest } from 'next/server'
import { isAdminMember, memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { saveForMember } from '@/lib/mirror/save'
import { productFrom } from '@/lib/mirror/product'
import { resolveShare } from '@/lib/share/resolve'
import { createWatchedBrandAndScan } from '@/lib/brand-onboarding'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// POST { url } — the iOS share sheet's door: work out what was shared and file it.
export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  if (typeof b?.url !== 'string' || !b.url.trim()) return mirrorJson({ error: 'url required' }, { status: 400 })

  const r = await resolveShare(b.url)
  // Not an error: the share sheet shows the sentence.
  if (r.kind === 'unknown') return mirrorJson({ kind: 'unknown', message: r.reason })

  if (r.kind === 'product') {
    const product = productFrom({ url: r.product.url, title: r.product.title, brand: r.product.brand, image: r.product.image, price: r.product.price })
    if (!product) return mirrorJson({ kind: 'unknown', message: 'I couldn’t make out a piece on that page' })
    const res = await saveForMember(member, product)
    if (res.error) return mirrorJson({ error: res.error }, { status: 400 })
    const from = r.product.brand ? ` from ${r.product.brand}` : ` from ${r.product.host}`
    return mirrorJson({ kind: 'product', saved: true, title: r.product.title, brand: r.product.brand, image: r.product.image, message: `Kept “${r.product.title}”${from}.` })
  }

  // Brand watch is Chloe's own list. assertAdmin reads a Supabase session the
  // share sheet does not have, so the token answers instead (isAdminMember)
  // and the same scan the admin action runs is called directly.
  if (!isAdminMember(member)) return mirrorJson({ error: 'Brand watch is Chloe’s for now' }, { status: 403 })
  const added = await createWatchedBrandAndScan(createAdminClient() as any, r.brand.website, 'watch')
  if (added.error && !added.watchedBrandId) return mirrorJson({ error: added.error }, { status: 400 })
  const name = added.name ?? r.brand.name ?? r.brand.handle
  let host = r.brand.website
  try { host = new URL(r.brand.website).host.replace(/^www\./, '') } catch { /* keep the raw url */ }
  const message = added.error === 'Already on the watchlist'
    ? `Already watching ${name} at ${host}.`
    : `Watching ${name} at ${host} — found from ${r.brand.via}.`
  return mirrorJson({ kind: 'brand', name, website: r.brand.website, message })
}
