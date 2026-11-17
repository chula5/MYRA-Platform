import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { loadMyPiece } from '../actions'
import PieceClient from '../PieceClient'

export const dynamic = 'force-dynamic'
// A tap on a piece may wait on MYRA's eye; the route needs the minute, not the seconds a page normally gets.
export const maxDuration = 60

// One of her pieces: how it has been styled, STYLE THIS and the finders.
export default async function PiecePage({ params }: { params: Promise<{ itemId: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const { itemId } = await params
  const view = await loadMyPiece(itemId)
  if (!view.memberId) redirect('/me/profile')
  // Not one of hers (a sale find from an email, an old link): the piece still
  // opens — in the mirror, where any piece MYRA has can be styled.
  if (!view.piece) redirect(`/me/ways/${encodeURIComponent(itemId)}`)
  return <PieceClient view={view} />
}
