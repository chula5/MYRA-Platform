import Link from 'next/link'
import Navigation from '@/components/navigation/Navigation'
import ScatterHero from '@/components/ScatterHero'
import { ArchiveCard } from '@/components/ArchiveCard'
import ManifestoReveal from '@/components/ManifestoReveal'
import StylingAssistant from '@/components/StylingAssistant'
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
      <Navigation authed={!!user} showAuth={false} />

      {/* ── Scatter hero — images stack then spread, headline in the middle ── */}
      <ScatterHero />

      {/* ── Mirror glides into place, the manifesto + APPLY sit beneath it ── */}
      <main className="myra-texture">
        <ArchiveCard>
          <></>
        </ArchiveCard>
        <ManifestoReveal />
      </main>

      {/* ── Your Styling Assistant — the three ideas, stacking on scroll ── */}
      <StylingAssistant />

      {/* The pop-out questionnaire every APPLY NOW opens. */}
      <ApplyModal />

      {/* Pageview analytics (no more waitlist popup) */}
      <LandingTracker initialRef={ref ?? null} />

      {/* ── Footer — full width, wordmark centred, links to the right ──── */}
      <footer className="myra-texture pt-16 pb-24 px-6 lg:px-16">
        <div className="w-full flex items-center justify-between gap-6">
          <Link href="/" className="tracking-[0.11em] text-[#4A4E57] hover:opacity-60 transition-opacity duration-300 text-[clamp(15px,1.4vw,22px)]">
            MYRA
          </Link>
          <div className="flex items-center gap-8 sm:gap-10">
            <a href="/privacy" className="tracking-[0.1em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 text-[clamp(15px,1.4vw,22px)]">
              PRIVACY
            </a>
            <a href="#" className="tracking-[0.1em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 text-[clamp(15px,1.4vw,22px)]">
              TERMS
            </a>
          </div>
        </div>
      </footer>
    </>
  )
}
