import Link from 'next/link'
import Navigation from '@/components/navigation/Navigation'
import LandingPageClient from './LandingPageClient'

export default function LandingPage() {
  return (
    <>
      <Navigation transparent />

      {/* ── Hero ──────────────────────────────────────────────
          Mobile: image fills the viewport (h-screen + object-cover).
          Desktop: image fills the full width at its natural aspect ratio
                   — the section grows taller than the viewport, so the
                   user scrolls down to reveal the rest of the outfit. */}
      <section className="relative w-screen overflow-hidden bg-[#FAFAF8] h-screen sm:h-auto">
        {/* Mobile image — absolutely positioned to fill the viewport */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/Mesh%20Cape.png"
          alt=""
          className="sm:hidden absolute inset-0 w-full h-full object-cover object-top"
        />
        {/* Desktop image — fills width, height adapts naturally */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/Mesh%20Cape.png"
          alt=""
          className="hidden sm:block w-full h-auto"
        />
        {/* Headline overlaid on the trouser area */}
        <div className="absolute inset-x-0 bottom-[28%] sm:bottom-[28%] flex justify-center px-2 sm:px-6 z-10 pointer-events-none">
          <h1 className="text-white text-center whitespace-nowrap leading-[1.05] tracking-[0.04em] sm:tracking-[0.08em] text-[clamp(14px,4.2vw,56px)] drop-shadow-[0_2px_12px_rgba(0,0,0,0.25)]">
            A DIFFERENT WAY TO GET DRESSED.
          </h1>
        </div>
      </section>

      {/* ── Manifesto — sits directly under the hero photo ──── */}
      <section className="bg-[#FAFAF8] pt-20 sm:pt-28 pb-12 sm:pb-16 px-6 sm:px-10">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-[#4A4E57] tracking-[0.10em] sm:tracking-[0.13em] leading-[1.65] text-[clamp(13px,1.7vw,18px)]">
            THE FIRST OUTFIT-LED SHOPPING PLATFORM. WE CURATE THE BRANDS AND
            BUILD THE OUTFITS, SO YOU DON&apos;T HAVE&nbsp;TO.
          </p>
        </div>
      </section>

      {/* ── Our Take ──────────────────────────────────────────── */}
      <section className="bg-[#FAFAF8] pb-24 sm:pb-32 px-6 sm:px-10">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-[10px] sm:text-[11px] tracking-[0.30em] text-[#6B6B6B] mb-10 sm:mb-12">
            OUR TAKE
          </p>
          <div className="text-[#4A4E57] tracking-[0.08em] sm:tracking-[0.10em] leading-[1.85] text-[clamp(12px,1.4vw,15px)] space-y-7 sm:space-y-8">
            <p>
              SHOPPING HAS BECOME EXHAUSTING. NUMEROUS TABS, ENDLESS
              SCROLLING AND ALGORITHMS THAT FEED YOU MORE OF THE SAME. WE
              ARE SOLD MORE CLOTHES THAN EVER AND SOMEHOW FEEL FURTHER AWAY
              FROM KNOWING WHAT TO WEAR.
            </p>
            <p>
              MYRA IS BEING BUILT FOR THE WAY PEOPLE ACTUALLY GET DRESSED —
              IN OUTFITS, FOR OCCASIONS, WITH INTENTION. A CURATED OUTFIT
              GENERATOR BUILT ON A CONSIDERED SET OF BRANDS, DESIGNED TO
              GIVE YOU CONFIDENCE IN WHAT YOU BUY AND HOW YOU WEAR IT.
            </p>
            <p>IT&apos;S THE ANTIDOTE TO THE NOISE.</p>
          </div>
        </div>
      </section>

      {/* ── Staggered outfit photos ──────────────────────────── */}
      <section className="bg-[#FAFAF8] pb-32 sm:pb-40 px-4 sm:px-10">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-6">
            {/* Left — top aligned */}
            <div className="sm:mt-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/VB.png"
                alt=""
                className="w-full h-auto block hover:opacity-90 transition-opacity duration-500"
              />
            </div>
            {/* Middle — offset down */}
            <div className="sm:mt-32">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/Blue%20Ruffle.png"
                alt=""
                className="w-full h-auto block hover:opacity-90 transition-opacity duration-500"
              />
            </div>
            {/* Right — partial offset */}
            <div className="sm:mt-16">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/DRIES%20Skirt.png"
                alt=""
                className="w-full h-auto block hover:opacity-90 transition-opacity duration-500"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Sticky waitlist CTA + auto invite popup (self-positioning) ── */}
      <LandingPageClient />

      {/* ── Footer — extra bottom padding so sticky CTA never covers copyright */}
      <footer className="bg-white pt-16 pb-28 sm:pb-24 px-10">
        <div className="max-w-[1440px] mx-auto">
          {/* Wordmark */}
          <div className="text-center mb-10">
            <Link
              href="/"
              className="text-[20px] tracking-[0.25em] text-[#4A4E57] hover:opacity-60 transition-opacity duration-300"
            >
              MYRA
            </Link>
          </div>

          {/* Divider */}
          <div className="border-t border-[#E2E0DB] mb-8" />

          {/* Footer links */}
          <div className="flex justify-end items-center flex-wrap gap-8">
            <a href="#" className="text-[11px] tracking-[0.22em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300">
              PRIVACY
            </a>
            <a href="#" className="text-[11px] tracking-[0.22em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300">
              TERMS
            </a>
          </div>
        </div>
      </footer>
    </>
  )
}
