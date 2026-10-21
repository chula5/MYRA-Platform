'use server'

// The JOURNEY tab's reads.
//
// All are admin-gated. Every export of a 'use server' file is callable by
// anyone from the browser, and what these return is a member's browsing
// history — which is exactly the kind of thing that must never answer to an
// unauthenticated caller. assertAdmin throws rather than returning an error
// shape, so there is no path where a non-admin gets a partial answer.

import { assertAdmin } from '@/lib/admin-audit'
import {
  loadJourneyOverview,
  loadJourneyReplay,
  type JourneyOverview,
  type JourneyReplay,
} from '@/lib/client-journey'
import { loadSignOn, loadUnmatchedSignOn, type SignOnEvent, type SignOnStatus } from '@/lib/sign-on'
import { loadJourneyUsage, type JourneyUsage } from '@/lib/journey-usage'

export async function loadJourney(
  memberId: string | null,
  days: number,
): Promise<JourneyOverview> {
  await assertAdmin()
  return loadJourneyOverview({ memberId, days })
}

export async function loadReplay(sessionId: string): Promise<JourneyReplay> {
  await assertAdmin()
  return loadJourneyReplay(sessionId)
}

/** The door in front of the rooms: where each member has got to signing on,
 *  and — for everyone — failed attempts with an email no member has. */
export async function loadSignOnView(
  memberId: string | null,
): Promise<{ members: SignOnStatus[]; unmatched: SignOnEvent[] }> {
  await assertAdmin()
  const [members, unmatched] = await Promise.all([
    loadSignOn(memberId),
    memberId ? Promise.resolve([]) : loadUnmatchedSignOn(30),
  ])
  return { members, unmatched }
}

/** What she did with it: pieces, brands, saves, searches, emails, retention. */
export async function loadUsage(memberId: string | null, days: number): Promise<JourneyUsage> {
  await assertAdmin()
  return loadJourneyUsage({ memberId, days })
}
