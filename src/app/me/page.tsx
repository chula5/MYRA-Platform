import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { loadForYou } from './for-you-actions'
import ForYouClient from './ForYouClient'

export const dynamic = 'force-dynamic'

// FOR YOU — the member home for the private-stylist experience.
export default async function ForYouPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const view = await loadForYou()
  if (!view.memberId) redirect('/me/profile')
  return <ForYouClient view={view} />
}
