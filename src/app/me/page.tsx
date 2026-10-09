import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import MirrorCurtain from '@/components/me/MirrorCurtain'
import { loadForYou } from './for-you-actions'
import ForYouClient from './ForYouClient'

export const dynamic = 'force-dynamic'
// A tap on a piece may wait on MYRA's eye; the route needs the minute, not the seconds a page normally gets.
export const maxDuration = 60

// FOR YOU — the member home for the private-stylist experience.
//
// The sign-in check is quick and runs first. Her looks take a moment to
// gather, so they stream in behind the mirror: the curtain is on screen the
// instant the page arrives, and the page is drawn underneath it while the
// mirror wiggles — never a blank page first, never the mirror on an empty one.
export default async function ForYouPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  return (
    <Suspense fallback={<MirrorCurtain />}>
      <ForYouLoaded />
    </Suspense>
  )
}

async function ForYouLoaded() {
  const view = await loadForYou()
  if (!view.memberId) redirect('/me/profile')
  return <ForYouClient view={view} />
}
