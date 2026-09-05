'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'

// Scroll-driven collage: the images begin as a tight stack in the centre and,
// as the section scrolls past, spread out to their scattered resting places,
// uncovering the headline in the middle. Positions are viewport-relative (vw/vh)
// so the spread scales with the screen; widths clamp so nothing dwarfs a phone.
//
// x/y are the FINAL offsets from centre (at full scroll), r the final rotation,
// wvw/wpx the width (vw, capped at wpx), z the stacking order in the pile.
type Piece = { src: string; x: number; y: number; r: number; wvw: number; wpx: number; z: number }

const PIECES: Piece[] = [
  { src: '/scatter/1.webp', x: -20, y: -32, r: -3, wvw: 46, wpx: 560, z: 9 },
  { src: '/scatter/2.webp', x: -37, y: -16, r: -5, wvw: 22, wpx: 330, z: 3 },
  { src: '/scatter/3.webp', x: 15, y: -32, r: 3, wvw: 22, wpx: 330, z: 5 },
  { src: '/scatter/4.webp', x: 36, y: -16, r: 6, wvw: 23, wpx: 345, z: 6 },
  { src: '/scatter/5.webp', x: -35, y: 23, r: -4, wvw: 23, wpx: 345, z: 4 },
  { src: '/scatter/6.webp', x: -9, y: 35, r: 2, wvw: 22, wpx: 330, z: 7 },
  { src: '/scatter/7.webp', x: 34, y: 23, r: 4, wvw: 23, wpx: 345, z: 6 },
  { src: '/scatter/8.webp', x: 38, y: 34, r: 7, wvw: 20, wpx: 310, z: 5 },
]

export default function ScatterHero() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const pieceRefs = useRef<(HTMLDivElement | null)[]>([])
  const textRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    let raf = 0

    const apply = () => {
      const total = section.offsetHeight - window.innerHeight
      const scrolled = -section.getBoundingClientRect().top
      const p = Math.min(1, Math.max(0, scrolled / Math.max(1, total)))
      // easeInOutCubic — slow start, so the stack holds a beat before it opens.
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2

      // Big at the start (a hero image), a touch smaller once spread so the
      // scattered pieces sit clear of the headline.
      const scale = 1 - 0.15 * e
      for (let i = 0; i < PIECES.length; i++) {
        const el = pieceRefs.current[i]
        if (!el) continue
        const pc = PIECES[i]
        el.style.transform =
          `translate(-50%, -50%) translate(${pc.x * e}vw, ${pc.y * e}vh) rotate(${pc.r * e}deg) scale(${scale})`
      }
      if (textRef.current) {
        // Headline fades in over the middle third of the spread.
        textRef.current.style.opacity = String(Math.min(1, Math.max(0, (p - 0.35) / 0.45)))
      }
    }

    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(apply)
    }

    apply()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <section ref={sectionRef} className="myra-texture relative" style={{ height: '230vh' }}>
      <div className="sticky top-0 h-screen overflow-hidden">
        {PIECES.map((pc, i) => (
          <div
            key={pc.src}
            ref={(el) => { pieceRefs.current[i] = el }}
            className="absolute left-1/2 top-1/2 will-change-transform"
            style={{ width: `clamp(88px, ${pc.wvw}vw, ${pc.wpx}px)`, zIndex: pc.z, transform: 'translate(-50%, -50%)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pc.src}
              alt=""
              loading="lazy"
              className="w-full h-auto block shadow-[0_24px_60px_rgba(0,0,0,0.16)]"
            />
          </div>
        ))}

        {/* Headline + CTA, revealed as the pile opens. */}
        <div
          ref={textRef}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center px-6 pointer-events-none"
          style={{ opacity: 0 }}
        >
          <h2 className="text-[#0A0A0A] font-semibold uppercase tracking-[0.02em] leading-[0.92] text-[clamp(38px,8vw,116px)]">
            OUTFITS,<br />NOT ITEMS
          </h2>
          <Link
            href="/earlyaccess/join"
            className="pointer-events-auto mt-8 sm:mt-10 inline-flex items-center gap-3 rounded-full bg-[#0A0A0A] text-white px-8 py-4 text-[12px] sm:text-[13px] tracking-[0.2em] hover:opacity-85 transition-opacity"
          >
            APPLY NOW <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  )
}
