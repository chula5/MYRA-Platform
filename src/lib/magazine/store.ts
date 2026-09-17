// MYRA MAGAZINE — building her issue from the inboxes she has connected.
//
// Newsletters are found in her own mail, sorted in bulk by sender and subject,
// then only the fashion ones are opened and read against HER profile. What is
// kept is the handful of pieces that are hers; the email is not stored. A
// publication she mutes is never read again.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { inboxHeadersSince, inboxMessages, memberInboxes } from '@/lib/email/connections'
import { loadClientDescription } from '@/lib/look-check'
import { looksLikeNewsletter, readNewsletter, triageNewsletters, type MagazinePick } from './read'

const db = () => createAdminClient() as any

/** Newsletters live in Promotions and Updates; order mail does not. */
const GMAIL_QUERY = '(category:promotions OR category:updates) -category:purchases'

export interface MagazineIssue {
  issue_id: string
  publication: string
  subject: string | null
  headline: string | null
  received_at: string | null
  hero_image: string | null
  picks: MagazinePick[]
}

export interface MagazineView {
  issues: MagazineIssue[]
  publications: { publication: string; muted: boolean }[]
  /** No inbox connected yet — the magazine has nothing to read. */
  needsInbox: boolean
  lastRefreshed: string | null
}

export async function loadMagazine(memberId: string): Promise<MagazineView> {
  const a = db()
  const [{ data: issues }, { data: pubs }, inboxes] = await Promise.all([
    a.from('member_magazine_issue')
      .select('issue_id, publication, subject, received_at, hero_image, picks, created_at')
      .eq('member_id', memberId).eq('status', 'live')
      .order('received_at', { ascending: false, nullsFirst: false }).limit(60),
    a.from('member_magazine_publisher').select('publication, muted').eq('member_id', memberId).order('publication'),
    memberInboxes(memberId),
  ])
  const rows = ((issues ?? []) as any[])
    .map((r) => ({ ...r, picks: (r.picks ?? []) as MagazinePick[], headline: null as string | null }))
    .filter((r) => r.picks.length)
  return {
    issues: rows,
    publications: (pubs ?? []) as { publication: string; muted: boolean }[],
    needsInbox: inboxes.length === 0,
    lastRefreshed: (rows[0]?.created_at as string) ?? null,
  }
}

export async function mutePublication(memberId: string, publication: string, muted: boolean): Promise<void> {
  const a = db()
  await a.from('member_magazine_publisher').upsert({ member_id: memberId, publication, muted }, { onConflict: 'member_id,publication' })
  // Muting takes the publication's pages out of the magazine as well.
  await a.from('member_magazine_issue').update({ status: muted ? 'hidden' : 'live' })
    .eq('member_id', memberId).eq('publication', publication)
}

/**
 * Read her newsletters from the last `days` and keep what is hers.
 * Returns how many were read and how many made the magazine.
 */
export async function refreshMagazine(
  memberId: string, opts: { days?: number; maxRead?: number } = {},
): Promise<{ read: number; issues: number; picks: number; error?: string }> {
  const a = db()
  const days = opts.days ?? 21
  const maxRead = opts.maxRead ?? 25
  const inboxes = await memberInboxes(memberId)
  if (!inboxes.length) return { read: 0, issues: 0, picks: 0, error: 'Connect an inbox first' }

  const since = new Date(Date.now() - days * 86_400_000)
  const [{ data: seen }, { data: pubs }, description] = await Promise.all([
    a.from('member_magazine_issue').select('message_id').eq('member_id', memberId).limit(2000),
    a.from('member_magazine_publisher').select('publication, muted').eq('member_id', memberId),
    loadClientDescription(a, memberId),
  ])
  const already = new Set(((seen ?? []) as any[]).map((r) => r.message_id))
  const muted = new Set(((pubs ?? []) as any[]).filter((p) => p.muted).map((p) => p.publication.toLowerCase()))

  let read = 0
  let issues = 0
  let picks = 0

  for (const c of inboxes) {
    let headers: { id: string; from: string; subject: string }[]
    try {
      headers = await inboxHeadersSince(c, since, GMAIL_QUERY)
    } catch (err) {
      return { read, issues, picks, error: err instanceof Error ? err.message : 'Could not read the inbox' }
    }
    const fresh = headers.filter((h) => !already.has(h.id) && looksLikeNewsletter(h, c.email))
    const keep = await triageNewsletters(fresh)
    const toRead = fresh.filter((h) => keep.has(h.id)).slice(0, maxRead)

    for (const h of toRead) {
      let messages
      try {
        messages = await inboxMessages(c, [h.id])
      } catch {
        continue
      }
      const m = messages[0]
      if (!m) continue
      read++
      const issue = await readNewsletter(m, description)
      const publication = issue.publication ?? 'Newsletter'
      if (muted.has(publication.toLowerCase())) continue

      await a.from('member_magazine_publisher')
        .upsert({ member_id: memberId, publication, muted: false, seen_at: new Date().toISOString() }, { onConflict: 'member_id,publication' })

      // Every newsletter is remembered so it is never paid for twice, even
      // when it held nothing for her.
      await a.from('member_magazine_issue').upsert({
        member_id: memberId,
        connection_id: c.connection_id,
        message_id: h.id,
        publication,
        subject: issue.headline ?? m.subject ?? null,
        received_at: m.date ? new Date(m.date).toISOString() : null,
        hero_image: issue.hero_image,
        picks: issue.is_newsletter ? issue.picks : [],
        status: 'live',
      }, { onConflict: 'member_id,message_id', ignoreDuplicates: true })
      already.add(h.id)
      if (issue.is_newsletter && issue.picks.length) { issues++; picks += issue.picks.length }
    }
  }
  return { read, issues, picks }
}
