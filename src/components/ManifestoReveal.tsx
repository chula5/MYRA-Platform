'use client'

import { useEffect, useRef, useState } from 'react'
import ApplyButton from '@/components/ApplyButton'

// The manifesto, revealed word by word from left to right as you scroll. The
// paragraph is PINNED in the centre of the screen while it reveals, so it
// finishes fully black in the middle of the view (not half-faded at the page
// foot). The section is taller than the viewport; the sticky inner holds the
// text centred and the reveal plays over that extra scroll distance.
const TEXT =
  'FED UP WITH THE NOISE? SO WERE WE. TOO MANY TABS, TOO MANY OPTIONS, AND A WARDROBE THAT STILL NEVER WORKS. WE WANT YOU SEEING LESS, BUT MORE OF WHAT YOU LIKE. SMALLER COLLECTIONS, REFINED TO YOUR TASTE.'

export default function ManifestoReveal() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const [p, setP] = useState(0)
  const words = TEXT.split(' ')
  const n = words.length

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    let raf = 0
    const apply = () => {
      const total = section.offsetHeight - window.innerHeight
      const scrolled = -section.getBoundingClientRect().top
      // Reveal finishes at ~half the pinned scroll, so the last word turns full
      // black while the paragraph is still centred; then it holds, fully lit.
      const prog = scrolled / Math.max(1, total * 0.5)
      setP(Math.min(1, Math.max(0, prog)))
    }
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(apply) }
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
    <section ref={sectionRef} className="relative" style={{ height: '160vh' }}>
      <div className="sticky top-0 h-screen flex flex-col items-center justify-center px-6 lg:px-12">
        <p className="max-w-[1600px] mx-auto text-center tracking-[0.02em] leading-[1.35] font-medium text-[clamp(28px,4.4vw,64px)]">
          {words.map((w, i) => {
            const wp = Math.min(1, Math.max(0, p * n - i))
            return (
              <span key={i} style={{ color: '#4A4E57', opacity: 0.16 + 0.84 * wp }}>
                {w}{i < n - 1 ? ' ' : ''}
              </span>
            )
          })}
        </p>
        <ApplyButton className="mt-12 sm:mt-16 inline-flex items-center gap-3.5 rounded-full bg-[#0A0A0A] text-white px-14 py-6 text-[16px] sm:text-[18px] tracking-[0.2em] hover:opacity-85 transition-opacity" />
      </div>
    </section>
  )
}
