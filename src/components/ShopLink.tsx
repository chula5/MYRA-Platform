'use client'

// Outbound "shop" link — the single place that decides how a retailer click
// leaves MYRA. Two modes, resolved per merchant:
//
//  redirect (default): href points at /go/[click_id], the server logs and 302s
//    to the tracked destination (Rakuten deep link, or the product URL with our
//    params for direct partners like J'amemme).
//  beacon (Awin Convert-a-Link, e.g. Da Luna): the href stays EXACTLY what it
//    is today — Awin's MasterTag rewrites it in the browser, and a server
//    redirect would break their attribution — so we log via a fire-and-forget
//    beacon instead.
//
// The click_id is generated client-side per mount; the server upserts with
// ignore-duplicates so double clicks and retries never double-log.

import { useState, type ReactNode, type MouseEvent } from 'react'
import { affiliateUrl } from '@/lib/affiliate'
import { isBeaconMerchant, goHref } from '@/lib/outbound'
import { getStoredRef } from '@/lib/ref'
import { recordOutboundBeacon } from '@/app/actions/outbound-click'

export interface ShopLinkItem {
  item_id: string
  retailer_url: string | null
  product_name?: string | null
  brand?: { name?: string | null } | null
}

function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* ignore */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function sessionId(): string | null {
  try { return sessionStorage.getItem('myra_sid') } catch { return null }
}

const label = (item: ShopLinkItem) => [item.brand?.name, item.product_name].filter(Boolean).join(' — ')

// Imperative variant for callsites that window.open() programmatically.
export function openShop(item: ShopLinkItem, outfitId?: string | null): void {
  if (!item?.retailer_url) return
  const clickId = uuid()
  if (isBeaconMerchant(item.brand?.name, item.retailer_url)) {
    void recordOutboundBeacon({
      clickId,
      itemId: item.item_id,
      outfitId: outfitId ?? null,
      destinationUrl: affiliateUrl(item.retailer_url, { brandName: item.brand?.name, contentId: item.item_id }),
      sessionId: sessionId(),
      ref: getStoredRef(),
      label: label(item),
    })
    window.open(
      affiliateUrl(item.retailer_url, { brandName: item.brand?.name, contentId: item.item_id }),
      '_blank', 'noopener,noreferrer',
    )
    return
  }
  window.open(
    goHref({ clickId, itemId: item.item_id, outfitId, sessionId: sessionId(), ref: getStoredRef() }),
    '_blank', 'noopener,noreferrer',
  )
}

// Anchor variant. Renders a real <a> (middle-click / open-in-new-tab safe).
// In redirect mode the sid/ref params are attached just-in-time on click,
// since sessionStorage doesn't exist during SSR.
export default function ShopLink({
  item,
  outfitId,
  className,
  children,
  target = '_blank',
  onNavigate,
}: {
  item: ShopLinkItem
  outfitId?: string | null
  className?: string
  children: ReactNode
  target?: string
  onNavigate?: () => void   // extra side-effects (close a panel, etc). NOT for logging.
}) {
  const [clickId] = useState(uuid)
  if (!item?.retailer_url) return null

  const beacon = isBeaconMerchant(item.brand?.name, item.retailer_url)
  const rawAffiliate = affiliateUrl(item.retailer_url, { brandName: item.brand?.name, contentId: item.item_id })
  const href = beacon ? rawAffiliate : goHref({ clickId, itemId: item.item_id, outfitId })

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    e.stopPropagation()
    if (beacon) {
      void recordOutboundBeacon({
        clickId,
        itemId: item.item_id,
        outfitId: outfitId ?? null,
        destinationUrl: rawAffiliate,
        sessionId: sessionId(),
        ref: getStoredRef(),
        label: label(item),
      })
    } else {
      // Attach client-only context to the /go/ URL just before navigation.
      e.currentTarget.href = goHref({
        clickId, itemId: item.item_id, outfitId, sessionId: sessionId(), ref: getStoredRef(),
      })
    }
    onNavigate?.()
  }

  return (
    <a
      href={href}
      target={target}
      rel="noopener noreferrer"
      onClick={handleClick}
      className={className}
    >
      {children}
    </a>
  )
}
