'use server'

// THREADS — the browser-callable surface. The member is resolved on the server
// (her session, or the member Chloe names from HER VIEW, admin only).

import { resolveClientMember } from '@/lib/client-member'
import { buildThreads, buildThreadsRead, type ThreadsView } from '@/lib/threads/build'

export interface ThreadsPageView extends ThreadsView {
  memberId: string | null
  test: boolean
  error?: string
}

const EMPTY = { firstName: '', portrait: null, inferences: [], opening: '', threads: [], thin: [], counts: { pieces: 0, pictures: 0, looks: 0, yes: 0, no: 0, brands: 0 } }

export async function loadMyThreads(asMemberId?: string): Promise<ThreadsPageView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { memberId: null, test: false, ...EMPTY }
  try {
    const view = await buildThreads(me.memberId)
    return { memberId: me.memberId, test: me.test, ...view }
  } catch (err) {
    return { memberId: me.memberId, test: me.test, ...EMPTY, error: err instanceof Error ? err.message : 'Could not read your threads' }
  }
}

/** The written read — her style in two sentences, and what MYRA infers. Slower; asked for after the threads show. */
export async function loadMyThreadsRead(asMemberId?: string): Promise<{ portrait: string | null; inferences: string[] }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { portrait: null, inferences: [] }
  try {
    return await buildThreadsRead(me.memberId)
  } catch {
    return { portrait: null, inferences: [] }
  }
}
