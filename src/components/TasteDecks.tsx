'use client'

// The pair of card decks that sit under OUR PICKS: what MYRA thinks she'll
// like, and what she has already opened. Side by side on laptop, stacked on
// mobile with recommendations first.

import OutfitDeck from './OutfitDeck'
import { useRecentlyViewed } from './RecentlyViewed'
import type { OutfitWithItems } from '@/types/database'

export default function TasteDecks({
  recommended,
  catalogue,
  detailHrefBase = '/outfit',
  className = '',
}: {
  recommended: OutfitWithItems[]
  // Full live set — the recently-viewed ids are resolved against it.
  catalogue: OutfitWithItems[]
  detailHrefBase?: string
  className?: string
}) {
  const viewed = useRecentlyViewed(catalogue)
  if (recommended.length === 0 && viewed.length === 0) return null

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-14 ${className}`}>
      <OutfitDeck
        outfits={recommended}
        title="RECOMMENDED FOR YOU"
        hint="LEARNED FROM WHAT YOU LIKE"
        accent={<span className="text-[#C8302A]" aria-hidden>♥</span>}
        detailHrefBase={detailHrefBase}
      />
      <OutfitDeck
        outfits={viewed}
        title="RECENTLY VIEWED"
        hint="PICK UP WHERE YOU LEFT OFF"
        detailHrefBase={detailHrefBase}
      />
    </div>
  )
}
