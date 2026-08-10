'use client'

// OUTFIT DECK — a pile of outfit cards that fans open like a hand of playing
// cards. On a pointer device it fans on hover; on touch there is no hover, so
// it fans when the deck scrolls into view and closes again when it leaves.
// Cards keep their fanned positions while the pointer moves between them
// because the hover is tracked on the wrapper, not the individual cards.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { thumbUrl } from '@/lib/image-utils'
import { PaperClip, BulldogClip } from './PaperClips'
import type { OutfitWithItems } from '@/types/database'

const MAX_CARDS = 6
// On a phone the arc was a whole hand of cards splayed across the screen —
// unreadable and nothing like the editorial reference. Touch gets a straight
// stack instead: one card square-on, two peeking out behind it.
const MAX_CARDS_TOUCH = 3

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

  const cards = outfits.slice(0, touch ? MAX_CARDS_TOUCH : MAX_CARDS)
  if (cards.length === 0) return null

  const open = touch ? inView : hovered
  const n = cards.length
  // Fanned (pointer only): pivot each card about a point below the deck so the
  // spread is an arc, the way a hand of cards actually opens.
  const SPREAD = 15 // degrees between adjacent cards
  const mid = (n - 1) / 2

  // Cards are wider on touch — a 26vw card on a phone is a postage stamp.
  const cardW = touch ? 'min(72vw, 360px)' : 'min(96%, 640px)'

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-7">
        <p className="myra-section-label inline-flex items-center gap-2">
          {accent}
          {title}
        </p>
        {hint && <p className="myra-section-note">{hint}</p>}
      </div>

      <div
        ref={ref}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        // Tall enough to hold the arc without the cards clipping.
        className="relative w-full h-[clamp(470px,60vw,960px)]"
      >
        {/* Loose sheets under the pile: plain paper, each turned a little and
            sized slightly larger than the cards so their corners show past the
            photograph on top. They belong to the pile, not to any one card, so
            they stay put when the deck fans. */}
        {[{ r: -3.4, x: -10, y: 6 }, { r: 2.6, x: 12, y: 10 }, { r: -1.2, x: 2, y: 15 }].map((s, i) => (
          <div
            key={`sheet-${i}`}
            aria-hidden
            className="absolute left-1/2 top-0 bg-[#F7F7F4] shadow-[0_6px_18px_rgba(0,0,0,0.14)]"
            style={{
              width: `calc(${cardW} + 14px)`,
              aspectRatio: '3 / 4',
              marginLeft: `calc((${cardW} + 14px) / -2 ${touch ? `- ${((n - 1) * 16) / 2}px` : ''})`,
              transform: `translate(${s.x}px, ${s.y}px) rotate(${s.r}deg)`,
              zIndex: 1 + i,
            }}
          />
        ))}

        {/* The stationery holding it together: a paperclip over the top-left
            corner and a bulldog clip biting the right edge. Both are anchored
            to the pile's own box so they stay clamped when the deck fans. */}
        <div
          aria-hidden
          className="absolute left-1/2 top-0 pointer-events-none"
          style={{
            width: cardW,
            marginLeft: `calc(${cardW} / -2 ${touch ? `- ${((n - 1) * 16) / 2}px` : ''})`,
            zIndex: 60,
          }}
        >
          <PaperClip className="absolute -top-4 left-[14%] -rotate-[14deg]" size={30} />
          <BulldogClip className="absolute top-[34%] -right-5 rotate-90" size={54} />
        </div>

        {cards.map((o, i) => {
          const pile = PILE[i] ?? PILE[PILE.length - 1]
          const angle = (i - mid) * SPREAD

          let style: React.CSSProperties
          if (touch) {
            // STRAIGHT STACK. No rotation at all — the front card sits square
            // and the ones behind step out to the right and down just far
            // enough to read as a stack with more inside.
            style = {
              transform: `translate(${i * 16}px, ${i * 10}px) scale(${1 - i * 0.035})`,
              transformOrigin: '50% 50%',
              zIndex: 10 + (n - i),
            }
          } else if (open) {
            style = { transform: `rotate(${angle}deg)`, transformOrigin: '50% 155%', zIndex: 10 + i }
          } else {
            style = {
              transform: `translate(${pile.x}px, ${pile.y}px) rotate(${pile.r}deg)`,
              transformOrigin: '50% 50%',
              zIndex: 10 + (n - i),
            }
          }

          return (
            <button
              key={o.outfit_id}
              onClick={() => router.push(`${detailHrefBase}/${o.outfit_id}`)}
              aria-label={o.aesthetic_label ?? 'View outfit'}
              className="group absolute left-1/2 top-0 transition-[transform] duration-[550ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform hover:-translate-y-2"
              style={{
                width: cardW,
                // Centres the stack: half the card, plus half the step-out.
                marginLeft: `calc(${cardW} / -2 ${touch ? `- ${((n - 1) * 16) / 2}px` : ''})`,
                ...style,
                transitionDelay: `${i * 35}ms`,
              }}
            >
              {/* Mounted on paper: a white border all round the photograph and
                  a deeper lip at the foot, the way a print sits on a sheet. */}
              <div className="bg-[#FBFBF9] p-[7px] pb-[18px] shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#EDEDED]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={o.image_url ? thumbUrl(o.image_url, 500) : '/placeholder-outfit.jpg'}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
