import 'server-only'

// The extension's presence, for her YOU page: connected or not, in which
// browser, since when, and when it last checked in. Touched from
// /api/mirror/me — the one call the extension makes on connect and each
// time its popup opens — so "last seen" means she actually had it open.

import { createAdminClient } from '@/lib/supabase-server'

export interface MirrorLinkState {
  connected: boolean
  connectedAt: string | null
  lastSeenAt: string | null
  /** "Safari on iPhone", "Chrome on Mac"… from the user agent at last check-in. */
  browser: string | null
}

export const NO_MIRROR: MirrorLinkState = { connected: false, connectedAt: null, lastSeenAt: null, browser: null }

/** A short, human name for the browser behind a user-agent string. */
export function browserLabel(ua: string | null | undefined): string | null {
  if (!ua) return null
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : null
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : null
  if (!browser) return device
  return device ? `${browser} on ${device}` : browser
}

/** Record that the extension checked in as this member. Quiet before the migration has run. */
export async function touchMirrorPresence(memberId: string, ua: string | null): Promise<void> {
  const admin = createAdminClient() as any
  const now = new Date().toISOString()
  const browser = browserLabel(ua)
  try {
    const { data } = await admin.from('member_mirror_link').select('uses').eq('member_id', memberId).maybeSingle()
    if (data) await admin.from('member_mirror_link').update({ last_seen_at: now, browser, uses: (data.uses ?? 0) + 1 }).eq('member_id', memberId)
    else await admin.from('member_mirror_link').insert({ member_id: memberId, connected_at: now, last_seen_at: now, browser, uses: 1 })
  } catch { /* the extension still works without the record */ }
}

export async function mirrorLinkState(memberId: string): Promise<MirrorLinkState> {
  const admin = createAdminClient() as any
  try {
    const { data } = await admin.from('member_mirror_link').select('connected_at, last_seen_at, browser').eq('member_id', memberId).maybeSingle()
    if (!data) return NO_MIRROR
    return { connected: true, connectedAt: data.connected_at, lastSeenAt: data.last_seen_at, browser: data.browser ?? null }
  } catch {
    return NO_MIRROR
  }
}
