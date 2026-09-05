import Link from 'next/link'
import Navigation from '@/components/navigation/Navigation'
import ScatterHero from '@/components/ScatterHero'
import { ArchiveCard } from '@/components/ArchiveCard'
import ApplyButton from '@/components/ApplyButton'
import ApplyModal from '@/components/ApplyModal'
import SignupPrompt from '@/components/SignupPrompt'
import LandingFeedback from '@/components/LandingFeedback'
import LandingTracker from '@/components/analytics/LandingTracker'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { getSavedOutfitIds } from '@/app/edit/save-actions'
import {
  getTasteRecommendations,
  getUserTasteVector,
  getBrandAffinityRows,
  getOccasionOrder,
  type BrandRow,
} from '@/lib/taste-profile'
import { getOurPicks } from '@/lib/our-picks'
import type { OutfitWithItems } from '@/types/database'

export const dynamic = 'force-dynamic'

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>
}) {
  const { ref } = await searchParams
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  // The landing is now a sign-up page for the private-stylist model: the scatter
  // hero, the mirror, the manifesto and APPLY. The feed (search + occasions +
  // recommendations) is no longer shown here — it lives on /edit for accepted
  // members, each with their own refined edit.

  return (
    <>
      {/* The nav is no longer transparent: it was only see-through so it could
          sit over the silver arrival screen, which has been removed. */}
      <Navigation authed={!!user} />

      {/* ── Scatter hero — images stack then spread, headline in the middle ── */}
      <ScatterHero />

      {/* ── Mirror glides into place, the manifesto + APPLY sit beneath it ── */}
      <main className="myra-texture">
        <ArchiveCard
          heading={
            <div className="max-w-[1400px] mx-auto text-center px-6 lg:px-12">
              <p className="text-[#4A4E57] tracking-[0.04em] sm:tracking-[0.055em] leading-[1.55] text-[clamp(20px,2.4vw,36px)]">
                FED UP WITH THE NOISE? SO WERE WE. TOO MANY TABS, TOO MANY OPTIONS,
                AND A WARDROBE THAT STILL NEVER WORKS. WE WANT YOU SEEING LESS, BUT
                MORE OF WHAT YOU LIKE. SMALLER COLLECTIONS, REFINED TO YOUR TASTE.
              </p>
              <div className="mt-12 sm:mt-14">
                <ApplyButton className="inline-flex items-center gap-3.5 rounded-full bg-[#0A0A0A] text-white px-14 py-6 text-[16px] sm:text-[18px] tracking-[0.2em] hover:opacity-85 transition-opacity" />
              </div>
            </div>
          }
        >
          <></>
        </ArchiveCard>
      </main>

      {/* The pop-out questionnaire every APPLY NOW opens. */}
      <ApplyModal />

      {/* Pageview analytics (no more waitlist popup) */}
      <LandingTracker initialRef={ref ?? null} />

      {/* ── Footer ──── */}
      <footer className="myra-texture pt-16 pb-24 px-10">
        <div className="max-w-[1440px] mx-auto">
          <div className="text-center mb-10">
            <Link href="/" className="text-[20px] tracking-[0.113em] text-[#4A4E57] hover:opacity-60 transition-opacity duration-300">
              MYRA
            </Link>
          </div>
          <div className="border-t border-[#E2E0DB] mb-8" />
          <div className="flex justify-end items-center flex-wrap gap-8">
            <a href="/privacy" className="text-[11px] tracking-[0.099em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300">
              PRIVACY
            </a>
            <a href="#" className="text-[11px] tracking-[0.099em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300">
              TERMS
            </a>
          </div>
        </div>
      </footer>
    </>
  )
}
