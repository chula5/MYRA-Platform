'use client'

// THE SALE — a price tag in the top corner beside her WARDROBE heart (Chloe,
// 2026-11-06). The badge is how many of her brands are on sale right now;
// tapping it opens /me/sale, her sale pieces in a stylist's order.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { countMySaleBrands } from '@/app/me/sale-actions'

// One read per visit: the count moves hourly at most.
let counted: Promise<number> | null = null

export default function SaleButton({ showLabel = true }: { showLabel?: boolean }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let live = true
    if (!counted) counted = countMySaleBrands().catch(() => 0)
    void counted.then((n) => { if (live) setCount(n) })
    return () => { live = false }
  }, [])

  return (
    <Link href="/me/sale" aria-label={count ? `Sale — ${count} of your brands` : 'Sale'} className="group text-center shrink-0">
      <span className="relative block w-9 h-9 sm:w-[clamp(54px,2.9vw,104px)] sm:h-[clamp(54px,2.9vw,104px)] mx-auto text-[#55534E] group-hover:text-[#2B2B2B]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
          <path d="M3.6 13.1 11.3 5.4a1.6 1.6 0 0 1 1.1-.5h5.5a1.6 1.6 0 0 1 1.6 1.6v5.5a1.6 1.6 0 0 1-.5 1.1l-7.7 7.7a1.6 1.6 0 0 1-2.3 0l-5.4-5.4a1.6 1.6 0 0 1 0-2.3Z" />
          <circle cx="15.6" cy="8.4" r="1.4" />
          <path d="M15.6 7c.2-2 1.4-3.6 3.4-3.9 1.4-.2 2.3.6 2.3 1.8" />
        </svg>
        {count > 0 && (
          <span aria-hidden className="absolute -top-0.5 -right-1.5 min-w-[20px] h-[20px] sm:min-w-[26px] sm:h-[26px] px-1 rounded-full bg-[#2B2B2B] text-white text-[12px] sm:text-[15px] leading-none flex items-center justify-center ring-2 ring-[#E6E6E9]">
            {count}
          </span>
        )}
      </span>
      {showLabel && <span className="block mt-0.5 sm:mt-1 text-[13px] sm:text-[clamp(21px,1.15vw,40px)] text-[#55534E] group-hover:text-[#2B2B2B]">Sale</span>}
    </Link>
  )
}
