import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { loadReviewQueue } from '@/lib/studio/review-queue'
import { renderQueueStats } from '@/lib/studio/render-queue'
import ReviewClient from './ReviewClient'

export const dynamic = 'force-dynamic'

// Mobile-first swipe review queue. Same hard gate as /admin: a valid session
// alone is not enough — the user id must match ADMIN_USER_ID exactly.
export default async function StudioReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ outfit?: string; swap?: string; pick?: string }>
}) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) redirect('/')

  const { outfit, swap, pick } = await searchParams
  const [queue, renderStats] = await Promise.all([loadReviewQueue(), renderQueueStats()])

  return (
    <ReviewClient
      initialQueue={queue}
      renderingCount={renderStats.pending}
      deepLink={outfit ? { outfitId: outfit, deadItemId: swap ?? null, pickItemId: pick ?? null } : null}
    />
  )
}
