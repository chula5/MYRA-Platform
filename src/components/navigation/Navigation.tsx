'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { trackLandingClick } from '@/components/analytics/LandingTracker'

export default function Navigation({ transparent = false, authed = false, showAuth = true }: { transparent?: boolean; authed?: boolean; showAuth?: boolean }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const isTransparent = transparent && !scrolled
  // On arrival the banner sits in the set-wall grey with white text and the
  // white logo; scrolling flips it to white with black text and the black
  // logo. Hero pages (transparent) stay see-through at the top instead.
  const atTop = !scrolled
  const textColor = atTop ? 'text-white' : 'text-[#4A4E57]'

  return (
    <nav
      className={`
        fixed top-0 left-0 right-0 z-50
        transition-all duration-500 ease-in-out
        ${isTransparent
          ? 'bg-transparent border-b border-transparent'
          : atTop
          ? 'myra-texture border-b border-transparent'
          : 'bg-white border-b border-[#E2E0DB]'}
      `}
    >
      <div className="w-full px-3 md:px-10 h-[72px] md:h-28 lg:h-32 flex items-center justify-between gap-2 md:gap-4">

        {/* Left — kept as a flex spacer so the wordmark stays centred. */}
        <div className="flex flex-1 min-w-0 items-center justify-start gap-3 sm:gap-5 md:gap-6" />

        {/* Centre — logo wordmark (white over the hero, black on the white nav) */}
        <div className="flex justify-center shrink-0">
          <Link href="/" aria-label="MYRA" className="relative block h-[25px] sm:h-[52px] lg:h-[68px] hover:opacity-70 transition-opacity duration-500">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/myra-logo-white.png"
              alt="MYRA"
              className={`h-full w-auto transition-opacity duration-500 ${atTop ? 'opacity-100' : 'opacity-0'}`}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/myra-logo-black.png"
              alt=""
              aria-hidden="true"
              className={`absolute inset-0 h-full w-auto transition-opacity duration-500 ${atTop ? 'opacity-0' : 'opacity-100'}`}
            />
          </Link>
        </div>

        {/* Right — social links */}
        <div className="flex-1 flex items-center justify-end gap-3 sm:gap-5 md:gap-6">
          <a
            href="https://www.instagram.com/myraassistant/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Instagram"
            onClick={() => trackLandingClick('instagram_click')}
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
          {/* Auth link — hidden on the invite-only landing (showAuth={false}). */}
          {showAuth && (
            <Link
              href={authed ? '/edit' : '/signin'}
              className={`whitespace-nowrap text-[13px] sm:text-[17px] lg:text-[20px] leading-none tracking-[0.06em] sm:tracking-[0.12em] hover:opacity-60 transition-colors duration-500 ${textColor}`}
            >
              {authed ? 'MY EDIT' : 'LOG IN / SIGN UP'}
            </Link>
          )}
        </div>
      </div>
    </nav>
  )
}

function InstagramIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="4.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

function TikTokIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
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
