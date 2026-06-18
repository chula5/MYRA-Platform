import { redirect } from 'next/navigation'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import OnboardingFlow, { type OnboardingOutfit } from './OnboardingFlow'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/earlyaccess')
  // Already done — straight to browsing.
  if (user.user_metadata?.onboarded) redirect('/edit')

  // Fetch all live outfits (lightweight — just what the rating cards need).
  // age_ranges drives which outfits we show per the user's selected age.
  const admin = createAdminClient()
  let { data, error } = await admin
    .from('outfit')
    .select('outfit_id, image_url, aesthetic_label, occasion_tags, age_ranges')
    .eq('status', 'live')
    .order('published_at', { ascending: false })

  // Fall back gracefully if the age_ranges column hasn't been added yet.
  if (error) {
    const retry = await admin
      .from('outfit')
      .select('outfit_id, image_url, aesthetic_label, occasion_tags')
      .eq('status', 'live')
      .order('published_at', { ascending: false })
    data = retry.data
  }

  const outfits: OnboardingOutfit[] = ((data ?? []) as any[]).map((o) => ({
    id: o.outfit_id,
    image: o.image_url,
    label: o.aesthetic_label ?? '',
    occasions: o.occasion_tags ?? [],
    ageRanges: o.age_ranges ?? [],
  }))

  return <OnboardingFlow outfits={outfits} />
}
