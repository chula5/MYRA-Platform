import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { loadMyDressingRoom } from './actions'
import DressingRoomClient from './DressingRoomClient'

export const dynamic = 'force-dynamic'
// A tap on a piece may wait on MYRA's eye; the route needs the minute, not the seconds a page normally gets.
export const maxDuration = 60

// DRESSING ROOM — her own pieces.
export default async function DressingRoomPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const view = await loadMyDressingRoom()
  if (!view.memberId) redirect('/me/profile')
  return <DressingRoomClient view={view} />
}
