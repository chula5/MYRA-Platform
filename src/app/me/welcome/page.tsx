import { redirect } from 'next/navigation'
import { resolveClientMember, firstNameOf } from '@/lib/client-member'
import WelcomeFlow from './WelcomeFlow'
import { markWelcomed } from './actions'

export const dynamic = 'force-dynamic'

// Straight after she makes her login: connect your accounts, then the tour.
export default async function MeWelcomePage({ searchParams }: { searchParams: { preview?: string; as?: string } }) {
  // ?as= is honoured for the admin only (resolveClientMember enforces it) — her preview of a client's step.
  const me = await resolveClientMember(searchParams.as || undefined)
  if (!me) redirect('/')
  // Shown once: from here on For You opens as itself. Her own welcome, not Chloe's preview of it.
  if (!me.test) await markWelcomed().catch(() => undefined)
  return <WelcomeFlow firstName={me ? firstNameOf(me.name) : ''} previewMemberId={me?.test ? me.memberId : undefined} />
}
