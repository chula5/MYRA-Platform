import Link from 'next/link'
import Navigation from '@/components/navigation/Navigation'
import FeedClient from '@/app/feed/FeedClient'
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

  // Live outfits power the Edit at the top of the page (service-role so items
  // show despite RLS) — for everyone, signed in or not.
  const admin = createAdminClient()
  const { data: liveRaw } = await admin
    .from('outfit')
    .select('*, outfit_item(*, item(*, brand(*)))')
    .eq('status', 'live')
    .order('published_at', { ascending: false })
  const liveOutfits = (liveRaw ?? []) as unknown as OutfitWithItems[]

  // Personalisation only for signed-in users.
  let savedIds: string[] = []
  let recommended: OutfitWithItems[] = []
  let tasteVector: number[] | undefined
  let brandRows: BrandRow[] = []
  let occasionOrder: string[] | undefined
  if (user) {
    const [s, r, v] = await Promise.all([
      getSavedOutfitIds(),
      getTasteRecommendations(user.id),
      getUserTasteVector(user.id),
    ])
    savedIds = s
    recommended = r
    tasteVector = v
    brandRows = await getBrandAffinityRows(user.id, liveOutfits, v)
    occasionOrder = getOccasionOrder(v, liveOutfits)
  }

  return (
    <>
      {/* The nav is no longer transparent: it was only see-through so it could
          sit over the silver arrival screen, which has been removed. */}
      <Navigation authed={!!user} />

      {/* ── The Edit ────────────────────────────────────────────── */}
      <main className="myra-texture pt-6">
        <FeedClient
          injectedOutfits={liveOutfits}
          detailHrefBase={user ? '/edit' : '/outfit'}
          canSave={!!user}
          savedOutfitIds={savedIds}
          recommendedOutfits={recommended}
          tasteVector={tasteVector}
          brandRows={brandRows}
          occasionOrder={occasionOrder}
          signupHref={user ? undefined : '/signin'}
          defaultSizeUk={(user?.user_metadata?.clothing_uk as number | undefined) ?? null}
          ourPicks={await getOurPicks()}
        />
      </main>
      {!user && <SignupPrompt href="/signin" />}

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
