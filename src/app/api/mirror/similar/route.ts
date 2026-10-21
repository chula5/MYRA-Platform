import { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { createAdminClient } from '@/lib/supabase-server'
import { similarPiecesFor, type ShopPiece } from '@/lib/shop-brain/similar'
import { affiliateUrl } from '@/lib/affiliate'
import { isBeaconMerchant, goHref } from '@/lib/outbound'
import { siteUrl } from '@/lib/studio/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET with Bearer token → { pieces: ShopPiece[], kept, ms }
//
// Her MORE OF THE SAME door, for the Mirror panel: the library pieces closest
// to what she kept or looked at through the Mirror. Answered from the view
// kept on her row (migration 0098) — the very list FOR YOU shows her first —
// and built fresh only when nothing is kept yet, or on ?fresh=1. Building
// reads the whole retail library (13s+ cold), which is why the kept view
// comes first here as it does on the page.
//
// Each piece's shop url leaves through the same door as the app's ShopLink:
// an Awin beacon merchant keeps its affiliate href; everything else goes via
// /go/<click_id>, which logs the click and 302s to the tracked destination.

export async function OPTIONS() { return mirrorOptions() }

function trackedUrl(p: ShopPiece, origin: string): string | null {
  if (!p.url) return null
  if (isBeaconMerchant(p.brand, p.url)) return affiliateUrl(p.url, { brandName: p.brand, contentId: p.item_id })
  return `${origin}${goHref({ clickId: crypto.randomUUID(), itemId: p.item_id })}`
}

export async function GET(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  const t0 = Date.now()
  const admin = createAdminClient() as any
  const fresh = req.nextUrl.searchParams.get('fresh') === '1'

  let pieces: ShopPiece[] | null = null
  let kept = false
  if (!fresh) {
    const { data } = await admin.from('pilot_member').select('shop_brain_view').eq('member_id', member.member_id).maybeSingle()
    const view = data?.shop_brain_view
    if (view && Array.isArray(view.similar)) { pieces = view.similar as ShopPiece[]; kept = true }
  }
  if (!pieces) pieces = await similarPiecesFor(admin, { memberId: member.member_id, authUserId: member.auth_user_id })

  // The /go/ link lands on the server the extension is connected to, so a
  // dev copy logs on the dev server; a request with no readable origin falls
  // back to the live site.
  let origin = ''
  try { origin = req.nextUrl.origin } catch { /* fine */ }
  if (!/^https?:\/\//.test(origin)) origin = siteUrl('')
  const out = pieces.map((p) => ({ ...p, url: trackedUrl(p, origin) }))
  return mirrorJson({ pieces: out, kept, ms: Date.now() - t0 })
}
