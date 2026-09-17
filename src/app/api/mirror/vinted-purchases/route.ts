// Her own Vinted purchases, sent by the MYRA extension from a tab she is
// signed into. Vinted has no API for buyers and its order emails carry no
// photo, so this is the only way to see the pieces she bought there.
//
// The extension holds a signed member token and nothing else; every row lands
// as a PENDING find she reviews in the Dressing Room, exactly like an email
// find. Nothing is written back to Vinted.

import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { saveMarketplacePurchases, type MarketplaceOrder } from '@/lib/email/marketplace'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const orders: MarketplaceOrder[] = Array.isArray(body?.orders) ? body.orders.slice(0, 200) : []
  if (!orders.length) return mirrorJson({ error: 'no orders in that page' }, { status: 400 })

  const r = await saveMarketplacePurchases(member.member_id, 'Vinted', orders)
  return mirrorJson(r)
}
