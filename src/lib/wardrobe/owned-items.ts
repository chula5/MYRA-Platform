// Pure helpers for owned (wardrobe) items — no DB, no framework.
//
// The ownership split matters in four places: which pool an item belongs to,
// what a look costs (owned pieces are £0 of new spend), how a look's reuse
// maths treats them (they still count as pieces worn), and how they are
// labelled in review cards and lookbooks.

import type { OwnerRef } from './types'

export interface OwnershipFields {
  ownership?: string | null
  owner_user_id?: string | null
  owner_kind?: string | null
  estimated_value?: number | string | null
  owned_metadata?: any
}

export function isOwnedItem(it: OwnershipFields | null | undefined): boolean {
  return it?.ownership === 'owned'
}

/** Pre-migration rows have no ownership column at all — they are retail. */
export function isRetailItem(it: OwnershipFields | null | undefined): boolean {
  return !isOwnedItem(it)
}

export function retailOnly<T extends OwnershipFields>(items: T[]): T[] {
  return items.filter(isRetailItem)
}

export function ownerMatches(it: OwnershipFields, owners: OwnerRef[]): boolean {
  if (!isOwnedItem(it) || !it.owner_user_id) return false
  return owners.some((o) => o.id === it.owner_user_id && (!it.owner_kind || it.owner_kind === o.kind))
}

/** The owner refs a pilot member's wardrobe may be filed under. */
export function ownerRefsForMember(m: { member_id: string; auth_user_id?: string | null }): OwnerRef[] {
  const refs: OwnerRef[] = [{ kind: 'pilot_member', id: m.member_id }]
  if (m.auth_user_id) refs.push({ kind: 'auth_user', id: m.auth_user_id })
  return refs
}

export function estimatedValueOf(it: OwnershipFields): number | null {
  const v = it.estimated_value
  const n = v == null ? NaN : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Brand label for an owned item: brand row if matched, else what the client typed. */
export function ownedBrandLabel(it: { brand?: { name?: string | null } | null; owned_metadata?: any }): string {
  return it.brand?.name ?? it.owned_metadata?.brand_label ?? 'YOUR WARDROBE'
}

// ── Look spend ──────────────────────────────────────────────────────────────

export interface SpendItem {
  owned?: boolean
  price_gbp?: number | null
  estimated_value_gbp?: number | null
}

export interface LookSpend {
  /** What she would actually pay for this look — retail pieces only. */
  retailTotal: number
  retailCount: number
  pricedRetailCount: number
  ownedCount: number
  /** Replacement value of the owned pieces in the look (user-entered estimates). */
  ownedValue: number
  /** All pieces in the look, retail + owned, for the reuse maths. */
  pieceCount: number
}

export function lookSpend(items: SpendItem[]): LookSpend {
  let retailTotal = 0
  let retailCount = 0
  let pricedRetailCount = 0
  let ownedCount = 0
  let ownedValue = 0
  for (const it of items) {
    if (it.owned) {
      ownedCount++
      if (typeof it.estimated_value_gbp === 'number' && it.estimated_value_gbp > 0) ownedValue += it.estimated_value_gbp
    } else {
      retailCount++
      if (typeof it.price_gbp === 'number' && Number.isFinite(it.price_gbp)) {
        retailTotal += it.price_gbp
        pricedRetailCount++
      }
    }
  }
  return { retailTotal, retailCount, pricedRetailCount, ownedCount, ownedValue, pieceCount: items.length }
}

/** "£275 · 3 pieces already hers" — the proposition made concrete. */
export function formatLookSpend(s: LookSpend): string {
  const parts: string[] = []
  parts.push(s.pricedRetailCount > 0 ? `£${Math.round(s.retailTotal).toLocaleString('en-GB')} to buy` : s.retailCount > 0 ? 'price on request' : 'nothing to buy')
  if (s.ownedCount > 0) parts.push(`${s.ownedCount} piece${s.ownedCount === 1 ? '' : 's'} already hers`)
  return parts.join(' · ')
}

// ── Reuse / cost-per-wear ──────────────────────────────────────────────────

/** item_id → number of looks it appears in (owned or retail). */
export function styledInCounts(looks: { items?: { item_id?: string | null }[] | null }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of looks) {
    const seen = new Set<string>()
    for (const it of l.items ?? []) {
      if (!it?.item_id || seen.has(it.item_id)) continue
      seen.add(it.item_id)
      m.set(it.item_id, (m.get(it.item_id) ?? 0) + 1)
    }
  }
  return m
}

/** Cost per wear = value / number of looks it's styled into; null when unknowable. */
export function costPerWear(value: number | null, wears: number): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0 || wears <= 0) return null
  return value / wears
}
