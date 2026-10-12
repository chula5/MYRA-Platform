import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import MirrorCurtain from '@/components/me/MirrorCurtain'
import { loadForYou } from './for-you-actions'
import { loadShopBrain, type ShopBrainView } from './shop-brain-actions'
import ForYouClient from './ForYouClient'
import AppFirstOpen from '@/components/me/AppFirstOpen'

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

  // Her first time: the welcome — connect your accounts, MYRA where you shop —
  // and the tour come before For You. The invite link brings her through them
  // by itself; a login signed in anywhere else (the iPhone app's sign-in, for
  // one) used to land straight here and never see them. Not Chloe, whose
  // own account is not a client's.
  const isAdmin = user.id === process.env.ADMIN_USER_ID
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  if (!isAdmin && !meta.welcomed_at && !meta.toured_at) redirect('/me/welcome')
  const appWelcomed = isAdmin || !!meta.app_welcomed_at

  return (
    <Suspense fallback={<MirrorCurtain />}>
      <ForYouLoaded appWelcomed={appWelcomed} />
    </Suspense>
  )
}

// How long the mirror will wiggle while the page is built. Her kept view
// answers in well under a second; only a cold rebuild runs longer, and then
// the section is fetched by the page itself rather than holding her here.
const SHOP_BRAIN_WAIT_MS = 8000

async function ForYouLoaded({ appWelcomed }: { appWelcomed: boolean }) {
  // Both halves of the page are gathered together, on the server, behind the
  // mirror — so when it lifts the page is already whole underneath.
  const [view, shopBrain] = await Promise.all([
    loadForYou(),
    Promise.race<ShopBrainView | null>([
      loadShopBrain().catch(() => null),
      new Promise<null>((done) => setTimeout(() => done(null), SHOP_BRAIN_WAIT_MS)),
    ]),
  ])
  if (!view.memberId) redirect('/me/profile')
  return (
    <>
      <AppFirstOpen welcomed={appWelcomed} />
      <ForYouClient view={view} shopBrain={shopBrain} />
    </>
  )
}
