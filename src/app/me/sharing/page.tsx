import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { loadSharing } from './actions'
import SharingClient from './SharingClient'

export const dynamic = 'force-dynamic'

// SHARING IS CARING — her friends on MYRA, and what they pass each other.
export default async function SharingPage({ searchParams }: { searchParams?: { chat?: string } }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const view = await loadSharing()
  if (!view.memberId) redirect('/me/profile')
  return <SharingClient initial={view} openChatId={typeof searchParams?.chat === 'string' ? searchParams.chat : undefined} />
}
