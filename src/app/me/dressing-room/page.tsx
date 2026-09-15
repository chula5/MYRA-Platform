import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { loadMyDressingRoom } from './actions'
import DressingRoomClient from './DressingRoomClient'

export const dynamic = 'force-dynamic'

// DRESSING ROOM — her own pieces.
export default async function DressingRoomPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const view = await loadMyDressingRoom()
  if (!view.memberId) redirect('/me/profile')
  return <DressingRoomClient view={view} />
}
