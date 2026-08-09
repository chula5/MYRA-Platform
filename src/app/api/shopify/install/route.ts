import { NextRequest, NextResponse } from 'next/server'
import { isValidShopDomain, makeState } from '@/lib/shopify/crypto'

export const dynamic = 'force-dynamic'

// OAuth entry point: /api/shopify/install?shop=xxx.myshopify.com
// Custom-distribution installs normally start from Shopify's own install link,
// which lands here with ?shop=. We only ever redirect to a validated
// *.myshopify.com host, so this can't be used as an open redirect.

const SCOPES = 'read_products,read_orders,read_inventory'

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get('shop')
  if (!isValidShopDomain(shop)) {
    return NextResponse.json({ error: 'Invalid or missing shop parameter' }, { status: 400 })
  }
  const apiKey = process.env.SHOPIFY_API_KEY
  if (!apiKey || !process.env.SHOPIFY_API_SECRET) {
    return NextResponse.json({ error: 'Shopify app not configured' }, { status: 500 })
  }

  const base = (process.env.SHOPIFY_APP_URL || req.nextUrl.origin).replace(/\/+$/, '')
  const redirectUri = `${base}/api/shopify/callback`
  const state = makeState(shop)

  const authorize = new URL(`https://${shop}/admin/oauth/authorize`)
  authorize.searchParams.set('client_id', apiKey)
  authorize.searchParams.set('scope', SCOPES)
  authorize.searchParams.set('redirect_uri', redirectUri)
  authorize.searchParams.set('state', state)

  const res = NextResponse.redirect(authorize.toString(), { status: 302 })
  // State is echoed back by Shopify; the cookie lets us double-check it.
  res.cookies.set('myra_shopify_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return res
}
