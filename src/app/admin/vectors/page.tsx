import { createAdminClient } from '@/lib/supabase-server'
import type { OutfitWithItems } from '@/types/database'
import VectorsClient from './VectorsClient'

export const dynamic = 'force-dynamic'

export default async function VectorsPage() {
  const admin = createAdminClient()
  const { data } = await admin
    .from('outfit')
    .select('*, outfit_item(*, item(*, brand(*)))')
    .eq('status', 'live')
    .order('published_at', { ascending: false })
  const outfits = (data ?? []) as unknown as OutfitWithItems[]

  const unscored = outfits.filter(
    (o: any) => o.formality === 3 && o.planning === 3 && o.wearer_priority === 3 && o.time_of_day === 3,
  ).length

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">OUTFIT VECTORS</h1>
        <p className="text-[11px] tracking-[0.06em] text-[#A8A8A4] mt-2 max-w-[760px] leading-relaxed">
          The taste fingerprint behind recommendations, made visible. Each outfit&rsquo;s 34-dimension vector is
          shown beneath it; click any outfit to see its closest matches by cosine similarity. Outfits whose
          occasion scores still default to 3 can be re-scored by scanning the image with vision AI.
        </p>
      </div>

      <VectorsClient outfits={outfits} unscoredCount={unscored} />
    </div>
  )
}
