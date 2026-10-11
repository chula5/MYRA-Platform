import { redirect } from 'next/navigation'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'
import WaysPageClient from './WaysPageClient'

export const dynamic = 'force-dynamic'
// A tap on a piece may wait on MYRA's eye; the route needs the minute, not the seconds a page normally gets.
export const maxDuration = 60

// /me/ways/<itemId> — the ways to wear one piece, opened from a link. What
// MYRA already keeps shows at once; otherwise she watches the three slots fill.
export default async function WaysPage({ params }: { params: Promise<{ itemId: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')
  const me = await resolveClientMember()
  if (!me) redirect('/me/profile')

  const { itemId } = await params
  const admin = createAdminClient() as any
  const { data } = await admin.from('item').select('item_id, product_name, image_url, brand:brand_id(name)')
    .eq('item_id', itemId).neq('status', 'archived').maybeSingle()
  const piece = data ? { item_id: data.item_id, product_name: data.product_name, brand: data.brand?.name ?? null, image_url: data.image_url ?? null } : null
  return <WaysPageClient itemId={itemId} piece={piece} />
}
