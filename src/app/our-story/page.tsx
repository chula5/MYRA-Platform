import Link from 'next/link'
import Navigation from '@/components/navigation/Navigation'
import LandingFeedback from '@/components/LandingFeedback'
import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// OUR STORY — the brand narrative that used to live on the landing page:
// hero, manifesto, Our Take, editorial photos, partners, and the
// suggest-a-brand / feedback forms. The landing page is now purely The Edit.
export default async function OurStoryPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <>
      <Navigation transparent authed={!!user} />

      <div className="myra-texture">

      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="relative w-screen overflow-hidden bg-[#FAFAF8] h-screen sm:h-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/Mesh%20Cape.webp"
          alt=""
          className="sm:hidden absolute inset-0 w-full h-full object-cover object-top"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/Mesh%20Cape.webp"
          alt=""
          className="hidden sm:block w-full h-auto"
        />
        <div className="absolute inset-x-0 bottom-[28%] sm:bottom-[28%] flex justify-center px-2 sm:px-6 z-10 pointer-events-none">
          <h1 className="text-white text-center whitespace-nowrap leading-[1.05] tracking-[0.018em] sm:tracking-[0.036em] text-[clamp(14px,4.2vw,56px)] drop-shadow-[0_2px_12px_rgba(0,0,0,0.25)]">
            A DIFFERENT WAY TO GET DRESSED.
          </h1>
        </div>
      </section>

      {/* ── Manifesto ──── */}
      <section className="pt-20 sm:pt-28 pb-12 sm:pb-16 px-6 sm:px-10">
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-[#4A4E57] tracking-[0.045em] sm:tracking-[0.059em] leading-[1.5] text-[clamp(18px,2.6vw,34px)]">
            THE FIRST OUTFIT-LED SHOPPING PLATFORM. WE CURATE THE BRANDS AND
            BUILD THE OUTFITS, SO YOU DON&apos;T HAVE&nbsp;TO.
          </p>
        </div>
      </section>

      {/* ── Our Take ──────────────────────────────────────────── */}
      <section className="pb-24 sm:pb-32 px-6 sm:px-10">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-[11px] sm:text-[12px] lg:text-[13px] tracking-[0.135em] text-[#4A4E57] mb-10 sm:mb-12">
            OUR TAKE
          </p>
          <div className="text-[#4A4E57] tracking-[0.036em] sm:tracking-[0.045em] leading-[1.75] text-[clamp(16px,1.9vw,25px)] space-y-7 sm:space-y-8">
            <p>
              SHOPPING HAS BECOME EXHAUSTING. NUMEROUS TABS, ENDLESS
              SCROLLING AND ALGORITHMS THAT FEED YOU MORE OF THE SAME. WE
              ARE SOLD MORE CLOTHES THAN EVER AND SOMEHOW FEEL FURTHER AWAY
              FROM KNOWING WHAT TO WEAR.
            </p>
            <p>
              MYRA IS BEING BUILT FOR THE WAY PEOPLE ACTUALLY GET DRESSED:
              IN OUTFITS, FOR OCCASIONS, WITH INTENTION. A CURATED OUTFIT
              GENERATOR BUILT ON A CONSIDERED SET OF BRANDS, DESIGNED TO
              GIVE YOU CONFIDENCE IN WHAT YOU BUY AND HOW YOU WEAR IT.
            </p>
            <p>IT&apos;S THE ANTIDOTE TO THE NOISE.</p>
          </div>
        </div>
      </section>

      {/* ── Staggered outfit photos ──────────────────────────── */}
      <section className="pb-32 sm:pb-40 px-4 sm:px-10 lg:px-16">
        <div className="max-w-[1800px] mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8 lg:gap-10">
            <div className="sm:mt-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/VB.webp" alt="" loading="lazy" className="w-full h-auto block hover:opacity-90 transition-opacity duration-500" />
            </div>
            <div className="sm:mt-32">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/Blue%20Ruffle.webp" alt="" loading="lazy" className="w-full h-auto block hover:opacity-90 transition-opacity duration-500" />
            </div>
            <div className="sm:mt-16">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/DRIES%20Skirt.webp" alt="" loading="lazy" className="w-full h-auto block hover:opacity-90 transition-opacity duration-500" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Our Partners ──────────────────────────────────────── */}
      <section className="pb-24 sm:pb-32 px-6 sm:px-10">
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-[11px] sm:text-[12px] lg:text-[13px] tracking-[0.135em] text-[#4A4E57] mb-12 sm:mb-14">
            OUR PARTNERS
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-8 sm:gap-x-16 lg:gap-x-24 lg:gap-y-12">
            {[
              { name: 'Isabel Marant', src: '/partners/isabel-marant.svg', h: 'h-5 sm:h-8 lg:h-10' },
              { name: 'Diesel', src: '/partners/diesel.svg', h: 'h-9 sm:h-12 lg:h-14' },
              { name: 'Twinset', src: '/partners/twinset.png', h: 'h-6 sm:h-9 lg:h-11' },
              { name: 'DeMellier London', src: '/partners/demellier.svg', h: 'h-4 sm:h-6 lg:h-8' },
              { name: 'Da Luna', src: '/partners/da-luna.png', h: 'h-5 sm:h-7 lg:h-9' },
              { name: 'Vivere London', src: '/partners/vivere.png', h: 'h-6 sm:h-8 lg:h-10' },
              // Two-line lockup (CAMI over NYC) in a 1004×488 canvas, so the
              // wordmark is only ~half the box height — it needs roughly double
              // the height of the single-line marks to read at the same size.
              { name: 'Cami NYC', src: '/partners/cami-nyc.png', h: 'h-8 sm:h-12 lg:h-14' },
            ].map((b) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={b.name}
                src={b.src}
                alt={b.name}
                loading="lazy"
                className={`${b.h} w-auto object-contain opacity-90 hover:opacity-100 transition-opacity duration-300`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Brand suggestions + feedback + contact */}
      <LandingFeedback />
      </div>

      {/* ── Footer ──── */}
      <footer className="bg-white pt-16 pb-24 px-10">
        <div className="max-w-[1440px] mx-auto">
          <div className="text-center mb-10">
            <Link href="/" className="text-[20px] tracking-[0.113em] text-[#4A4E57] hover:opacity-60 transition-opacity duration-300">
              MYRA
            </Link>
          </div>
          <div className="border-t border-[#E2E0DB] mb-8" />
          <div className="flex justify-end items-center flex-wrap gap-8">
            <a href="/privacy" className="text-[11px] tracking-[0.099em] text-[#4A4E57] hover:text-[#4A4E57] transition-colors duration-300">
              PRIVACY
            </a>
            <a href="#" className="text-[11px] tracking-[0.099em] text-[#4A4E57] hover:text-[#4A4E57] transition-colors duration-300">
              TERMS
            </a>
          </div>
        </div>
      </footer>
    </>
  )
}
