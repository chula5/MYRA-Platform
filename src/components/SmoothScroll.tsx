'use client'

import { useEffect, useState } from 'react'
import { ReactLenis } from 'lenis/react'
import 'lenis/dist/lenis.css'

/**
 * Lenis smooth scrolling for the whole site.
 *
 * Touch scrolling stays native (Lenis default) so the iOS/Capacitor shell keeps
 * its momentum feel — this mainly smooths desktop wheel + trackpad. Anyone with
 * "reduce motion" turned on gets plain native scrolling.
 */
export default function SmoothScroll({ children }: { children: React.ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  if (reducedMotion) return <>{children}</>

  return (
    <ReactLenis root options={{ duration: 1.2, anchors: true }}>
      {children}
    </ReactLenis>
  )
}
