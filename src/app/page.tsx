import Link from 'next/link'
import Navigation from '@/components/navigation/Navigation'
import WaitlistModal from '@/components/WaitlistModal'

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
      <section className="bg-[#FAFAF8] py-20 sm:py-28 px-6 sm:px-10">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-[#0A0A0A] tracking-[0.12em] sm:tracking-[0.15em] leading-[1.65] text-[clamp(13px,1.7vw,18px)]">
            THE FIRST OUTFIT-LED SHOPPING PLATFORM. WE CURATE THE BRANDS AND
            BUILD THE OUTFITS, SO YOU DON&apos;T HAVE TO.
          </p>
        </div>
      </section>

      {/* ── Sticky waitlist CTA — fixed to bottom of viewport ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none flex justify-center pb-5 sm:pb-7">
        <div className="pointer-events-auto">
          <WaitlistModal
            triggerClassName="inline-flex items-center gap-3 bg-[#0A0A0A] text-white text-[11px] sm:text-[12px] tracking-[0.22em] px-10 sm:px-14 py-3.5 sm:py-4 shadow-[0_8px_24px_rgba(0,0,0,0.18)] hover:opacity-90 transition-opacity duration-300"
          />
        </div>
      </div>

      {/* ── Footer — extra bottom padding so sticky CTA never covers copyright */}
      <footer className="bg-white pt-16 pb-28 sm:pb-24 px-10">
        <div className="max-w-[1440px] mx-auto">
          {/* Wordmark */}
          <div className="text-center mb-10">
            <Link
              href="/"
              className="text-[20px] tracking-[0.25em] text-[#0A0A0A] hover:opacity-60 transition-opacity duration-300"
            >
              MYRA
            </Link>
          </div>

          {/* Divider */}
          <div className="border-t border-[#E2E0DB] mb-8" />

          {/* Footer links */}
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div className="flex gap-8">
              <Link href="/" className="text-[11px] tracking-[0.22em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300">
                LOOKBOOK
              </Link>
            </div>
            <div className="flex gap-8">
              <a href="#" className="text-[11px] tracking-[0.22em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300">
                PRIVACY
              </a>
              <a href="#" className="text-[11px] tracking-[0.22em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300">
                TERMS
              </a>
            </div>
          </div>

          {/* Copyright */}
          <p className="text-center text-[10px] tracking-[0.15em] text-[#A8A8A4] mt-8">
            © 2024 MYRA
          </p>
        </div>
      </footer>
    </>
  )
}
