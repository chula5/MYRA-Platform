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
  const textColor = isTransparent ? 'text-white' : 'text-[#0A0A0A]'

  return (
    <nav
      className={`
        fixed top-0 left-0 right-0 z-50
        transition-all duration-500 ease-in-out
        ${isTransparent
          ? 'bg-transparent border-b border-transparent'
          : 'bg-white border-b border-[#E2E0DB]'}
      `}
    >
      <div className="w-full px-4 md:px-10 h-14 flex items-center justify-between gap-3">

        {/* Left — nav links */}
        <div className="flex items-center gap-3 sm:gap-5 md:gap-6 flex-1 min-w-0">
          <Link href="/feed" className={`text-[9px] sm:text-[10px] tracking-[0.12em] sm:tracking-[0.15em] hover:opacity-60 transition-colors duration-500 whitespace-nowrap ${textColor}`}>
            THE EDIT
          </Link>
          <Link href="/" className={`text-[9px] sm:text-[10px] tracking-[0.12em] sm:tracking-[0.15em] hover:opacity-60 transition-colors duration-500 whitespace-nowrap ${textColor}`}>
            LOOKBOOK
          </Link>
          <Link href="/feed" className={`hidden md:block text-[10px] tracking-[0.15em] hover:opacity-60 transition-colors duration-500 whitespace-nowrap ${textColor}`}>
            OCCASIONS
          </Link>
        </div>

        {/* Centre — wordmark */}
        <div className="flex justify-center shrink-0">
          <Link href="/" className={`text-[18px] sm:text-[22px] tracking-[0.22em] sm:tracking-[0.25em] leading-none hover:opacity-70 transition-colors duration-500 ${textColor}`}>
            MYRA
          </Link>
        </div>

        {/* Right — social links */}
        <div className="flex-1 flex items-center justify-end gap-4">
          <a
            href="https://www.instagram.com/myra.assistant?igsh=MWdhaWxsNTY4ZnF5ZA%3D%3D&utm_source=qr"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Instagram"
            className={`hover:opacity-60 transition-colors duration-500 ${textColor}`}
          >
            <InstagramIcon />
          </a>
          <a
            href="https://www.tiktok.com/@myra.assistant?_r=1&_t=ZN-95flx59mEbu"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="TikTok"
            className={`hover:opacity-60 transition-colors duration-500 ${textColor}`}
          >
            <TikTokIcon />
          </a>
        </div>
      </div>
    </nav>
  )
}

function InstagramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="4.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

function TikTokIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.6 6.8a5.7 5.7 0 01-3.3-1.1 5.7 5.7 0 01-2-3.2h-3.1v12.1a2.7 2.7 0 11-2-2.6V8.9a5.8 5.8 0 104.9 5.7V9.3a8.7 8.7 0 005.5 1.9z" />
    </svg>
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
