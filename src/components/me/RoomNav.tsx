'use client'

// Her rooms, as a row of drawn icons across the whole screen — a search over
// them, the rooms under it. The same bar serves her own pages (each room is a
// link) and HER VIEW in the admin (each room is a button), so what Chloe tests
// is the bar the client uses.
//
// The icons are drawn here as line art rather than loaded: one stroke weight,
// one colour, and they stay crisp at any size.

import Link from 'next/link'
import { useState } from 'react'

export type RoomId = 'for_you' | 'all_looks' | 'dressing_room' | 'magazine' | 'inspiration' | 'threads' | 'profile'

export interface Room {
  id: RoomId
  label: string
  /** What the room is called when the bar sits in the header. */
  short: string
  href: string
}

export const ROOMS: Room[] = [
  { id: 'for_you', label: 'For You', short: 'For You', href: '/me' },
  { id: 'all_looks', label: 'Your Looks', short: 'Looks', href: '/me/looks' },
  { id: 'dressing_room', label: 'Dressing Room', short: 'Dressing', href: '/me/dressing-room' },
  { id: 'inspiration', label: 'Inspiration', short: 'Inspiration', href: '/me/inspiration' },
  { id: 'magazine', label: 'MYRA Magazine', short: 'Magazine', href: '/me/magazine' },
  { id: 'threads', label: 'Threads', short: 'Threads', href: '/me/threads' },
  { id: 'profile', label: 'You', short: 'You', href: '/me/profile' },
]

/** The rooms that sit in the row. YOU stands on its own, in the corner. */
export const ROW_ROOMS = ROOMS.filter((r) => r.id !== 'profile')

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** A four-point sparkle with concave sides, the way the reference draws them. */
function sparkle(cx: number, cy: number, r: number): string {
  const w = r * 0.2
  return `M${cx} ${cy - r}Q${cx + w} ${cy - w} ${cx + r} ${cy}Q${cx + w} ${cy + w} ${cx} ${cy + r}Q${cx - w} ${cy + w} ${cx - r} ${cy}Q${cx - w} ${cy - w} ${cx} ${cy - r}Z`
}

/** A garment on a hanger, hanging from the rail at y. */
function hanging(x: number, y: number): string {
  return `M${x} ${y}v3M${x - 4} ${y + 3}h8M${x - 7} ${y + 6}l3-3M${x + 7} ${y + 6}l-3-3`
    + `M${x - 7} ${y + 6}l-1.5 4 2 1.5 1-2v13h11v-13l1 2 2-1.5-1.5-4`
}

function Icon({ id }: { id: RoomId }) {
  const common = { viewBox: '0 0 64 64', className: 'w-full h-full', 'aria-hidden': true } as const
  switch (id) {
    case 'for_you': // her mirror, standing
      return (
        <svg {...common}>
          <rect x="21" y="8" width="22" height="38" rx="2" {...S} />
          <path d="M26 14l-2 9M31 14l-2 9" {...S} opacity="0.55" />
          <path d="M43 46l6 8M21 46l-6 8" {...S} />
          <path d="M26 46v10M38 46v10" {...S} />
        </svg>
      )
    case 'all_looks': // a rail of clothes, on its feet
      return (
        <svg {...common}>
          <path d="M10 14h44" {...S} />
          <path d="M13 14v40M51 14v40M8 54h10M46 54h10" {...S} />
          <path d={hanging(24, 14)} {...S} />
          <path d={hanging(38, 14)} {...S} />
          <path d={hanging(31, 14)} {...S} opacity="0.85" />
        </svg>
      )
    case 'dressing_room': // the wardrobe, doors open, stool inside
      return (
        <svg {...common}>
          <rect x="21" y="10" width="22" height="34" {...S} />
          <path d="M21 10L9 6v42l12-4z" {...S} />
          <path d="M43 10l12-4v42l-12-4z" {...S} />
          <path d="M18 27v4M46 27v4" {...S} />
          <rect x="26" y="34" width="12" height="7" rx="2" {...S} />
          <path d="M28 41v3M36 41v3" {...S} />
        </svg>
      )
    case 'inspiration': // sparkles
      return (
        <svg {...common}>
          <path d={sparkle(25, 30, 15)} {...S} />
          <path d={sparkle(44, 18, 8)} {...S} />
          <path d={sparkle(43, 42, 9)} {...S} />
        </svg>
      )
    case 'magazine': // an open magazine: a dress on one page, pieces on the other
      return (
        <svg {...common}>
          <path d="M32 16v34" {...S} />
          <path d="M32 16c-5-4-12-5-20-4v34c8-1 15 0 20 4M32 16c5-4 12-5 20-4v34c-8-1-15 0-20 4" {...S} />
          <path d="M22 24l3 2 3-2 2 6-2 2 2 10h-10l2-10-2-2z" {...S} />
          <path d="M39 24l2 1.5 2-1.5 1.5 4-1.5 1.5 1.5 6h-7l1.5-6-1.5-1.5z" {...S} />
          <rect x="38" y="38" width="8" height="6" rx="1" {...S} />
        </svg>
      )
    case 'threads': // a spool wound with thread, and the needle through it
      return (
        <svg {...common}>
          <ellipse cx="30" cy="16" rx="15" ry="5" {...S} />
          <path d="M15 16v32M45 16v32" {...S} />
          <ellipse cx="30" cy="48" rx="15" ry="5" {...S} />
          <path d="M16 23h28M16 29h28M16 35h28M16 41h28" {...S} opacity="0.55" />
          <ellipse cx="30" cy="16" rx="4" ry="1.6" {...S} />
          <path d="M48 10L22 52" {...S} />
          <path d="M45 13c3 1 4 4 2 6" {...S} />
          {/* the loose end, trailing away */}
          <path d="M45 44c8 2 12 8 6 11s-14-2-9-6" {...S} />
        </svg>
      )
    case 'profile':
      return (
        <svg {...common}>
          <circle cx="32" cy="23" r="10" {...S} />
          <path d="M14 52c2-10 9.5-15 18-15s16 5 18 15" {...S} />
        </svg>
      )
  }
}

