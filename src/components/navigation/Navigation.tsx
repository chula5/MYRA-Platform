'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export default function Navigation({ transparent = false }: { transparent?: boolean }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const isTransparent = transparent && !scrolled

  return (
    <nav
      className={`
        fixed top-0 left-0 right-0 z-50
        transition-all duration-500 ease-in-out
        bg-white border-b border-[#E2E0DB]
      `}
    >
      <div className="w-full px-6 md:px-12 h-16 md:h-20 grid grid-cols-3 items-center">

        {/* Left — nav links */}
        <div className="flex items-center gap-4 md:gap-8">
          <Link
            href="/feed"
            className="text-[11px] md:text-[13px] tracking-[0.18em] transition-opacity duration-300 hover:opacity-60 text-[#0A0A0A] whitespace-nowrap"
          >
            THE EDIT
          </Link>
          <Link
            href="/"
            className="text-[11px] md:text-[13px] tracking-[0.18em] transition-opacity duration-300 hover:opacity-60 text-[#0A0A0A] whitespace-nowrap"
          >
            LOOKBOOK
          </Link>
          <Link
            href="/feed"
            className="hidden sm:block text-[11px] md:text-[13px] tracking-[0.18em] transition-opacity duration-300 hover:opacity-60 text-[#0A0A0A] whitespace-nowrap"
          >
            OCCASIONS
          </Link>
        </div>

        {/* Centre — wordmark */}
        <div className="flex justify-center">
          <Link
            href="/"
            className="text-[28px] md:text-[36px] tracking-[0.25em] leading-none transition-opacity duration-300 hover:opacity-70 text-[#0A0A0A]"
          >
            MYRA
          </Link>
        </div>

        {/* Right — placeholder to keep wordmark centred */}
        <div />
      </div>
    </nav>
  )
}

// ── Minimal SVG icons ─────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7.5" cy="7.5" r="5.5" />
      <line x1="11.5" y1="11.5" x2="16.5" y2="16.5" />
    </svg>
  )
}

function AccountIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="6" r="3.5" />
      <path d="M2 16c0-3.866 3.134-7 7-7s7 3.134 7 7" />
    </svg>
  )
}

function BagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="6" width="12" height="11" rx="1" />
      <path d="M6 6V5a3 3 0 016 0v1" />
    </svg>
  )
}
