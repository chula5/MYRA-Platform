'use client'

// THE SCREEN, PUT BACK — after the keyboard goes away.
//
// On an iPhone, typing in a box that is pinned to the screen (the stylist's
// chat, a search) makes the web view slide the page up to keep the box in
// sight. When the keyboard goes it does not always slide back: the page is
// left drawn full height while everything pinned — the strip under the clock,
// the header, the tab bar, the STYLIST button — stays where the keyboard put
// it. A member's sale page showed the tab bar across the middle of the screen
// and no header at all (2026-11-21).
//
// Whenever nothing is being typed into and the view is still shifted, the page
// is told to stand where it already is, which puts the pinned things back at
// the edges. A pinch-zoom is hers and is left alone.

import { useEffect } from 'react'

export default function ViewportSettle() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const typing = () => {
      const el = document.activeElement as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    }
    const settle = () => {
      if (timer) clearTimeout(timer)
      // After the keyboard has finished leaving, and focus has landed wherever it is going.
      timer = setTimeout(() => {
        if (typing() || Math.abs(vv.scale - 1) > 0.01) return
        if (vv.offsetTop > 1 || vv.offsetLeft > 1) window.scrollTo(window.scrollX, window.scrollY)
      }, 300)
    }
    document.addEventListener('focusout', settle)
    vv.addEventListener('resize', settle)
    vv.addEventListener('scroll', settle)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('focusout', settle)
      vv.removeEventListener('resize', settle)
      vv.removeEventListener('scroll', settle)
    }
  }, [])
  return null
}
