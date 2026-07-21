import { redirect } from 'next/navigation'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import FeedClient from '@/app/feed/FeedClient'
import { earlyAccessSignOut } from '@/app/earlyaccess/actions'
import { recordEarlyAccessVisit } from '@/app/earlyaccess/activity'
import { getSavedOutfitIds } from './save-actions'
import Wardrobe from './Wardrobe'
import OpenWardrobeButton from './OpenWardrobeButton'
import HelpPopover from '@/components/HelpPopover'
import { getTasteRecommendations, getUserTasteVector, getBrandAffinityRows, getOccasionOrder } from '@/lib/taste-profile'
import type { OutfitWithItems } from '@/types/database'

export const dynamic = 'force-dynamic'

export default async function EditPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Early-access (or admin) sign-in required.
  if (!user) redirect('/signin')

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

  // Saved outfits, cosine taste recommendations, and the user's taste vector
  // (so the occasion feed can re-rank by taste). Tables may not exist yet → [] .
  const [savedIds, recommended, tasteVector] = await Promise.all([
    getSavedOutfitIds(),
    getTasteRecommendations(user.id),
    getUserTasteVector(user.id),
  ])

  // Brand-affinity discovery rows + a per-user occasion order.
  const brandRows = await getBrandAffinityRows(user.id, liveOutfits, tasteVector)
  const occasionOrder = getOccasionOrder(tasteVector, liveOutfits)

  return (
    <div className="min-h-screen bg-[#F2F2F2]">
      {/* Minimal header */}
      <header className="flex items-center justify-between px-8 h-14 border-b border-[#E2E0DB] bg-white">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/myra-logo-black.png" alt="MYRA" className="h-[18px] w-auto" />
          <span
            className="text-[8px] sm:text-[9px] tracking-[0.22em] text-[#4A4E57] px-2.5 py-1 rounded-full"
            style={{
              background: 'linear-gradient(135deg, #f7f8f9 0%, #e6e8ec 45%, #fcfcfd 62%, #e1e4e9 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.12)',
            }}
          >
            BETA
          </span>
        </div>
        <div className="flex items-center gap-5">
          <OpenWardrobeButton />
          <form action={earlyAccessSignOut}>
            <button
              type="submit"
              className="text-[9px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300"
            >
              SIGN OUT
            </button>
          </form>
        </div>
      </header>

      {/* The Edit — occasion search + browse (read-only). Items come with the
          server-fetched outfits, so Source Items / hotspots work. */}
      <FeedClient
        injectedOutfits={liveOutfits}
        detailHrefBase="/edit"
        canSave
        savedOutfitIds={savedIds}
        recommendedOutfits={recommended}
        tasteVector={tasteVector}
        brandRows={brandRows}
        occasionOrder={occasionOrder}
        defaultSizeUk={(user.user_metadata?.clothing_uk as number | undefined) ?? null}
      />

      {/* Slide-out wardrobe of saved outfits + items */}
      <Wardrobe />

      <HelpPopover
        id="wardrobe-intro"
        title="YOUR WARDROBE"
        points={[
          { label: 'SAVE', text: 'tap the ♥ on any outfit or item to keep it.' },
          { label: 'WARDROBE', text: 'everything you save lands in your Wardrobe — open it anytime to shop or restyle.' },
          { label: 'YOUR TASTE', text: 'what you save teaches MYRA to recommend looks made for you.' },
        ]}
      />
    </div>
  )
}
