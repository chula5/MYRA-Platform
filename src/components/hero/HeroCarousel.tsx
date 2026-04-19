'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'

const SLIDES = [
  { src: '/Chanel.png', alt: 'Chanel' },
  { src: '/Saint Laurent.png', alt: 'Saint Laurent' },
  { src: '/Dior.png', alt: 'Dior' },
]

const INTERVAL_MS = 5000

/**
 * Full-bleed auto-rotating hero. Cross-fades between images every 5 seconds.
 * Respects prefers-reduced-motion (stays on the first image).
 */
export default function HeroCarousel() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    const id = setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length)
    }, INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="absolute inset-0">
      {SLIDES.map((slide, i) => (
        <div
          key={slide.src}
          className={`absolute inset-0 transition-opacity duration-[1500ms] ease-in-out ${
            i === index ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <Image
            src={slide.src}
            alt={slide.alt}
            fill
            priority={i === 0}
            className="object-cover"
            sizes="100vw"
          />
        </div>
      ))}

      {/* Subtle dark overlay for text legibility */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent pointer-events-none" />

      {/* Progress dots */}
      <div className="absolute bottom-5 sm:bottom-6 left-0 right-0 flex justify-center gap-2 pointer-events-none">
        {SLIDES.map((_, i) => (
          <span
            key={i}
            className={`block h-[2px] w-8 transition-all duration-500 ${
              i === index ? 'bg-white/90' : 'bg-white/30'
            }`}
            aria-hidden
          />
        ))}
      </div>
    </div>
  )
}
