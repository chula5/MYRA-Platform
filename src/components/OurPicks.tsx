'use client'

// OUR PICKS — the editorial moment under the New Outfits row.
// Big display headline with the background-removed Cult Gaia Amun bag hooked
// onto the S of PICKS (THE LOFT-style). The bag IS the door: clicking it opens
// the curated bags edit at /picks/bags. No grid here — the collection lives on
// the destination page.

import type { OurPicksData } from '@/lib/our-picks'

export default function OurPicks({ data }: { data: OurPicksData }) {
  if (!data.artImageUrl) return null

  // The bag keeps its own hand-placed cutout hooked through the S; every other
  // curated collection renders as a tile beside it. A collection only reaches
  // here once it has a live curated item (see getLandingCollections), so this
  // never puts a dead link on the homepage.
  const extras = (data.collections ?? []).filter((c) => c.slug !== 'bags')

  return (
    <section className="mt-20 mb-28 sm:mb-36">
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
            className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[#111111] opacity-0 group-hover/bag:opacity-100 transition-opacity"
            style={{ bottom: '-0.14em', fontSize: '10px', letterSpacing: '0.2em' }}
          >
            THE BAGS →
          </span>
        </a>
        <h2
          className="relative font-bold leading-[0.9] tracking-[-0.02em] text-[#111111] uppercase pointer-events-none"
          style={{ fontSize: '1em', zIndex: 2 }}
        >
          Our
          <br />
          Picks
        </h2>
        {/* Reserve room for the bag hanging below the baseline, so the brand
            row underneath can never collide with it. The bag sits at
            top 1.2em and is ~2.6em tall, so it ends at ~3.8em; the headline
            occupies ~1.8em, hence this spacer. */}
        <div style={{ height: '2.08em' }} />
        {/* The positioning box is sized in HEADLINE em (it inherits the
            container font-size); the link sets its own smaller size inside.
            Putting both on one element would make em resolve against the
            label's font-size and shove it to the far left.

            Any further curated collections sit to the RIGHT of the bag on the
            same baseline. The row wraps rather than scrolls, so on a phone —
            where the bag alone nearly fills the width — they drop to their own
            line instead of pushing the page sideways. */}
        <div className="flex flex-wrap items-start gap-y-[0.35em] gap-x-[0.5em]" style={{ marginLeft: '1.74em' }}>
          <div style={{ width: '2.6em' }}>
            <a
              href="/picks/bags"
              className="block text-center text-[clamp(15px,1.5vw,26px)] tracking-[0.22em] text-[#111111] hover:text-[#111111] transition-colors whitespace-nowrap"
            >
              SUMMER BAGS
            </a>
          </div>

          {extras.map((c) => (
            <a key={c.slug} href={c.href} className="group/col block shrink-0" style={{ width: '1.55em' }}>
              {/* Lifted into the bag's band so both sit on one baseline. The
                  bag ends at ~3.8em and this row starts at ~3.88em, so a
                  1.9em box pulled up by 1.9em lands level with it. */}
              <div className="flex items-end justify-center overflow-hidden" style={{ marginTop: '-1.9em', height: '1.9em' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.artImageUrl}
                  alt={c.label}
                  className="max-h-full w-auto object-contain transition-transform duration-500 group-hover/col:scale-[1.02]"
                  style={{ filter: 'drop-shadow(0 0.02em 0.05em rgba(0,0,0,0.10))' }}
                />
              </div>
              <span className="block text-center text-[clamp(15px,1.5vw,26px)] tracking-[0.22em] text-[#111111] whitespace-nowrap">
                {c.label}
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
