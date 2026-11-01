'use client'

// HER WARDROBE — a heart in the top corner beside SHARING (Chloe, 2026-11-01:
// the tab down the right edge took too much of the screen). On the Looks room
// it opens the drawer in place; anywhere else it takes her to the saved shelf
// in the Dressing Room. Only ever her own saves: the count comes from the
// drawer (which reads the signed-in member) or from her own saved pieces.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSavedItemIds } from '@/app/edit/save-actions'

export default function WardrobeButton({ showLabel = true }: { showLabel?: boolean }) {
  const router = useRouter()
  const [count, setCount] = useState(0)
  // Set while a drawer is mounted on the page and reporting its own count.
  const drawer = useRef(false)

  useEffect(() => {
    let live = true
    const look = () => {
      if (drawer.current) return
      void getSavedItemIds().then((ids) => { if (live && !drawer.current) setCount(ids.length) }).catch(() => {})
    }
    look()
    const onCount = (e: Event) => {
      const n = (e as CustomEvent<number | null>).detail
      // null = the drawer has gone (she left the Looks room).
      drawer.current = n != null
      if (n != null) setCount(n)
      else look()
    }
    window.addEventListener('myra:wardrobe-count', onCount)
    window.addEventListener('myra:item-saved', look)
    return () => {
      live = false
      window.removeEventListener('myra:wardrobe-count', onCount)
      window.removeEventListener('myra:item-saved', look)
    }
  }, [])

  function open() {
    if (drawer.current) window.dispatchEvent(new CustomEvent('myra:open-wardrobe'))
    else router.push('/me/dressing-room?tab=saved')
  }

  return (
    <button type="button" onClick={open} aria-label={count ? `My wardrobe — ${count}` : 'My wardrobe'} className="group text-center shrink-0">
      <span className="relative block w-9 h-9 sm:w-[clamp(54px,2.9vw,104px)] sm:h-[clamp(54px,2.9vw,104px)] mx-auto text-[#55534E] group-hover:text-[#2B2B2B]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
          <path d="M12 20s-7.5-4.6-7.5-10.2A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z" />
        </svg>
        {count > 0 && (
          <span aria-hidden className="absolute -top-0.5 -right-1.5 min-w-[20px] h-[20px] sm:min-w-[26px] sm:h-[26px] px-1 rounded-full bg-[#2B2B2B] text-white text-[12px] sm:text-[15px] leading-none flex items-center justify-center ring-2 ring-[#E6E6E9]">
            {count}
          </span>
        )}
      </span>
      {showLabel && <span className="block mt-0.5 sm:mt-1 text-[13px] sm:text-[clamp(21px,1.15vw,40px)] text-[#55534E] group-hover:text-[#2B2B2B]">Wardrobe</span>}
    </button>
  )
}
