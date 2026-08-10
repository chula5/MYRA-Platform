'use client'

// OUR PICKS — the editorial moment under the New Outfits row.
// Big display headline with the background-removed Cult Gaia Amun bag hooked
// onto the S of PICKS (THE LOFT-style). The bag IS the door: clicking it opens
// the curated bags edit at /picks/bags. No grid here — the collection lives on
// the destination page.

import type { OurPicksData } from '@/lib/our-picks'

export default function OurPicks({ data }: { data: OurPicksData }) {
  if (!data.artImageUrl) return null

  return (
    <section className="mt-20 mb-10">
      {/* All art offsets are in em of the headline font-size, so the bag stays
          threaded through the S at every viewport width. The bag sits BEHIND
          the letters so the S reads on top of the ring — its tail landing
          inside the ring hole, like the mock. */}
      <div className="relative select-none" style={{ fontSize: 'clamp(84px, 14vw, 210px)' }}>
        <a
          href="/picks/bags"
          aria-label="The bags — our curated edit"
          className="absolute group/bag block"
          // Upright bag, ring hole wrapped around the bottom curve of the S
          // (last letter of PICKS, second line).
          style={{
            left: '1.74em',
            top: '1.2em',
            width: '2.6em',
            filter: 'drop-shadow(0 0.06em 0.1em rgba(0,0,0,0.12))',
            zIndex: 1,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.artImageUrl}
            alt="The bags"
            className="w-full h-auto transition-transform duration-500 group-hover/bag:rotate-[2deg] group-hover/bag:scale-[1.02]"
          />
          <span
            className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[#6B6B6B] opacity-0 group-hover/bag:opacity-100 transition-opacity"
            style={{ bottom: '-0.14em', fontSize: '10px', letterSpacing: '0.2em' }}
          >
            THE BAGS →
          </span>
        </a>
        <h2
          className="relative font-bold leading-[0.9] tracking-[-0.02em] text-[#4A4E57] uppercase pointer-events-none"
          style={{ fontSize: '1em', zIndex: 2 }}
        >
          Our
          <br />
          Picks
        </h2>
        {/* Reserve room for the bag hanging below the baseline */}
        <div style={{ height: '1.55em' }} />
      </div>
      <p className="text-[10px] tracking-[0.2em] text-[#A8A8A4]">
        THE PIECES WE KEEP REACHING FOR — TAP THE BAG
      </p>
    </section>
  )
}
