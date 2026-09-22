'use server'

// The JOURNEY tab's two reads.
//
// Both are admin-gated. Every export of a 'use server' file is callable by
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
