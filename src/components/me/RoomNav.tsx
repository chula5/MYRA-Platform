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
        <span className={`block ${compact ? 'w-[clamp(42px,2.9vw,104px)] h-[clamp(42px,2.9vw,104px)]' : 'w-[clamp(68px,4vw,150px)] h-[clamp(68px,4vw,150px)]'} mx-auto transition-colors ${on ? 'text-[#2B2B2B]' : 'text-[#55534E] group-hover:text-[#2B2B2B]'}`}>
          <Icon id={r.id} />
        </span>
        <span className={`block ${compact ? 'mt-1.5 text-[clamp(18px,1.15vw,40px)]' : 'mt-3 text-[clamp(22px,1.35vw,46px)]'} tracking-[0.02em] transition-colors ${on ? 'text-[#2B2B2B]' : 'text-[#55534E] group-hover:text-[#2B2B2B]'}`}>
          {compact ? r.short : r.label}
        </span>
        <span className={`block mx-auto ${compact ? 'mt-1' : 'mt-2'} h-px w-10 ${on ? 'bg-[#2B2B2B]' : 'bg-transparent'}`} />
      </>
    )
    const cls = compact ? 'group text-center px-2 shrink-0 w-[clamp(124px,7.6vw,280px)] whitespace-nowrap' : 'group text-center px-1'
    return onSelect ? (
      <button key={r.id} type="button" data-tour={`room-${r.id}`} onClick={() => onSelect(r.id)} className={cls}>{inner}</button>
    ) : (
      <Link key={r.id} href={r.href} data-tour={`room-${r.id}`} className={cls}>{inner}</Link>
    )
  }

  // The search pill (after uiverse.io/ahmedyasserdev/funny-treefrog-48): white,
  // softly lifted, the glass on the left to search and a cross on the right to
  // clear. The focus ring is MYRA's ink rather than the original's blue.
  const iconSize = compact ? 'w-[clamp(20px,1.2vw,40px)] h-[clamp(20px,1.2vw,40px)]' : 'w-6 h-6'
  const search = (
    <form
      onSubmit={submit}
      onReset={() => setQuery('')}
      data-tour="search"
      className={`relative ${compact ? 'w-full max-w-[clamp(200px,14vw,520px)]' : 'w-full'}`}
    >
      <button type="submit" aria-label="Search" className={`absolute top-1/2 -translate-y-1/2 p-1 text-[#55534E] hover:text-[#2B2B2B] ${compact ? 'left-3' : 'left-5'}`}>
        <svg viewBox="0 0 17 16" fill="none" className={iconSize} aria-hidden>
          <path d="M7.667 12.667A5.333 5.333 0 107.667 2a5.333 5.333 0 000 10.667zM14.334 14l-2.9-2.9" stroke="currentColor" strokeWidth="1.333" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={compact ? 'Search' : searchPlaceholder}
        aria-label="Search"
        type="text"
        className={`w-full rounded-full bg-white border-2 border-transparent shadow-md transition-all duration-300 focus:outline-none focus:border-[#2B2B2B] text-[#2B2B2B] placeholder:text-[#8C8A85] ${compact
          ? 'text-[clamp(19px,1.15vw,40px)] pl-[clamp(44px,2.8vw,88px)] pr-[clamp(40px,2.6vw,80px)] py-[clamp(8px,0.6vw,22px)]'
          : 'text-[21px] pl-16 pr-14 py-4'}`}
      />
      {query && (
        <button type="reset" aria-label="Clear search" className={`absolute top-1/2 -translate-y-1/2 p-1 text-[#55534E] hover:text-[#2B2B2B] ${compact ? 'right-3' : 'right-5'}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={iconSize} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </form>
  )

  if (compact) {
    return (
      <div className="flex items-center justify-end gap-4 w-full">
        {search}
        <nav data-lenis-prevent data-tour="rooms" className="flex items-start gap-1 overflow-x-auto">
          {ROW_ROOMS.map(room)}
        </nav>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="w-full px-6 sm:px-10 pt-7 pb-6">
        {/* Search — the same pill as the header's, at her front door's scale */}
        <form onSubmit={submit} onReset={() => setQuery('')} data-tour="search" className="relative w-full md:w-1/2 mx-auto">
          <button type="submit" aria-label="Search" className="absolute top-1/2 -translate-y-1/2 left-[clamp(20px,1.3vw,44px)] p-1 text-[#55534E] hover:text-[#2B2B2B]">
            <svg viewBox="0 0 17 16" fill="none" className="w-[clamp(24px,1.4vw,48px)] h-[clamp(24px,1.4vw,48px)]" aria-hidden>
              <path d="M7.667 12.667A5.333 5.333 0 107.667 2a5.333 5.333 0 000 10.667zM14.334 14l-2.9-2.9" stroke="currentColor" strokeWidth="1.333" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Search"
            type="text"
            className="w-full rounded-full bg-white border-2 border-transparent shadow-md transition-all duration-300 focus:outline-none focus:border-[#2B2B2B] text-[clamp(21px,1.3vw,44px)] text-[#2B2B2B] placeholder:text-[#8C8A85] pl-[clamp(64px,4.2vw,140px)] pr-[clamp(60px,4vw,130px)] py-[clamp(16px,1vw,36px)]"
          />
          {query && (
            <button type="reset" aria-label="Clear search" className="absolute top-1/2 -translate-y-1/2 right-[clamp(20px,1.3vw,44px)] p-1 text-[#55534E] hover:text-[#2B2B2B]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-[clamp(24px,1.4vw,48px)] h-[clamp(24px,1.4vw,48px)]" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </form>

        {/* The rooms, spread across the screen */}
        <nav data-lenis-prevent data-tour="rooms" className="mt-9 w-full grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-x-2 gap-y-8 items-start">
          {ROW_ROOMS.map((r) => {
            const on = r.id === active
            const inner = (
              <>
                <span className={`block w-[clamp(54px,4vw,150px)] h-[clamp(54px,4vw,150px)] mx-auto transition-colors ${on ? 'text-[#2B2B2B]' : 'text-[#55534E] group-hover:text-[#2B2B2B]'}`}>
                  <Icon id={r.id} />
                </span>
                <span className={`block mt-[clamp(12px,0.8vw,28px)] text-[clamp(20px,1.35vw,46px)] tracking-[0.02em] transition-colors ${on ? 'text-[#2B2B2B]' : 'text-[#55534E] group-hover:text-[#2B2B2B]'}`}>
                  {r.label}
                </span>
                <span className={`block mx-auto mt-2 h-px w-10 ${on ? 'bg-[#2B2B2B]' : 'bg-transparent'}`} />
              </>
            )
            const cls = 'group text-center px-1'
            return onSelect ? (
              <button key={r.id} type="button" data-tour={`room-${r.id}`} onClick={() => onSelect(r.id)} className={cls}>{inner}</button>
            ) : (
              <Link key={r.id} href={r.href} data-tour={`room-${r.id}`} className={cls}>{inner}</Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
