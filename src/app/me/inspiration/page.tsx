import { redirect } from 'next/navigation'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import UploadClient from './UploadClient'
import InspirationBoard from './InspirationBoard'
import { loadMyInspiration } from './board-actions'

export const dynamic = 'force-dynamic'

// INSPIRATION — a private-stylist client sees every picture of hers (the ones
// Chloe added and her own) and adds more. A client from the older persona flow
// keeps the original upload page.
export default async function InspirationPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const board = await loadMyInspiration()
  if (board.memberId) return <InspirationBoard view={board} />

  const admin = createAdminClient() as any
  const { data } = await admin
    .from('inspiration_image')
    .select('image_id, image_url')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(60)

  return <UploadClient existing={(data ?? []) as { image_id: string; image_url: string }[]} />
}
