// WAYS TO WEAR IT — the memory (migration 0094).
//
// Every look MYRA builds around a piece for a member and passes through its
// eye is kept here, so the second tap on that piece anywhere in the app is
// instant and costs nothing. Rows die when a piece in them stops being
// sellable: the stock sentinel marks them, and a read drops any it finds on
// sight. Nothing in here resolves a session — the server actions do that and
// hand in the member id.

import 'server-only'
import {
  WAYS, idsOf, signatureOf, sellableWays, orderWays, toStyledLook,
  type StyledWayRow, type StyledWayLook, type WayMode, type WaySource, type WayVerdict,
} from '@/lib/styled-ways-core'
import type { LookItem } from '@/lib/pilot-stylist'

export type { StyledWayLook, WayMode } from '@/lib/styled-ways-core'
export { WAYS } from '@/lib/styled-ways-core'

const COLS = 'styled_way_id, member_id, hero_item_id, mode, items, item_ids, items_signature, verdict, confidence, why, occasion_id, occasion_label, source, judged_at, stale'

export interface WayToSave {
  items: LookItem[]
  why: string
  verdict: WayVerdict
  confidence?: number | null
  occasion_id?: string | null
  occasion_label?: string | null
}

/**
 * The fresh ways around one piece, best first, at most WAYS. Any whose pieces
 * can no longer be bought are retired as they are found, so a sold-out look
 * is never shown even before the sentinel's next pass.
 */
export async function getStyledWays(
  admin: any,
  memberId: string,
  heroId: string,
  mode: WayMode = 'blend',
  opts: { limit?: number } = {},
): Promise<StyledWayLook[]> {
  const { data, error } = await admin.from('styled_way').select(COLS)
    .eq('member_id', memberId).eq('hero_item_id', heroId).eq('mode', mode).eq('stale', false)
    .order('judged_at', { ascending: false }).limit(24)
  if (error) {
    if (/styled_way/.test(error.message)) throw new Error('Run migration 0094 in Supabase first')
    throw new Error(error.message)
  }
  const rows = (data ?? []) as StyledWayRow[]
  if (!rows.length) return []

  const ids = Array.from(new Set(rows.flatMap((r) => r.item_ids)))
  const { data: items } = await admin.from('item').select('item_id, stock_status, status').in('item_id', ids)
  const stock = new Map<string, { stock_status: string | null; status: string | null }>(
    ((items ?? []) as any[]).map((i) => [i.item_id, { stock_status: i.stock_status ?? null, status: i.status ?? null }]),
  )
  const { keep, dead } = sellableWays(rows, stock)
  if (dead.length) {
    // Retire what died, by row — the reason names the piece that killed it.
    await Promise.all(dead.map((d) =>
      admin.from('styled_way').update({ stale: true, stale_reason: `${d.reason}:${d.itemId}` }).eq('styled_way_id', d.row.styled_way_id),
    )).catch(() => { /* a failed retire only means the next read tries again */ })
  }
  return orderWays(keep).slice(0, opts.limit ?? WAYS).map(toStyledLook)
}

/** How many fresh ways a piece already has — the cheap question warm-ups ask first. */
export async function countFreshWays(admin: any, memberId: string, heroIds: string[], mode: WayMode = 'blend'): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!heroIds.length) return out
  const { data } = await admin.from('styled_way').select('hero_item_id')
    .eq('member_id', memberId).eq('mode', mode).eq('stale', false).in('hero_item_id', heroIds)
  for (const r of (data ?? []) as { hero_item_id: string }[]) out.set(r.hero_item_id, (out.get(r.hero_item_id) ?? 0) + 1)
  return out
}

/** Keep judged looks. The same look (same pieces) refreshes its row rather than doubling. */
export async function saveStyledWays(
  admin: any,
  memberId: string,
  heroId: string,
  mode: WayMode,
  looks: WayToSave[],
  source: WaySource,
): Promise<StyledWayLook[]> {
  const now = new Date().toISOString()
  const rows = looks
    .filter((l) => l.items.length && (l.verdict === 'works' || l.verdict === 'borderline'))
    .map((l) => ({
      member_id: memberId,
      hero_item_id: heroId,
      mode,
      items: l.items,
      item_ids: idsOf(l.items),
      items_signature: signatureOf(l.items),
      verdict: l.verdict,
      confidence: l.confidence ?? null,
      why: l.why ?? '',
      occasion_id: l.occasion_id ?? null,
      occasion_label: l.occasion_label ?? null,
      source,
      judged_at: now,
      stale: false,
      stale_reason: null,
    }))
  if (!rows.length) return []
  const { data, error } = await admin.from('styled_way')
    .upsert(rows, { onConflict: 'member_id,hero_item_id,mode,items_signature' })
    .select(COLS)
  if (error) {
    if (/styled_way/.test(error.message)) throw new Error('Run migration 0094 in Supabase first')
    throw new Error(error.message)
  }
  return ((data ?? []) as StyledWayRow[]).map(toStyledLook)
}

/** A piece can no longer be bought: every kept way holding it is retired. */
export async function markStyledWaysStale(admin: any, itemId: string, reason: string): Promise<number> {
  const { data, error } = await admin.from('styled_way')
    .update({ stale: true, stale_reason: `${reason}:${itemId}` })
    .contains('item_ids', [itemId]).eq('stale', false)
    .select('styled_way_id')
  if (error) return 0
  return (data ?? []).length
}

/** The signatures already kept for a piece — so "more ways" never repeats one. */
export async function keptSignatures(admin: any, memberId: string, heroId: string, mode: WayMode): Promise<Set<string>> {
  const { data } = await admin.from('styled_way').select('items_signature, item_ids')
    .eq('member_id', memberId).eq('hero_item_id', heroId).eq('mode', mode)
  return new Set(((data ?? []) as { items_signature: string }[]).map((r) => r.items_signature))
}

export async function keptItemIds(admin: any, memberId: string, heroId: string, mode: WayMode): Promise<string[][]> {
  const { data } = await admin.from('styled_way').select('item_ids')
    .eq('member_id', memberId).eq('hero_item_id', heroId).eq('mode', mode).eq('stale', false)
  return ((data ?? []) as { item_ids: string[] }[]).map((r) => r.item_ids)
}
