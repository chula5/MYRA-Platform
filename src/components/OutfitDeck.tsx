'use client'

// OUTFIT DECK — a pile of outfit cards that fans open like a hand of playing
// cards. On a pointer device it fans on hover; on touch there is no hover, so
// it fans when the deck scrolls into view and closes again when it leaves.
// Cards keep their fanned positions while the pointer moves between them
// because the hover is tracked on the wrapper, not the individual cards.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { thumbUrl } from '@/lib/image-utils'
import type { OutfitWithItems } from '@/types/database'

const MAX_CARDS = 6

// Resting pile: a few degrees of scatter so it reads as real cards, not a
// stack of divs. Indexed from the top card down.
const PILE = [
  { x: 0, y: 0, r: 0 },
  { x: 4, y: 5, r: 1.6 },
  { x: -5, y: 10, r: -1.9 },
  { x: 7, y: 15, r: 2.4 },
  { x: -3, y: 20, r: -1.2 },
  { x: 5, y: 25, r: 1.8 },
]

export default function OutfitDeck({
  outfits,
  title,
  hint,
  detailHrefBase = '/outfit',
  accent,
  className = '',
}: {
  outfits: OutfitWithItems[]
  title: string
  hint?: string
  detailHrefBase?: string
  // Optional glyph before the title (the heart on recommendations).
  accent?: React.ReactNode
  className?: string
}) {
  const cards = outfits.slice(0, MAX_CARDS)
  const ref = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [inView, setInView] = useState(false)
  const [touch, setTouch] = useState(false)
  const router = useRouter()

  useEffect(() => {
    setTouch(!window.matchMedia('(hover: hover)').matches)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || !touch) return
    const io = new IntersectionObserver(
      ([e]) => setInView(e.isIntersecting),
      { threshold: 0.55 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [touch])

  if (cards.length === 0) return null

  const open = touch ? inView : hovered
  const n = cards.length
  // Fanned: pivot each card about a point below the deck so the spread is an
  // arc, the way a hand of cards actually opens.
  const SPREAD = 15 // degrees between adjacent cards
  const mid = (n - 1) / 2

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-[11px] tracking-[0.099em] text-[#4A4E57] inline-flex items-center gap-1.5">
          {accent}
          {title}
        </p>
        {hint && <p className="text-[9px] tracking-[0.072em] text-[#A8A8A4]">{hint}</p>}
      </div>

      <div
        ref={ref}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        // Tall enough to hold the arc without the cards clipping.
        className="relative w-full h-[clamp(300px,34vw,520px)]"
      >
        {cards.map((o, i) => {
          const pile = PILE[i] ?? PILE[PILE.length - 1]
          const angle = (i - mid) * SPREAD
          const style: React.CSSProperties = open
            ? {
                transform: `rotate(${angle}deg)`,
                transformOrigin: '50% 155%',
                zIndex: 10 + i,
              }
            : {
                transform: `translate(${pile.x}px, ${pile.y}px) rotate(${pile.r}deg)`,
                transformOrigin: '50% 50%',
                zIndex: 10 + (n - i),
              }
          return (
            <button
              key={o.outfit_id}
              onClick={() => router.push(`${detailHrefBase}/${o.outfit_id}`)}
              aria-label={o.aesthetic_label ?? 'View outfit'}
              className="group absolute left-1/2 top-0 -ml-[calc(min(26vw,220px)/2)] w-[min(26vw,220px)] transition-[transform] duration-[550ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform hover:-translate-y-2"
              style={{ ...style, transitionDelay: `${i * 35}ms` }}
            >
              <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#EDEDED] shadow-[0_10px_30px_rgba(0,0,0,0.16)] ring-1 ring-black/[0.04]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={o.image_url ? thumbUrl(o.image_url, 500) : '/placeholder-outfit.jpg'}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
