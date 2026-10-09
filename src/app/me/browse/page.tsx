import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'
import BrowseClient from './BrowseClient'

export const dynamic = 'force-dynamic'
// A tap on a piece may wait on MYRA's eye; the route needs the minute, not the seconds a page normally gets.
export const maxDuration = 60

// BROWSE — looking something up, with MYRA doing the finding.
export default async function BrowsePage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')
  if (!(await resolveClientMember())) redirect('/me/profile')
  return <BrowseClient />
}
