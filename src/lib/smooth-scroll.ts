'use client'

import { useCallback } from 'react'
import { useLenis } from 'lenis/react'

type ScrollTarget = number | HTMLElement

type ScrollOptions = {
  /** Jump with no animation. */
  immediate?: boolean
  /** Pixels to shift the final position by (negative scrolls further up). */
  offset?: number
}

/**
 * Programmatic scrolling that routes through Lenis when it's running.
 *
 * Calling `window.scrollTo` / `scrollIntoView` directly while Lenis is
 * animating makes the two fight each other, so use this anywhere the app
 * scrolls itself. Falls back to native scrolling when there's no Lenis
 * instance — reduced-motion users don't get the provider at all.
 */
export function useScrollTo() {
  const lenis = useLenis()

  return useCallback(
    (target: ScrollTarget, { immediate = false, offset = 0 }: ScrollOptions = {}) => {
      if (lenis) {
        lenis.scrollTo(target, { immediate, offset })
        return
      }
      const behavior = immediate ? 'auto' : 'smooth'
      if (typeof target === 'number') {
        window.scrollTo({ top: target + offset, behavior })
      } else {
        const top = target.getBoundingClientRect().top + window.scrollY + offset
        window.scrollTo({ top, behavior })
      }
    },
    [lenis],
  )
}
