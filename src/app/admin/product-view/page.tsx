import { createAdminClient } from '@/lib/supabase-server'
import ProductViewManager, { type Clip } from './ProductViewManager'
import ProductPreviews, { type Preview } from './ProductPreviews'

export const dynamic = 'force-dynamic'

export default async function ProductViewPage() {
  const admin = createAdminClient()

  // The detail preview points at a real WEEKEND AWAY outfit (falls back to any
  // live outfit if none are tagged).
  const { data: weekendOutfit } = await admin
    .from('outfit')
    .select('outfit_id')
    .eq('status', 'live')
    .contains('occasion_tags', ['weekend away'])
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  let detailId = (weekendOutfit as any)?.outfit_id as string | undefined
  if (!detailId) {
    const { data: anyOutfit } = await admin
      .from('outfit')
      .select('outfit_id')
      .eq('status', 'live')
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    detailId = (anyOutfit as any)?.outfit_id as string | undefined
  }

  const previews: Preview[] = [
    { key: 'landing', label: 'LANDING PAGE', title: 'A different way to get dressed', path: '/' },
    { key: 'edit', label: 'THE EDIT', title: 'Pick an occasion → see the outfits', path: '/edit' },
    ...(detailId
      ? [{ key: 'detail', label: 'OUTFIT DETAIL', title: 'Shop the look · swipe between looks', path: `/edit/${detailId}` } as Preview]
      : []),
  ]

  // Demo-video clips (optional). The table may not exist yet.
  const { data: clipsData, error: clipsErr } = await admin
    .from('product_view_clip' as any)
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">PRODUCT VIEW</h1>
        <p className="text-[11px] tracking-[0.059em] text-[#A8A8A4] mt-1 max-w-[620px] leading-relaxed">
          Live, interactive previews of MYRA&rsquo;s key areas — click and scroll inside them just like a
          visitor. These are the flows to capture for a product reel.
        </p>
      </div>

      {/* Interactive live previews */}
      <ProductPreviews previews={previews} />

      {/* Demo videos (optional) */}
      <div className="border-t border-[#E2E0DB] mt-12 pt-10">
        {clipsErr ? (
          <div>
            <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-3">DEMO VIDEOS</p>
            <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[12px] p-5 max-w-[640px]">
              <p className="text-[11px] tracking-[0.081em] text-[#8A7A4E] mb-3">VIDEO LIBRARY NOT SET UP YET</p>
              <p className="text-[10px] tracking-[0.054em] text-[#8A7A4E] leading-relaxed mb-3">
                Run migration <span className="font-mono">0009_product_view.sql</span> in Supabase to add saved demo
                videos here (optional — the live previews above work without it):
              </p>
              <pre className="text-[9px] bg-white border border-[#E8D9B8] p-3 rounded overflow-x-auto text-[#6B6B6B] leading-relaxed">{`CREATE TABLE IF NOT EXISTS public.product_view_clip (
  clip_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  caption    text,
  video_url  text NOT NULL,
  poster_url text,
  sort_order int  NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_view_clip ENABLE ROW LEVEL SECURITY;`}</pre>
            </div>
          </div>
        ) : (
          <ProductViewManager clips={(clipsData ?? []) as unknown as Clip[]} />
        )}
      </div>
    </div>
  )
}
