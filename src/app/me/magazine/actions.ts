'use server'

// MYRA MAGAZINE — the browser-callable surface. Every action resolves the
// member on the server (her session, or the member Chloe names from HER VIEW,
// admin only) and passes only that id on. Reading her newsletters is real in
// HER VIEW too: it is her actual mailbox.

import { resolveClientMember } from '@/lib/client-member'
import { loadMagazine, mutePublication, refreshMagazine, type MagazineView } from '@/lib/magazine/store'

export interface MagazinePageView extends MagazineView {
  memberId: string | null
  firstName: string
  test: boolean
  error?: string
}

const empty = { issues: [], publications: [], needsInbox: true, lastRefreshed: null }

export async function loadMyMagazine(asMemberId?: string): Promise<MagazinePageView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { memberId: null, firstName: '', test: false, ...empty }
  try {
    const view = await loadMagazine(me.memberId)
    return { memberId: me.memberId, firstName: me.name.split(' ')[0] ?? me.name, test: me.test, ...view }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      memberId: me.memberId, firstName: me.name.split(' ')[0] ?? me.name, test: me.test, ...empty,
      error: /member_magazine/.test(msg) ? 'Run migration 0059_member_magazine.sql in Supabase first' : msg,
    }
  }
}

/** Read the newsletters that have come in since the last look. */
export async function refreshMyMagazine(asMemberId?: string): Promise<{ read: number; issues: number; picks: number; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { read: 0, issues: 0, picks: 0, error: 'Not signed in' }
  return refreshMagazine(me.memberId)
}

/** Stop reading a publication, or start again. */
export async function setPublicationMuted(publication: string, muted: boolean, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  await mutePublication(me.memberId, publication, muted)
  return {}
}
