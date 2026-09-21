import { resolveClientMember, firstNameOf } from '@/lib/client-member'
import WelcomeFlow from './WelcomeFlow'

export const dynamic = 'force-dynamic'

// Straight after she makes her login: connect your accounts, then the tour.
export default async function MeWelcomePage({ searchParams }: { searchParams: { preview?: string; as?: string } }) {
  // ?as= is honoured for the admin only (resolveClientMember enforces it) — her preview of a client's step.
  const me = await resolveClientMember(searchParams.as || undefined)
  return <WelcomeFlow firstName={me ? firstNameOf(me.name) : ''} previewMemberId={me?.test ? me.memberId : undefined} />
}
