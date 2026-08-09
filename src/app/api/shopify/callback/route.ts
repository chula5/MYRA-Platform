import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { isValidShopDomain, verifyOAuthHmac, verifyState } from '@/lib/shopify/crypto'
import { exchangeCodeForToken } from '@/lib/shopify/client'
import { upsertMerchantFromInstall, getShopifyMerchant } from '@/lib/shopify/merchant'
import { registerWebhooks } from '@/lib/shopify/webhooks'
import { ingestCatalogue } from '@/lib/shopify/ingest'

export const dynamic = 'force-dynamic'

// OAuth callback. Verifies HMAC + state BEFORE exchanging the code, stores the
// token encrypted, then kicks off webhook registration and the first catalogue
// sync in the background (both can take longer than a redirect should wait).
//
// Items land as DRAFT — nothing reaches the live feed without Chloe publishing.

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const shop = sp.get('shop')
  const code = sp.get('code')
  const state = sp.get('state')

  if (!isValidShopDomain(shop) || !code) {
    return NextResponse.json({ error: 'Invalid callback parameters' }, { status: 400 })
  }
  // Signed state + cookie match — CSRF protection on the install flow.
  const cookieState = req.cookies.get('myra_shopify_state')?.value
  if (!verifyState(state, shop) || (cookieState && cookieState !== state)) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }
  if (!verifyOAuthHmac(sp)) {
    return NextResponse.json({ error: 'HMAC verification failed' }, { status: 401 })
  }

  try {
    const { access_token, scope } = await exchangeCodeForToken(shop, code)
    const { merchantId } = await upsertMerchantFromInstall({
      shopDomain: shop,
      accessToken: access_token,
      scope,
    })

    // Long-running work happens after the response.
    waitUntil(
      (async () => {
        try {
          const merchant = await getShopifyMerchant(shop)
          if (!merchant) return
          await registerWebhooks(merchant)
          await ingestCatalogue(merchant)
        } catch (err) {
          console.error('[shopify callback] post-install', err instanceof Error ? err.message : err)
        }
      })(),
    )

    const done = new URL('/admin/items?connected=' + encodeURIComponent(shop), req.nextUrl.origin)
    const res = NextResponse.redirect(done, { status: 302 })
    res.cookies.delete('myra_shopify_state')
    return res
  } catch (err) {
    // Never leak the token/secret in an error surface.
    console.error('[shopify callback]', err instanceof Error ? err.message : 'failed')
    return NextResponse.json({ error: 'Install failed' }, { status: 500 })
  }
}
