import { createAdminClient } from '@/lib/supabase-server'
import AgeTaggingGrid, { type TaggingOutfit } from './AgeTaggingGrid'

export const dynamic = 'force-dynamic'

export default async function AgeTaggingPage() {
  const admin = createAdminClient()
  const { data } = await admin
    .from('outfit')
    .select('outfit_id, image_url, aesthetic_label, occasion_tags, age_ranges')
    .eq('status', 'live')
    .order('published_at', { ascending: false })

  const outfits: TaggingOutfit[] = ((data ?? []) as any[]).map((o) => ({
    id: o.outfit_id,
    image: o.image_url,
    label: o.aesthetic_label ?? '',
    occasions: o.occasion_tags ?? [],
    ageRanges: o.age_ranges ?? [],
  }))

  return (
    <div>
      <div className="mb-6">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">AGE-TAG OUTFITS</h1>
        <p className="text-[11px] tracking-[0.059em] text-[#6B6B6B] mt-2 max-w-[640px] leading-relaxed">
          Tag which age ranges each outfit suits. New users only see outfits matching the age they
          pick at sign-up. An outfit with <span className="text-[#4A4E57]">no tags shows to everyone</span> —
          so tag the age-specific ones (e.g. a strappy mini → 25-30, 30-40 only). Saves instantly.
          Never shown in The Edit.
        </p>
      </div>
      <AgeTaggingGrid outfits={outfits} />
    </div>
  )
}
