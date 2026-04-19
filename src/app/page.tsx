import Link from 'next/link'
import Navigation from '@/components/navigation/Navigation'
import Lookbook from '@/components/lookbook/Lookbook'
import WaitlistModal from '@/components/WaitlistModal'
import HeroCarousel from '@/components/hero/HeroCarousel'
import { createServerClient } from '@/lib/supabase-server'
import type { Outfit } from '@/types/database'

export default async function LandingPage() {
  const supabase = await createServerClient()

  // Fetch lookbooks with their outfits (ordered by lookbook sort_order, outfits by sort_order)
  const { data: lookbookData } = await supabase
    .from('lookbook')
    .select(`
      lookbook_id,
      title,
      slug,
      lookbook_outfit(
        sort_order,
        outfit(*)
      )
    `)
    .eq('status', 'active')
    .order('sort_order', { ascending: true })

  const lookbooks = ((lookbookData ?? []) as {
    lookbook_id: string
    title: string
    slug: string
    lookbook_outfit: { sort_order: number; outfit: Outfit | null }[]
  }[]).map((lb) => ({
    lookbook_id: lb.lookbook_id,
    title: lb.title,
    slug: lb.slug,
    outfits: (lb.lookbook_outfit ?? [])
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((lo) => lo.outfit)
      .filter((o): o is Outfit => o !== null && o.status === 'live'),
  })).filter((lb) => lb.outfits.length > 0)

  return (
    <>
      <Navigation transparent />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative w-full h-screen min-h-[600px] overflow-hidden">
        {/* Full-bleed rotating hero (Chanel · Saint Laurent · Dior) */}
        <HeroCarousel />

        {/* Text overlay — bottom */}
        <div className="absolute bottom-0 left-0 right-0 pb-12 sm:pb-16 flex flex-col items-center text-center px-6 sm:px-10">
          <h1 className="text-[clamp(22px,5vw,56px)] leading-[1.15] tracking-[0.08em] sm:tracking-[0.10em] text-white mb-8 sm:mb-10 max-w-[90%] sm:whitespace-nowrap">
            YOUR OUTFIT,<br className="sm:hidden" />
            <span className="hidden sm:inline"> </span>ONE MESSAGE AWAY
          </h1>
          <WaitlistModal />
        </div>
      </section>

      {/* ── Lookbooks ────────────────────────────────────────── */}
      <Lookbook lookbooks={lookbooks} />

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="bg-white pt-16 pb-8 px-10">
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
