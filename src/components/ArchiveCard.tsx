'use client'

// ARCHIVE CARD — the search area on the set-wall grey. It opens on the mirror
// alone: huge, centred in the grey. As the visitor scrolls, the mirror shrinks
// and glides down to dock just above the WHAT ARE YOU DRESSING FOR? headline,
// and the search sheet follows up the screen behind it.

import { useEffect, useRef, useState } from 'react'

// How much scroll (as a fraction of the viewport) the shrink plays over. The
// hero runway is 100vh + this, so the mirror finishes docking exactly as the
// headline arrives. Larger = the mirror moves more slowly as you scroll.
const SHRINK_VH = 0.9
// Where the mirror sits at p=0, as a fraction of the viewport above centre —
// it starts a little high and glides down into place.
const START_Y_VH = -0.1
// Scale of the mirror on arrival and once docked (relative to its CSS size),
// and the breathing room left between its foot and the headline.
const START_SCALE = 2.3
const END_SCALE = 1.35
const DOCK_GAP_PX = 24

// ── The mirror's wiggle ──────────────────────────────────────────────────────
// A small side-to-side sway from its foot, like a free-standing mirror nudged —
// shown while a client page loads, before the mirror settles into place.
const WIGGLE_CSS = `
@keyframes myra-mirror-wiggle {
  0%, 100% { transform: rotate(0deg); }
  20% { transform: rotate(-5deg); }
  40% { transform: rotate(4deg); }
  60% { transform: rotate(-3deg); }
  80% { transform: rotate(2deg); }
}
.myra-mirror-wiggle { animation: myra-mirror-wiggle 1.1s ease-in-out infinite; transform-origin: 50% 100%; }
@media (prefers-reduced-motion: reduce) { .myra-mirror-wiggle { animation: none; } }
`
/** Least time the mirror wiggles before it settles, so a fast load still reads as an arrival. */
const WIGGLE_MIN_MS = 900
const SETTLE_MS = 900

/**
 * intro 'scroll' (default — the landing page): the mirror shrinks as you scroll.
 * intro 'settle' (client pages): it wiggles while `loading`, then shrinks and
 * glides up near the top on its own, and the heading and options fade in
 * underneath — no scrolling needed to reach WHAT ARE YOU DRESSING FOR?
 */
export function ArchiveCard(props: {
  children: React.ReactNode
  // Sits under the mirror mark at the head of the card.
  heading?: React.ReactNode
  className?: string
  intro?: 'scroll' | 'settle'
  /** Settle mode: keep wiggling until this is false. */
  loading?: boolean
}) {
  return props.intro === 'settle' ? <SettleArchiveCard {...props} /> : <ScrollArchiveCard {...props} />
}

/** The wiggling mirror alone, centred on the set-wall grey — for a page still fetching. */
export function MirrorLoading({ label }: { label?: string }) {
  return (
    <div className="myra-pearl relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-[70vh] flex flex-col items-center justify-center gap-8">
      <style>{WIGGLE_CSS}</style>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-40 md:h-64 w-auto" />
      {label && <p className="myra-section-note">{label}</p>}
    </div>
  )
}

function SettleArchiveCard({
  children,
  heading,
  className = '',
  loading = false,
}: {
  children: React.ReactNode
  heading?: React.ReactNode
  className?: string
  loading?: boolean
}) {
  const [phase, setPhase] = useState<'wiggle' | 'settle' | 'done'>('wiggle')
  // How far (px) the mirror sits below its docked spot while centred on screen.
  const [offset, setOffset] = useState<number | null>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const startedAt = useRef(0)

  useEffect(() => {
    startedAt.current = Date.now()
    const el = dockRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setOffset(window.innerHeight / 2 - (r.top + r.height / 2))
  }, [])

  useEffect(() => {
    if (phase !== 'wiggle' || loading || offset == null) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const wait = reduce ? 0 : Math.max(0, WIGGLE_MIN_MS - (Date.now() - startedAt.current))
    const t = setTimeout(() => setPhase('settle'), wait)
    return () => clearTimeout(t)
  }, [phase, loading, offset])

  useEffect(() => {
    if (phase !== 'settle') return
    const t = setTimeout(() => setPhase('done'), SETTLE_MS)
    return () => clearTimeout(t)
  }, [phase])

  const centred = phase === 'wiggle'
  return (
    <div className={`relative ${className}`}>
      <style>{WIGGLE_CSS}</style>
      <div className="px-3 md:px-10 pb-4 md:pb-10">
        <div ref={dockRef} className="flex justify-center pt-6 md:pt-10 pb-6 md:pb-8">
          {/* Moves and scales; the image inside it wiggles — two elements so
              the two transforms never fight. */}
          <div
            className="will-change-transform"
            style={{
              transform: centred && offset != null ? `translateY(${offset}px) scale(${START_SCALE})` : 'translateY(0) scale(1)',
              transition: centred ? 'none' : `transform ${SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
              visibility: offset == null ? 'hidden' : 'visible',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/myra-mirror-transparent.png" alt="" className={`h-24 md:h-36 w-auto ${centred ? 'myra-mirror-wiggle' : ''}`} />
          </div>
        </div>
        <div
          style={{
            opacity: centred ? 0 : 1,
            transform: centred ? 'translateY(18px)' : 'none',
            transition: 'opacity 700ms ease 300ms, transform 700ms ease 300ms',
          }}
        >
          {heading && <div className="pb-6 md:pb-9">{heading}</div>}
          {children}
        </div>
      </div>
    </div>
  )
}

function ScrollArchiveCard({
  children,
  heading,
  className = '',
}: {
  children: React.ReactNode
  heading?: React.ReactNode
  className?: string
}) {
  // 0 on arrival → 1 once the mirror has fully docked.
  const [p, setP] = useState(0)
  // How far (px) the mirror travels from screen-centre to its docked spot:
  // computed from the viewport and the mirror's rendered size, so its foot
  // always lands DOCK_GAP_PX above the headline regardless of screen height.
  const [endY, setEndY] = useState(0)
  const [startY, setStartY] = useState(0)
  const imgRef = useRef<HTMLImageElement>(null)
  const runwayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Progress is measured against THIS runway's own position, not the page's
    // absolute scroll — so the mirror plays its arrival wherever the card sits
    // (e.g. below the scatter hero), rather than being used up by everything
    // scrolled through above it.
    const onScroll = () => {
      const el = runwayRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      setP(Math.min(1, Math.max(0, -top / (window.innerHeight * SHRINK_VH))))
    }
    const measure = () => {
      const imgH = imgRef.current?.offsetHeight || 224
      setEndY(window.innerHeight * 0.5 - DOCK_GAP_PX - (imgH * END_SCALE) / 2)
      setStartY(window.innerHeight * START_Y_VH)
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
  // Starts a little above centre (startY) and glides down to its docked spot.
  const translateY = startY + (endY - startY) * p // px

  return (
    // Borderless and transparent — the page's grey photoshoot texture shows
    // straight through, so the search area reads as part of the set wall.
    <div className={`relative ${className}`}>
      <div className="px-3 md:px-10 pb-4 md:pb-10">
        {/* Hero runway: one viewport of pure grey with the mirror pinned in
            the middle, plus the shrink distance. The mirror scales down and
            drifts to the runway's foot, where the headline takes over. */}
        <div ref={runwayRef} className="relative" style={{ height: `${(1 + SHRINK_VH) * 100}vh` }}>
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
