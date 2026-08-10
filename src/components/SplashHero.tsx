'use client'

// ARRIVAL SCREEN — the silver texture fills the viewport with the MYRA mirror
// standing large in the centre. As the visitor scrolls, the mirror glides up
// and shrinks until it lands EXACTLY inside the MYRA wordmark in the nav,
// where the mirror glyph lives — then hands off to the nav logo. The feed and
// its search bar take over beneath.

import { useEffect, useRef, useState } from 'react'

// Measured from myra-logo-black.png (974×339): the mirror glyph occupies
// x 336–477, y 12–326 — i.e. 41.74% across the wordmark, 92.63% of its height.
const MIRROR_FX = 0.4174
const MIRROR_FY = 0.4985
const MIRROR_FH = 0.9263

export default function SplashHero() {
  const ref = useRef<HTMLDivElement>(null)
  const [p, setP] = useState(0)
  // Where the nav's mirror glyph actually is, measured live from the DOM.
  const [target, setTarget] = useState<{ x: number; y: number; h: number } | null>(null)
  const [vp, setVp] = useState({ w: 1440, h: 900 })

  useEffect(() => {
    let raf = 0
    const measure = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight })
      const h = ref.current?.offsetHeight ?? window.innerHeight
      setP(Math.min(1, Math.max(0, window.scrollY / (h * 0.8))))

      // The nav logo — target the mirror glyph inside it.
      const logo = document.querySelector('nav img[alt="MYRA"]') as HTMLImageElement | null
      if (logo) {
        const r = logo.getBoundingClientRect()
        if (r.width > 0) {
          setTarget({
            x: r.left + MIRROR_FX * r.width,
            y: r.top + MIRROR_FY * r.height,
            h: MIRROR_FH * r.height,
          })
        }
      }
    }
    measure()
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    const t = setTimeout(measure, 400) // after the logo image loads
    return () => {
      cancelAnimationFrame(raf); clearTimeout(t)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  // Big mirror starts centred in the viewport…
  //
  // On a phone the old 72%-of-viewport-height made the mirror taller than the
  // grey panel it sits on and nearly as wide as the screen. Narrow screens get a
  // smaller mirror, bounded by WIDTH as well as height so it always sits inside
  // the texture rather than spilling past it.
  const narrow = vp.w < 640
  const startH = narrow
    ? Math.min(340, vp.h * 0.38, vp.w * 0.72)
    : Math.min(820, vp.h * 0.72)
  const startX = vp.w / 2
  const startY = vp.h / 2
  // …and glides to the nav's mirror glyph.
  const endX = target?.x ?? startX
  const endY = target?.y ?? 28
  const endH = target?.h ?? 22

  // Ease-out so it settles rather than snapping.
  const e = 1 - Math.pow(1 - p, 2)
  const x = startX + (endX - startX) * e
  const y = startY + (endY - startY) * e
  const scale = (startH + (endH - startH) * e) / startH
  // Fades only right at the end, as the nav's own logo takes over.
  const fade = p < 0.88 ? 1 : Math.max(0, 1 - (p - 0.88) / 0.12)

  return (
    <div ref={ref} className="relative w-full overflow-hidden bg-[#A7A89E] aspect-[745/1001] sm:aspect-[745/1001]">
      {/* Texture FILLS the screen — no letterboxing, no blended field. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/silver2-hero.webp"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* The mirror — fixed, so it holds position while the page scrolls and
          glides into the nav wordmark. */}
      <div
        className="fixed z-40 pointer-events-none will-change-transform"
        style={{
          left: 0,
          top: 0,
          transform: `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale})`,
          opacity: fade,
          visibility: p >= 1 ? 'hidden' : 'visible',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/myra-mirror-white.png"
          alt="MYRA"
          className="w-auto drop-shadow-[0_6px_28px_rgba(0,0,0,0.30)]"
          style={{ height: `${startH}px` }}
        />
      </div>

    </div>
  )
}