/**
 * The bar. `onSelect` makes each room a button (HER VIEW); without it each
 * room is a link (her own pages).
 */
export default function RoomNav({
  active, onSelect, onSearch, compact = false, searchPlaceholder = 'Search your looks, your pieces, your inspiration',
}: {
  active: RoomId
  onSelect?: (id: RoomId) => void
  onSearch?: (query: string) => void
  /** Sits in the header beside MYRA, rooms and search on one line to the right. */
  compact?: boolean
  searchPlaceholder?: string
}) {
  const [query, setQuery] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    if (onSearch) onSearch(q)
    else window.location.href = `/me/looks?q=${encodeURIComponent(q)}`
  }

  const room = (r: Room) => {
    const on = r.id === active
    const inner = (
      <>
        <span className={`block ${compact ? 'w-[42px] h-[42px]' : 'w-[68px] h-[68px] sm:w-[86px] sm:h-[86px]'} mx-auto transition-colors ${on ? 'text-[#2B2B2B]' : 'text-[#55534E] group-hover:text-[#2B2B2B]'}`}>
          <Icon id={r.id} />
        </span>
        <span className={`block ${compact ? 'mt-1.5 text-[18px]' : 'mt-3 text-[22px] sm:text-[24px]'} tracking-[0.02em] transition-colors ${on ? 'text-[#2B2B2B]' : 'text-[#55534E] group-hover:text-[#2B2B2B]'}`}>
          {compact ? r.short : r.label}
        </span>
        <span className={`block mx-auto ${compact ? 'mt-1' : 'mt-2'} h-px w-10 ${on ? 'bg-[#2B2B2B]' : 'bg-transparent'}`} />
      </>
    )
    const cls = compact ? 'group text-center px-2 shrink-0 w-[124px] whitespace-nowrap' : 'group text-center px-1'
    return onSelect ? (
      <button key={r.id} type="button" onClick={() => onSelect(r.id)} className={cls}>{inner}</button>
    ) : (
      <Link key={r.id} href={r.href} className={cls}>{inner}</Link>
    )
  }

  const search = (
    <form onSubmit={submit} className={compact ? 'w-full max-w-[200px]' : 'w-full'}>
      <div className={`flex items-center gap-3 bg-[rgba(255,255,255,0.55)] rounded-full border border-[rgba(43,43,43,0.15)] ${compact ? 'px-5 py-2.5' : 'px-7 py-4'}`}>
        <svg viewBox="0 0 24 24" className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} text-[#55534E] shrink-0`} aria-hidden>
          <circle cx="11" cy="11" r="7" {...S} />
          <path d="M16.5 16.5L21 21" {...S} />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={compact ? 'Search' : searchPlaceholder}
          aria-label="Search"
          className={`flex-1 min-w-0 ${compact ? 'text-[19px]' : 'text-[21px]'} text-[#2B2B2B] placeholder:text-[#6E6B65] bg-transparent focus:outline-none`}
        />
      </div>
    </form>
  )

  if (compact) {
    return (
      <div className="flex items-center justify-end gap-4 w-full">
        {search}
        <nav data-lenis-prevent className="flex items-start gap-1 overflow-x-auto">
          {ROW_ROOMS.map(room)}
        </nav>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="w-full px-6 sm:px-10 pt-7 pb-6">
        {/* Search, wide and quiet */}
        <form onSubmit={submit} className="w-full">
          <div className="flex items-center gap-4 bg-[rgba(255,255,255,0.55)] rounded-full border border-[rgba(43,43,43,0.15)] px-7 py-4">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-[#55534E] shrink-0" aria-hidden>
              <circle cx="11" cy="11" r="7" {...S} />
              <path d="M16.5 16.5L21 21" {...S} />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label="Search"
              className="flex-1 text-[21px] text-[#2B2B2B] placeholder:text-[#6E6B65] bg-transparent focus:outline-none"
            />
          </div>
        </form>

        {/* The rooms, spread across the screen */}
        <nav data-lenis-prevent className="mt-8 w-full grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-x-2 gap-y-8 items-start">
          {ROW_ROOMS.map((r) => {
            const on = r.id === active
            const inner = (
              <>
                <span className={`block w-[54px] h-[54px] sm:w-[68px] sm:h-[68px] mx-auto transition-colors ${on ? 'text-[#2B2B2B]' : 'text-[#55534E] group-hover:text-[#2B2B2B]'}`}>
                  <Icon id={r.id} />
                </span>
                <span className={`block mt-3 text-[20px] sm:text-[22px] tracking-[0.02em] transition-colors ${on ? 'text-[#2B2B2B]' : 'text-[#55534E] group-hover:text-[#2B2B2B]'}`}>
                  {r.label}
                </span>
                <span className={`block mx-auto mt-2 h-px w-10 ${on ? 'bg-[#2B2B2B]' : 'bg-transparent'}`} />
              </>
            )
            const cls = 'group text-center px-1'
            return onSelect ? (
              <button key={r.id} type="button" onClick={() => onSelect(r.id)} className={cls}>{inner}</button>
            ) : (
              <Link key={r.id} href={r.href} className={cls}>{inner}</Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
