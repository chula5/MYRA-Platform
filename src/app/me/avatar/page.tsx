import { redirect } from 'next/navigation'
import { loadMyAvatar } from './actions'
import { loadMyRoom } from './room-actions'
import AvatarClient from './AvatarClient'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// MY AVATAR — her photos in, her avatar out, approved by her before anything is dressed on it.
export default async function MyAvatarPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  // /me/avatar?item=<id> — from a wardrobe tile's "see it on my avatar": the room opens with that piece on.
  const { item } = await searchParams
  const view = await loadMyAvatar()
  if ('error' in view) {
    if (view.error === 'Not signed in') redirect('/signin')
    return <p className="text-[17px] text-[#B83A3A]">{view.error}</p>
  }
  const room = view.avatar?.status === 'ready' ? await loadMyRoom() : null
  return <AvatarClient view={view} room={room && !('error' in room) ? room : null} startItem={item ?? null} />
}
