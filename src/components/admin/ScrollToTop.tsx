'use client'

import { useEffect, useState } from 'react'

/**
 * Back to top, for the long admin pages.
 *
 * These pages run to many screens — the brand map plus its 119-brand rail, a
 * member card with nine lookbook cards — and getting back to the header meant
 * a long drag, made worse by any inner panel the cursor happened to cross.
 *
 * Deliberately not smooth-scrolled: Lenis is off across /admin and /studio
 * because their content resizes constantly, and a CSS smooth scroll over
 * thousands of pixels is slower than just being there.
 */
export default function ScrollToTop() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!show) return null

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'auto' })}
      aria-label="Back to top"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 border border-[#E2E0DB] bg-white/95 px-4 py-2.5 text-[12px] tracking-[0.12em] text-[#4A4E57] shadow-[0_2px_12px_rgba(0,0,0,0.08)] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors"
    >
      ↑ TOP
    </button>
  )
}
