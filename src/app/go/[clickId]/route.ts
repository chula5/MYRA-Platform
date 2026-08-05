import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase-server'
import { logOutboundClick } from '@/lib/outbound-log'
import { isBotRequest, deviceFromUa, resolveDestination, type MerchantLite } from '@/lib/outbound'

export const dynamic = 'force-dynamic'

// Tracked outbound redirect: /go/[click_id]?item=…&outfit=…&sid=…&ref=…
//
// The click_id is generated client-side (so double-clicks and beacon retries
// dedupe on the same id). The redirect is issued immediately; logging runs
// after the response via waitUntil so it never adds latency.
//
// Network merchants 302 to exactly what affiliateUrl() produced before this
// route existed; direct/manual merchants get their tracking params appended.
// Awin Convert-a-Link merchants never link here at all (beacon mode).

const UUIDISH = /^[0-9a-zA-Z_-]{8,64}$/

export async function GET(
  req: NextRequest,
  { params }: { params: { clickId: string } },
) {
  const clickId = params.clickId ?? ''
  const sp = req.nextUrl.searchParams
  const itemId = sp.get('item') ?? ''
  const outfitId = sp.get('outfit')
  const sessionId = sp.get('sid')
  const ref = sp.get('ref')

  const fallback = new URL(outfitId ? `/outfit/${outfitId}` : '/', req.nextUrl.origin)
  if (!UUIDISH.test(clickId) || !itemId) {
    return NextResponse.redirect(fallback, { status: 302 })
  }

  // Resolve item → destination. One indexed lookup; the redirect must be fast.
  const admin = createAdminClient()
  let { data: item, error } = await admin
    .from('item' as any)
    .select('item_id, product_name, retailer_url, available, merchant_id, brand:brand_id(name), merchant:merchant_id(merchant_id, type, link_mode, tracking_param_template, status)')
    .eq('item_id', itemId)
    .single()

  // Migration 0019 not yet applied (no merchant table / columns): degrade to the
  // legacy columns so outbound links keep working exactly as before.
  if (error) {
    const retry = await admin
      .from('item' as any)
      .select('item_id, product_name, retailer_url, brand:brand_id(name)')
      .eq('item_id', itemId)
      .single()
    item = retry.data
  }

  const row = item as any
  if (!row?.retailer_url) {
    return NextResponse.redirect(fallback, { status: 302 })
  }
  // Sold-out unique pieces: no dead retailer links from our highest-intent
  // surface — route back to the look instead. (Part 2 upgrades this to a full
  // "no longer available → similar looks" state.)
  if (row.available === false) {
    fallback.searchParams.set('unavailable', '1')
    return NextResponse.redirect(fallback, { status: 302 })
  }

  const merchant = (row.merchant ?? null) as MerchantLite | null
  const brandName = row.brand?.name ?? null
  const destination = resolveDestination({
    retailerUrl: row.retailer_url,
    brandName,
    itemId,
    merchant,
    clickId,
  })

  const ua = req.headers.get('user-agent')
  const isBot = isBotRequest(ua, req.headers)

  waitUntil(
    logOutboundClick({
      clickId,
      itemId,
      outfitId,
      merchantId: merchant?.merchant_id ?? row.merchant_id ?? null,
      destinationUrl: destination,
      sessionId,
      ref,
      label: [brandName, row.product_name].filter(Boolean).join(' — '),
      device: deviceFromUa(ua),
      referrer: req.headers.get('referer'),
      isBot,
    }),
  )

  const res = NextResponse.redirect(destination, { status: 302 })
  res.headers.set('cache-control', 'no-store, max-age=0')
  res.headers.set('referrer-policy', 'no-referrer-when-downgrade')
  return res
}
