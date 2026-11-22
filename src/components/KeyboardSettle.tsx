'use client'

import { useEffect } from 'react'

/**
 * On a phone, the keyboard closing can leave the page scrolled out of bounds:
 * the header drops a band below the clock, or the tab bar floats above the
 * home bar, until she touches the page again (Chloe, 2026-11-22, after a
 * Browse search). Once the keyboard has gone, put the page back in bounds.
 * The iPhone app does the same natively (MyraViewController); this covers the
 * builds already on phones and Safari.
 */
export default function KeyboardSettle() {
  useEffect(() => {
    if (!(navigator.maxTouchPoints > 0)) return
    const vv = window.visualViewport
    let timer: ReturnType<typeof setTimeout> | undefined
    const typing = () => {
      const el = document.activeElement as HTMLElement | null
      return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
    }
    const settle = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (typing()) return // the keyboard is still up
        const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
        const y = Math.min(Math.max(window.scrollY, 0), max)
        const off = (vv?.offsetTop ?? 0) !== 0 || window.scrollY !== y || window.scrollX !== 0
        if (!off) return
        // A scroll to where she already is can be ignored; a one-pixel step
        // first makes the web view re-seat the viewport.
        window.scrollTo(0, y > 0 ? y - 1 : y + 1)
        window.scrollTo(0, y)
      }, 150)
    }
    document.addEventListener('focusout', settle)
    vv?.addEventListener('resize', settle)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('focusout', settle)
      vv?.removeEventListener('resize', settle)
    }
  }, [])
  return null
}
