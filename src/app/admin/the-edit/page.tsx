import FeedClient from '@/app/feed/FeedClient'
import GoLiveButton from './GoLiveButton'
import { createAdminClient } from '@/lib/supabase-server'
import type { OutfitWithItems } from '@/types/database'

// Always reflect the latest live outfits.
export const dynamic = 'force-dynamic'

export default async function TheEditPreviewPage() {
  const supabase = createAdminClient()

  // Fetch LIVE outfits WITH their items via the admin (service-role) client so
  // items appear even when row-level security would hide them from the browser.
  const { data: liveRaw } = await supabase
    .from('outfit')
    .select('*, outfit_item(*, item(*, brand(*)))')
    .eq('status', 'live')
    .order('published_at', { ascending: false })
  const liveOutfits = (liveRaw ?? []) as unknown as OutfitWithItems[]
  const liveCount = liveOutfits.length

  const { count: draftCount } = await supabase
    .from('outfit')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'draft')
  const draftOutfits = draftCount ?? 0

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">MYRA ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.10em] text-[#0A0A0A]">THE EDIT — PRIVATE PREVIEW</h1>
        <p className="mt-3 max-w-[680px] text-[11px] tracking-[0.12em] text-[#6B6B6B] leading-relaxed">
          This is exactly what users will see in The Edit, built from your{' '}
          <span className="text-[#0A0A0A]">LIVE</span> outfits — pick an occasion or view everything,
          then click through just like a visitor would. It is private to the admin area: the public
          page still shows &ldquo;Launching soon&rdquo; until you go live.
        </p>
        <a
          href="/onboarding?preview=1"
          className="inline-flex items-center gap-2 mt-4 border border-[#0A0A0A] text-[#0A0A0A] px-5 py-2.5 rounded-[3px] text-[10px] tracking-[0.20em] hover:bg-[#0A0A0A] hover:text-white transition-colors duration-300"
        >
          ▶ PREVIEW NEW-USER SIGN-UP FLOW
        </a>
      </div>

      {/* Status + Go Live */}
      <div className="flex items-center justify-between gap-6 border border-[#E2E0DB] bg-white p-5 rounded-[3px] mb-8">
        <div>
          <p className="text-[10px] tracking-[0.20em] text-[#6B6B6B] mb-1">THE EDIT IS CURRENTLY</p>
          <p className="text-[15px] tracking-[0.10em] text-[#0A0A0A]">
            <span className="inline-block w-2 h-2 rounded-full bg-[#C4A882] mr-2 align-middle" />
            PRIVATE · {liveCount} LIVE OUTFIT{liveCount === 1 ? '' : 'S'}
          </p>
          <p className="text-[9px] tracking-[0.15em] text-[#A8A8A4] mt-1">
            Not visible on your public site yet.
          </p>
        </div>
        <GoLiveButton liveCount={liveCount} />
      </div>

      {/* How the preview works — live-only, and why that's safe */}
      <div className="mb-8 p-4 border border-[#E2E0DB] bg-[#FAFAF8] rounded-[3px]">
        <p className="text-[10px] tracking-[0.18em] text-[#6B6B6B] leading-relaxed">
          Only <span className="text-[#0A0A0A]">LIVE</span> outfits appear here, because this preview
          uses the exact public components (and click-through to the real detail page).
          {draftOutfits > 0 && (
            <> You have <span className="text-[#0A0A0A]">{draftOutfits} draft outfit{draftOutfits === 1 ? '' : 's'}</span> that
            won&rsquo;t show until set to LIVE.</>
          )}
          {' '}Setting an outfit to <span className="text-[#0A0A0A]">LIVE does NOT make it public</span> —
          The Edit stays gated until you press Go Live — so it&rsquo;s safe to mark outfits live just to
          preview them.{' '}
          <a href="/admin/projects" className="underline hover:text-[#0A0A0A]">Manage outfits →</a>
        </p>
      </div>

      {liveCount === 0 && (
        <div className="mb-8 p-4 border border-[#E8D9B8] bg-[#FBF6EA] rounded-[3px]">
          <p className="text-[10px] tracking-[0.18em] text-[#8A7A4E] leading-relaxed">
            Nothing is LIVE yet, so the preview below is empty. Open an outfit and set its status to
            LIVE (or publish a project) — then it will appear here to preview and click through.
          </p>
        </div>
      )}

      {/* Preview frame — the real feed experience */}
      <div className="border border-[#E2E0DB] bg-white rounded-[3px] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#E2E0DB] bg-[#FAFAF8]">
          <span className="text-[9px] tracking-[0.20em] text-[#6B6B6B]">PREVIEW · THE EDIT (/feed)</span>
          <span className="text-[9px] tracking-[0.18em] text-[#A8A8A4]">
            CLICKING AN OUTFIT OPENS ITS DETAIL PAGE
          </span>
        </div>
        <FeedClient showAllOption injectedOutfits={liveOutfits} detailHrefBase="/admin/the-edit" />
      </div>
    </div>
  )
}
