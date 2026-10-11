// WAYS TO WEAR IT — the demand ledger (migration 0096).
//
// What each member has had in front of her, per piece and per mode. Browse
// cards she lingered on, the piece she picked, a look she opened, FOR YOU's
// shelf, her Mirror saves and views all land here. The nightly warm-up reads
// what is not yet covered; the admin tile divides covered by surfaced; a tap
// is counted on the row with whether it was answered at once. Nothing here
// resolves a session — the server actions hand in the member id.

import 'server-only'
import { countFreshWays } from '@/lib/styled-ways'
import { WAYS, type WayMode } from '@/lib/styled-ways-core'

export type DemandSource = 'browse' | 'pick' | 'look' | 'feed' | 'save' | 'view' | 'wardrobe' | 'tap' | 'nightly'

export interface DemandRow {
  member_id: string
  hero_item_id: string
  mode: WayMode
  source: DemandSource
  first_seen_at: string
  last_seen_at: string
  seen: number
  taps: number
  tap_hits: number
}

const migrationHint = (msg: string) => (/styled_way_demand|styled_way_notice|styled_way_tap/.test(msg) ? 'Run migration 0096 in Supabase first' : msg)

/** Pieces were put in front of her. Never throws: a ledger miss must not break a page. */
export async function noticeDemand(admin: any, memberId: string, heroIds: string[], mode: WayMode, source: DemandSource): Promise<void> {
  const ids = Array.from(new Set(heroIds.filter(Boolean)))
  if (!ids.length) return
  const { error } = await admin.rpc('styled_way_notice', { p_member_id: memberId, p_hero_ids: ids, p_mode: mode, p_source: source })
  if (error) console.error('[styled-ways-demand] notice', migrationHint(error.message))
}

/** She tapped; `hit` when three ways came straight from the memory. */
export async function recordTap(admin: any, memberId: string, heroId: string, mode: WayMode, hit: boolean): Promise<void> {
  const { error } = await admin.rpc('styled_way_tap', { p_member_id: memberId, p_hero_id: heroId, p_mode: mode, p_hit: hit })
  if (error) console.error('[styled-ways-demand] tap', migrationHint(error.message))
}

/**
 * What she has seen lately that does not yet have its three ways — newest
 * and most-seen first. The nightly warm-up's list for a mode.
 */
export async function uncoveredDemand(
  admin: any,
  memberId: string,
  mode: WayMode,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<string[]> {
  const since = new Date(Date.now() - (opts.sinceDays ?? 7) * 86_400_000).toISOString()
  const limit = opts.limit ?? 12
  const { data, error } = await admin.from('styled_way_demand').select('hero_item_id, seen')
    .eq('member_id', memberId).eq('mode', mode).gte('last_seen_at', since)
    .order('last_seen_at', { ascending: false }).limit(limit * 4)
  if (error) { console.error('[styled-ways-demand] uncovered', migrationHint(error.message)); return [] }
  const rows = (data ?? []) as { hero_item_id: string; seen: number }[]
  if (!rows.length) return []
  const fresh = await countFreshWays(admin, memberId, rows.map((r) => r.hero_item_id), mode)
  return rows
    .filter((r) => (fresh.get(r.hero_item_id) ?? 0) < WAYS)
    .sort((a, b) => b.seen - a.seen)
    .slice(0, limit)
    .map((r) => r.hero_item_id)
}
