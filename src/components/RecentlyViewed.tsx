'use client'

// RECENTLY VIEWED — the outfits this visitor has actually opened, newest
// first. Mirrors the "recommendations based on your taste" row, but is purely
// local: outfit ids are recorded in localStorage when an outfit page opens, so
// it works for signed-out visitors too and never needs a round trip.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { thumbUrl } from '@/lib/image-utils'
import type { OutfitWithItems } from '@/types/database'

const KEY = 'myra_recently_viewed'
const MAX = 12

/** Record an outfit view (called from the outfit detail page). */
export function recordOutfitView(outfitId: string) {
  if (typeof window === 'undefined' || !outfitId) return
  try {
    const prev: string[] = JSON.parse(localStorage.getItem(KEY) || '[]')
    const next = [outfitId, ...prev.filter((id) => id !== outfitId)].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch { /* private mode — skip */ }
}

/** The viewed outfits, newest first, resolved against the live catalogue. */
export function useRecentlyViewed(outfits: OutfitWithItems[]): OutfitWithItems[] {
  const [ids, setIds] = useState<string[]>([])
  useEffect(() => {
    try {
      setIds(JSON.parse(localStorage.getItem(KEY) || '[]'))
    } catch { /* ignore */ }
  }, [])
  const byId = new Map(outfits.map((o) => [o.outfit_id, o]))
  return ids.map((id) => byId.get(id)).filter(Boolean) as OutfitWithItems[]
}

export default function RecentlyViewed({
  outfits,
  detailHrefBase = '/outfit',
  className = '',
}: {
  // The full live catalogue; we pick out the ones they've viewed.
  outfits: OutfitWithItems[]
  detailHrefBase?: string
  className?: string
}) {
  const router = useRouter()
  const [ids, setIds] = useState<string[]>([])

  useEffect(() => {
    try {
      setIds(JSON.parse(localStorage.getItem(KEY) || '[]'))
    } catch { /* ignore */ }
  }, [])

  if (ids.length === 0) return null
  const byId = new Map(outfits.map((o) => [o.outfit_id, o]))
  const viewed = ids.map((id) => byId.get(id)).filter(Boolean) as OutfitWithItems[]
  if (viewed.length === 0) return null

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-[11px] tracking-[0.099em] text-[#4A4E57]">RECENTLY VIEWED</p>
        <p className="text-[9px] tracking-[0.072em] text-[#4A4E57]">PICK UP WHERE YOU LEFT OFF</p>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
        {viewed.map((o) => (
          <button
            key={o.outfit_id}
            onClick={() => router.push(`${detailHrefBase}/${o.outfit_id}`)}
            className="group relative shrink-0 w-[15vw] min-w-[170px]"
          >
            <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#EDEDED]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={o.image_url ? thumbUrl(o.image_url, 500) : '/placeholder-outfit.jpg'}
                alt={o.aesthetic_label ?? ''}
                loading="lazy"
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
