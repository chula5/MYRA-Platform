'use client'

import { useState } from 'react'

// Under the manifesto: the pitch on the left, a pick-an-occasion card on the
// right. Tap an occasion and its three looks swap in. The dots mark pieces you
// could shop — decorative here, a hint at the real hotspots inside MYRA.
type Look = { src: string; name: string; dots: [number, number][] }
type Occasion = { key: string; label: string; looks: Look[] }

const OCCASIONS: Occasion[] = [
  {
    key: 'art',
    label: 'ART EXHIBITION',
    looks: [
      { src: '/occasions/art-1.webp', name: 'SOFT TEXTURE', dots: [[50, 30], [55, 62]] },
      { src: '/occasions/art-2.webp', name: 'ONE BARE SHOULDER', dots: [[50, 30], [58, 63]] },
      { src: '/occasions/art-3.webp', name: 'THE BLACK CAPE', dots: [[56, 40], [50, 74]] },
    ],
  },
  {
    key: 'black-tie',
    label: 'BLACK TIE',
    looks: [
      { src: '/occasions/black-tie-lace.webp', name: 'LACE, ANKLE LENGTH', dots: [[41, 30], [55, 58]] },
      { src: '/occasions/black-tie-strapless.webp', name: 'STRAPLESS & SHARP', dots: [[48, 51], [62, 68]] },
      { src: '/occasions/black-tie-column.webp', name: 'THE WHITE COLUMN', dots: [[50, 34], [50, 66]] },
    ],
  },
  {
    key: 'dinner',
    label: 'DINNER',
    looks: [
      { src: '/occasions/dinner-1.webp', name: 'SATIN & PLEATS', dots: [[48, 35], [50, 68]] },
      { src: '/occasions/dinner-2.webp', name: 'THE BEADED TOP', dots: [[50, 32], [61, 51]] },
      { src: '/occasions/dinner-3.webp', name: 'RED SHOULDERS', dots: [[50, 34], [50, 70]] },
    ],
  },
]

export default function OccasionsSection() {
  const [active, setActive] = useState(OCCASIONS[0].key)
  const occ = OCCASIONS.find((o) => o.key === active) ?? OCCASIONS[0]

  return (
    <section className="relative w-full px-5 sm:px-[clamp(24px,5vw,120px)] py-[clamp(72px,10vw,220px)]">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-12 xl:gap-[clamp(48px,6vw,160px)]">
        {/* Copy */}
        <div>
          <p className="text-[clamp(18px,1.4vw,36px)] tracking-[0.22em] text-[#7C838B] mb-5 sm:mb-7">OCCASIONS</p>
          <h2 className="text-[#0A0A0A] font-semibold uppercase tracking-[0.01em] leading-[1.02] text-[clamp(34px,4.2vw,110px)]">
            START WITH WHERE YOU&rsquo;RE GOING
          </h2>
          <p className="mt-6 sm:mt-8 max-w-[62ch] text-[#4A4E57] font-medium tracking-[0.02em] leading-[1.45] text-[clamp(22px,2.2vw,54px)]">
            CHOOSE THE GALLERY OPENING, THE WEDDING OR THE MONDAY MEETING AND MYRA BUILDS COMPLETE
            LOOKS AROUND YOUR TASTE. EVERY LOOK IS SHOPPABLE, PIECE BY PIECE.
          </p>
        </div>

        {/* Pick-an-occasion card */}
        <div className="myra-pearl rounded-[26px] shadow-[0_24px_70px_-20px_rgba(0,0,0,0.3)] p-5 sm:p-[clamp(24px,2.4vw,56px)]">
          <div className="flex flex-wrap gap-2.5 sm:gap-3" role="tablist" aria-label="Occasions">
            {OCCASIONS.map((o) => {
              const on = o.key === active
              return (
                <button
                  key={o.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setActive(o.key)}
                  className={`rounded-full px-[1.2em] py-[0.7em] text-[clamp(16px,1.4vw,32px)] sm:text-[clamp(18px,1.4vw,32px)] tracking-[0.1em] font-semibold transition-colors ${
                    on
                      ? 'bg-[#0A0A0A] text-white'
                      : 'bg-white/80 text-[#2B2B2B] hover:bg-white shadow-[0_10px_18px_-12px_rgba(120,120,120,0.6)]'
                  }`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>

          <div className="mt-5 sm:mt-7 grid grid-cols-3 gap-2.5 sm:gap-4">
            {[0, 1, 2].map((n) => {
              const look = occ.looks[n]
              return (
                <figure key={`${occ.key}-${n}`} className="rounded-[18px] overflow-hidden bg-white animate-[fadeIn_400ms_ease]">
                  <div className="relative aspect-[3/4] bg-[#E4E3E0]">
                    {look ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={look.src} alt={look.name.toLowerCase()} className="absolute inset-0 w-full h-full object-cover" />
                        {look.dots.map(([x, y], d) => (
                          <span
                            key={d}
                            aria-hidden
                            className="absolute -translate-x-1/2 -translate-y-1/2 w-[clamp(10px,1.3vw,28px)] h-[clamp(10px,1.3vw,28px)] rounded-full bg-[#0A0A0A] ring-[clamp(2px,0.35vw,7px)] ring-white/90 pointer-events-none"
                            style={{ left: `${x}%`, top: `${y}%` }}
                          />
                        ))}
                      </>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-[clamp(12px,0.9vw,20px)] tracking-[0.2em] text-[#A8A8A4]">
                        COMING SOON
                      </div>
                    )}
                  </div>
                  <figcaption className="px-[0.8em] py-[0.8em] text-[clamp(12px,1.35vw,30px)] sm:text-[clamp(16px,1.35vw,30px)] tracking-[0.04em] sm:tracking-[0.1em] font-semibold text-[#0A0A0A] leading-[1.25] min-h-[3.3em]">
                    {look?.name ?? ' '}
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
