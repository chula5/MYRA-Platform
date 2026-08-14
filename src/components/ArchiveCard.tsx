'use client'

// ARCHIVE CARD — the search area on the set-wall grey. It opens on the mirror
// alone: huge, centred in the grey. As the visitor scrolls, the mirror shrinks
// and glides down to dock just above the WHAT ARE YOU DRESSING FOR? headline,
// and the search sheet follows up the screen behind it.

import { useEffect, useRef, useState } from 'react'

// How much scroll (as a fraction of the viewport) the shrink plays over. The
// hero runway is 100vh + this, so the mirror finishes docking exactly as the
// headline arrives.
const SHRINK_VH = 0.45
// Scale of the mirror on arrival and once docked (relative to its CSS size),
// and the breathing room left between its foot and the headline.
const START_SCALE = 2.3
const END_SCALE = 1.35
const DOCK_GAP_PX = 24

export function ArchiveCard({
  children,
  heading,
  className = '',
}: {
  children: React.ReactNode
  // Sits under the mirror mark at the head of the card.
  heading?: React.ReactNode
  className?: string
}) {
  // 0 on arrival → 1 once the mirror has fully docked.
  const [p, setP] = useState(0)
  // How far (px) the mirror travels from screen-centre to its docked spot:
  // computed from the viewport and the mirror's rendered size, so its foot
  // always lands DOCK_GAP_PX above the headline regardless of screen height.
  const [endY, setEndY] = useState(0)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const onScroll = () =>
      setP(Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * SHRINK_VH))))
    const measure = () => {
      const imgH = imgRef.current?.offsetHeight || 224
      setEndY(window.innerHeight * 0.5 - DOCK_GAP_PX - (imgH * END_SCALE) / 2)
      onScroll()
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Big and centred at p=0; docked size at p=1, eased down toward the headline.
  const scale = START_SCALE - (START_SCALE - END_SCALE) * p
  const translateY = p * endY // px

  return (
    // Borderless and transparent — the page's grey photoshoot texture shows
    // straight through, so the search area reads as part of the set wall.
    <div className={`relative ${className}`}>
      <div className="px-3 md:px-10 pb-4 md:pb-10">
        {/* Hero runway: one viewport of pure grey with the mirror pinned in
            the middle, plus the shrink distance. The mirror scales down and
            drifts to the runway's foot, where the headline takes over. */}
        <div className="relative" style={{ height: `${(1 + SHRINK_VH) * 100}vh` }}>
          <div className="sticky top-0 h-screen flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src="/myra-mirror-transparent.png"
              alt=""
              className="h-32 md:h-56 w-auto will-change-transform"
              style={{ transform: `translateY(${translateY}px) scale(${scale})` }}
            />
          </div>
        </div>
        {heading && <div className="pb-6 md:pb-9">{heading}</div>}
        {children}
      </div>
    </div>
  )
}

/**
 * One ruled row of the card. `label` is the printed caption on the left;
 * everything else is the filled-in value.
 */
export function ArchiveRow({
  label,
  children,
  className = '',
  last = false,
}: {
  label: string
  children: React.ReactNode
  className?: string
  last?: boolean
}) {
  return (
    <div className={`flex items-stretch ${last ? '' : 'border-b border-[#2B2B2B]'} ${className}`}>
      {/* Narrow on mobile: at the compact size the caption needs far less room,
          and every pixel saved here goes to the query itself — which is the
          part that has to stay readable while you type. */}
      <div className="shrink-0 w-[124px] md:w-[230px] border-r border-[#2B2B2B] flex items-center md:items-end px-3 md:px-5 py-3 md:pb-3 md:pt-5">
        <span className="myra-field leading-tight whitespace-nowrap md:whitespace-normal">{label}</span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

/**
 * A cell whose value is chosen from a panel. Shows the chosen value, or a
 * muted prompt when still blank — the equivalent of an unfilled line.
 */
export function ArchiveCell({
  value,
  onClick,
  open,
}: {
  value: string | null
  onClick: () => void
  open: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full h-full text-left px-4 md:px-7 py-5 md:py-7 flex items-center justify-between gap-3 hover:bg-[#F4F3F0] transition-colors"
    >
      <span
        className={`myra-field truncate ${value ? '' : 'opacity-45'}`}
      >
        {value ?? '—'}
      </span>
      <span className="myra-field shrink-0">{open ? '▲' : '▾'}</span>
    </button>
  )
}
