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

export type RoomId = 'for_you' | 'all_looks' | 'dressing_room' | 'magazine' | 'inspiration' | 'profile'

export interface Room {
  id: RoomId
  label: string
  href: string
}

export const ROOMS: Room[] = [
  { id: 'for_you', label: 'For You', href: '/me' },
  { id: 'all_looks', label: 'Your Looks', href: '/me/looks' },
  { id: 'dressing_room', label: 'Dressing Room', href: '/me/dressing-room' },
  { id: 'inspiration', label: 'Inspiration', href: '/me/inspiration' },
  { id: 'magazine', label: 'MYRA Magazine', href: '/me/magazine' },
  { id: 'profile', label: 'You', href: '/me/profile' },
]

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function Icon({ id }: { id: RoomId }) {
  const common = { viewBox: '0 0 64 64', className: 'w-full h-full', 'aria-hidden': true } as const
  switch (id) {
    case 'for_you': // a mirror — the first thing she looks into
      return (
        <svg {...common}>
          <ellipse cx="32" cy="27" rx="16" ry="21" {...S} />
          <ellipse cx="32" cy="27" rx="11.5" ry="16.5" {...S} opacity="0.5" />
          <path d="M32 48v9M25 57h14" {...S} />
        </svg>
      )
    case 'all_looks': // a rail of looks
      return (
        <svg {...common}>
          <path d="M8 16h48" {...S} />
          <path d="M18 16v6l-5 22h10l-5-22v-6M32 16v6l-5 22h10l-5-22v-6M46 16v6l-5 22h10l-5-22v-6" {...S} />
          <path d="M32 8v8" {...S} />
        </svg>
      )
    case 'dressing_room': // wardrobe doors, open
      return (
        <svg {...common}>
          <rect x="10" y="10" width="20" height="40" {...S} />
          <rect x="34" y="10" width="20" height="40" {...S} />
          <path d="M26 28v5M38 28v5" {...S} />
          <path d="M14 50v5M50 50v5" {...S} />
        </svg>
      )
    case 'inspiration': // the pictures she keeps
      return (
        <svg {...common}>
          <path d="M32 10l3.4 9.2L45 22l-9.6 2.8L32 34l-3.4-9.2L19 22l9.6-2.8z" {...S} />
          <path d="M46 34l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z" {...S} />
          <path d="M18 38l1.5 4.2 4.2 1.5-4.2 1.5L18 49.4l-1.5-4.2-4.2-1.5 4.2-1.5z" {...S} />
        </svg>
      )
    case 'magazine': // a dress and the post it arrived in
      return (
        <svg {...common}>
          <path d="M20 12l5 4 5-4 3 9-3 3 4 20H16l4-20-3-3z" {...S} />
          <rect x="36" y="26" width="20" height="14" {...S} />
          <path d="M36 27l10 7 10-7" {...S} />
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
  active, onSelect, onSearch, searchPlaceholder = 'Search your looks, your pieces, your inspiration',
}: {
  active: RoomId
  onSelect?: (id: RoomId) => void
  onSearch?: (query: string) => void
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

  return (
    <div className="w-full bg-[#F4F2EE] border-b border-[#E2E0DB]">
      <div className="w-full px-6 sm:px-10 pt-7 pb-6">
        {/* Search, wide and quiet */}
        <form onSubmit={submit} className="w-full max-w-[1100px] mx-auto">
          <div className="flex items-center gap-4 bg-white rounded-full border border-[#E2E0DB] px-7 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-[#8C8A85] shrink-0" aria-hidden>
              <circle cx="11" cy="11" r="7" {...S} />
              <path d="M16.5 16.5L21 21" {...S} />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label="Search"
              className="flex-1 text-[21px] text-[#2B2B2B] placeholder:text-[#9A9791] bg-transparent focus:outline-none"
            />
          </div>
        </form>

        {/* The rooms, spread across the screen */}
        <nav data-lenis-prevent className="mt-8 mx-auto w-full max-w-[1500px] grid grid-cols-3 sm:grid-cols-6 gap-x-2 gap-y-8 items-start">
          {ROOMS.map((r) => {
            const on = r.id === active
            const inner = (
              <>
                <span className={`block w-[54px] h-[54px] sm:w-[68px] sm:h-[68px] mx-auto transition-colors ${on ? 'text-[#2B2B2B]' : 'text-[#7A7873] group-hover:text-[#2B2B2B]'}`}>
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
