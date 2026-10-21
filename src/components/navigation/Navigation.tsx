'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
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

        {/* Left — the site menu (HOME / PRESS); flex-1 keeps the wordmark centred. */}
        <div className="flex flex-1 min-w-0 items-center justify-start gap-3 sm:gap-5 md:gap-6">
          <SiteMenu textColor={textColor} />
        </div>

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
              href={authed ? '/me' : '/signin'}
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

// The site's pages. PRESS lists every article written about MYRA (lib/press.ts).
const SITE_PAGES = [
  { href: '/', label: 'HOME' },
  { href: '/press', label: 'PRESS' },
]

function SiteMenu({ textColor }: { textColor: string }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const isCurrent = (href: string) => (href === '/' ? pathname === '/' : pathname?.startsWith(href))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-2 sm:gap-3 whitespace-nowrap text-[15px] sm:text-[17px] lg:text-[20px] leading-none tracking-[0.12em] hover:opacity-60 transition-colors duration-500 ${textColor}`}
      >
        <MenuIcon open={open} />
        <span className="hidden sm:inline">MENU</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-4 md:mt-6 min-w-[220px] sm:min-w-[260px] bg-white border border-[#E2E0DB] shadow-[0_12px_40px_rgba(0,0,0,0.08)] py-2"
        >
          {SITE_PAGES.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              role="menuitem"
              className={`flex items-center justify-between gap-6 px-6 py-4 text-[17px] sm:text-[19px] lg:text-[20px] tracking-[0.14em] transition-colors duration-300 hover:bg-[#F4F3F0] ${
                isCurrent(p.href) ? 'text-[#4A4E57]' : 'text-[#7C838B]'
              }`}
            >
              {p.label}
              {isCurrent(p.href) && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-[#4A4E57]" />}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      {open ? (
        <>
          <line x1="5" y1="5" x2="19" y2="19" />
          <line x1="19" y1="5" x2="5" y2="19" />
        </>
      ) : (
        <>
          <line x1="3" y1="7" x2="21" y2="7" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="17" x2="21" y2="17" />
        </>
      )}
    </svg>
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
