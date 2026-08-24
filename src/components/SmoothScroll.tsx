'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ReactLenis } from 'lenis/react'
import 'lenis/dist/lenis.css'

/**
 * Lenis smooth scrolling for the whole site.
 *
 * Touch scrolling stays native (Lenis default) so the iOS/Capacitor shell keeps
 * its momentum feel — this mainly smooths desktop wheel + trackpad. Anyone with
 * "reduce motion" turned on gets plain native scrolling.
 */
// Admin-gated tool routes, which manage their own scrolling.
const NATIVE_SCROLL_PREFIXES = ['/admin', '/studio']

export default function SmoothScroll({ children }: { children: React.ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // The admin tools scroll natively. Their grids, maps and expanding cards
  // resize constantly, and Lenis's cached bounds fall out of sync with the
  // document — you end up unable to reach the top of the page. /studio holds
  // the Taste Inspector and Outfit Review: both are admin-gated, both are
  // reached from the admin nav, and both were still running Lenis because the
  // check only looked at /admin.
  const nativeScroll = NATIVE_SCROLL_PREFIXES.some((p) => pathname?.startsWith(p))
  if (reducedMotion || nativeScroll) return <>{children}</>

  return (
    <ReactLenis root options={{ duration: 1.2, anchors: true }}>
      {children}
    </ReactLenis>
  )
}
