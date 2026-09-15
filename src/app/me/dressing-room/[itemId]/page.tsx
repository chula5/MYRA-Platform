import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { loadMyPiece } from '../actions'
import PieceClient from '../PieceClient'

export const dynamic = 'force-dynamic'

// One of her pieces: how it has been styled, STYLE THIS and the finders.
export default async function PiecePage({ params }: { params: Promise<{ itemId: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const { itemId } = await params
  const view = await loadMyPiece(itemId)
  if (!view.memberId) redirect('/me/profile')
  return <PieceClient view={view} />
}
