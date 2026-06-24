import { redirect } from 'next/navigation'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import FeedClient from '@/app/feed/FeedClient'
import { earlyAccessSignOut } from '@/app/earlyaccess/actions'
import { recordEarlyAccessVisit } from '@/app/earlyaccess/activity'
import { getSavedOutfitIds } from './save-actions'
import { getRecommendedOutfits } from '@/lib/recommendations'
import type { OutfitWithItems } from '@/types/database'

export const dynamic = 'force-dynamic'

export default async function EditPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Early-access (or admin) sign-in required.
  if (!user) redirect('/earlyaccess')

  // First-time users complete the taste onboarding before browsing.
  // The admin account is exempt (it previews the live edit directly).
  const isAdmin = user.id === process.env.ADMIN_USER_ID
  if (!isAdmin && !user.user_metadata?.onboarded) redirect('/onboarding')

  // Track that this early-access person opened the site (throttled to ~sessions).
  await recordEarlyAccessVisit(user.id)

  // Fetch LIVE outfits WITH their items via the admin (service-role) client so
  // source items / hotspots show even when the items would be hidden by RLS.
  const admin = createAdminClient()
  const { data: liveRaw } = await admin
    .from('outfit')
    .select('*, outfit_item(*, item(*, brand(*)))')
    .eq('status', 'live')
    .order('published_at', { ascending: false })
  const liveOutfits = (liveRaw ?? []) as unknown as OutfitWithItems[]

  // Saved outfits + personalised recommendations (table may not exist yet → [] ).
  const [savedIds, recommended] = await Promise.all([
    getSavedOutfitIds(),
    getRecommendedOutfits(user.id),
  ])

  return (
    <div className="min-h-screen bg-[#F2F2F2]">
      {/* Minimal header */}
      <header className="flex items-center justify-between px-8 h-14 border-b border-[#E2E0DB] bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/myra-logo-black.png" alt="MYRA" className="h-[18px] w-auto" />
        <div className="flex items-center gap-5">
          <span className="text-[10px] tracking-[0.20em] text-[#A8A8A4]">THE EDIT · EARLY ACCESS</span>
          <form action={earlyAccessSignOut}>
            <button
              type="submit"
              className="text-[10px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#4A4E57] border border-[#E2E0DB] hover:border-[#0A0A0A] px-4 py-2 transition-colors duration-300"
            >
              SIGN OUT
            </button>
          </form>
        </div>
      </header>

      {/* The Edit — occasion search + browse (read-only). Items come with the
          server-fetched outfits, so Source Items / hotspots work. */}
      <FeedClient
        showAllOption
        injectedOutfits={liveOutfits}
        detailHrefBase="/edit"
        canSave
        savedOutfitIds={savedIds}
        recommendedOutfits={recommended}
      />
    </div>
  )
}
