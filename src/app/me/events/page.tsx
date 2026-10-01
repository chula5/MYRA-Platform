import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'
import EventsClient from './EventsClient'

export const dynamic = 'force-dynamic'

// EVENTS — what she is dressing for next, and what she is looking for.
export default async function EventsPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')
  if (!(await resolveClientMember())) redirect('/me/profile')
  return <EventsClient />
}
