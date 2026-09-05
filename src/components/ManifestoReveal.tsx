'use client'

import { useEffect, useRef, useState } from 'react'
import ApplyButton from '@/components/ApplyButton'

// The manifesto under the mirror, revealed word by word from left to right as it
// scrolls up through the viewport. Each word interpolates from faint to full as
// the scroll sweep reaches it, so the sentence "writes itself in" on the way up.
const TEXT =
  'FED UP WITH THE NOISE? SO WERE WE. TOO MANY TABS, TOO MANY OPTIONS, AND A WARDROBE THAT STILL NEVER WORKS. WE WANT YOU SEEING LESS, BUT MORE OF WHAT YOU LIKE. SMALLER COLLECTIONS, REFINED TO YOUR TASTE.'

export default function ManifestoReveal() {
  const ref = useRef<HTMLParagraphElement>(null)
  const [p, setP] = useState(0)
  const words = TEXT.split(' ')
  const n = words.length

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const vh = window.innerHeight
        const top = el.getBoundingClientRect().top
        // Fully faint when the text's top is 90% down the viewport; fully lit by
        // the time it reaches 38% up — a comfortable reveal on the way past.
        const prog = (vh * 0.9 - top) / (vh * 0.9 - vh * 0.38)
        setP(Math.min(1, Math.max(0, prog)))
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="max-w-[1600px] mx-auto text-center px-6 lg:px-12">
      <p
        ref={ref}
        className="tracking-[0.02em] leading-[1.35] font-medium text-[clamp(28px,4.4vw,64px)]"
      >
        {words.map((w, i) => {
          // Each word lights over one "unit" of progress, in order — a left-to-
          // right, top-to-bottom sweep as p goes 0 → 1.
          const wp = Math.min(1, Math.max(0, p * n - i))
          return (
            <span key={i} style={{ color: '#4A4E57', opacity: 0.16 + 0.84 * wp }}>
              {w}{i < n - 1 ? ' ' : ''}
            </span>
          )
        })}
      </p>
      <div className="mt-12 sm:mt-16">
        <ApplyButton className="inline-flex items-center gap-3.5 rounded-full bg-[#0A0A0A] text-white px-14 py-6 text-[16px] sm:text-[18px] tracking-[0.2em] hover:opacity-85 transition-opacity" />
      </div>
    </div>
  )
}
