// The gates /me applies to the shared pool before composing for a real member,
// as pure functions so the Quality Lab (and its tests) can apply them.
//
// Avoided colours, shapes and types are a hard gate; hidden and input-only
// brands never show; over her price ceiling never shows; her persona brief's
// BANS never show. Her loved shoe types then own the shoe slot — trainers lead
// outright when she loves them and there are enough to vary — exactly as
// preferLovedShoes does for her weekly looks.

import type { ItemWithBrand } from '@/lib/admin-queries'
import {
  briefPiece,
  itemPriceVerdict,
  memberItemScore,
  preferLovedShoes,
  type MemberTaste,
} from '@/lib/pilot-composer'
import { avoidReasons } from '@/lib/pilot-stylist'
import { briefBlocks } from '@/lib/stylist-brief'
import { judgeLook } from '@/lib/style-rules'
import { hardSkipPairs } from '@/lib/pipeline'
import { toHouseItem } from '@/lib/house-item'

/**
 * How strongly her taste pulls a piece onto a slot's shortlist, next to the
 * pairwise compat (0..1) it is ranked on. memberItemScore runs ~[-0.5, 1.4]:
 * a loved type (+0.15) or colour (+0.18) lifts a piece a few places; a brand
 * she keeps swapping out sinks it.
 */
export const MEMBER_SHORTLIST_SCALE = 0.3

export function gateToMemberTaste(t: MemberTaste, pool: ItemWithBrand[]): ItemWithBrand[] {
  const bans = !!t.brief?.nevers?.some((n) => n.kind === 'ban')
  const kept = pool.filter(
    (i) =>
      !(i.brand_id && t.hiddenBrandIds?.has(i.brand_id)) &&
      !(i.brand?.name && t.inputOnlyBrands.has(i.brand.name.toLowerCase())) &&
      avoidReasons(t.prefs, i as any).length === 0 &&
      itemPriceVerdict(t, i) !== 'over' &&
      !(bans && briefBlocks(briefPiece(i), t.brief)),
  )
  return preferLovedShoes(t, kept)
}

/** Her taste as a shortlist pull: loves, history, price band, learned traits. */
export function memberShortlistPull(t: MemberTaste): (item: ItemWithBrand) => number {
  return (item) => MEMBER_SHORTLIST_SCALE * memberItemScore(t, item)
}

/**
 * Her rule layer (global bans, her house style, Chloe style) as a whole-look
 * gate, anchor first. Undefined when she has no rules beyond her own gates.
 */
export function memberLookGate(t: MemberTaste): ((all: ItemWithBrand[]) => boolean) | undefined {
  const rules = t.rules
  if (!rules) return undefined
  return (all) =>
    !judgeLook(all.map((it) => toHouseItem(it)), rules, {
      learnedApprovedPairs: t.learnedPairs?.approved,
      learnedRejectedPairs: t.learnedPairs?.rejected,
      softSkipPairs: t.styleModel ? hardSkipPairs(t.styleModel) : undefined,
    }).blocked
}
