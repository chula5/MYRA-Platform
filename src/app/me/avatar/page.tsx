import { redirect } from 'next/navigation'
import { loadMyAvatar } from './actions'
import AvatarClient from './AvatarClient'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// MY AVATAR — her photos in, her avatar out, approved by her before anything is dressed on it.
export default async function MyAvatarPage() {
  const view = await loadMyAvatar()
  if ('error' in view) {
    if (view.error === 'Not signed in') redirect('/signin')
    return <p className="text-[17px] text-[#B83A3A]">{view.error}</p>
  }
  return <AvatarClient view={view} />
}
