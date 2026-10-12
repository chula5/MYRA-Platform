import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'
import EventsClient from './EventsClient'

export const dynamic = 'force-dynamic'

// EVENTS — what she is dressing for next, and what she is looking for.
export default async function EventsPage({ searchParams }: { searchParams?: Promise<{ member?: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')
  // ?member=<id>: Chloe opening a member's room as her (a trial note); admin only.
  const me = await resolveClientMember((await searchParams)?.member || undefined)
  if (!me) redirect('/me/profile')
  return <EventsClient testMemberId={me.test ? me.memberId : undefined} />
}
