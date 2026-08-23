// ── Size availability + size profiles (server) ───────────────────────────────
//
// Everything that touches the database for sizing lives here: reading and
// writing a shopper's size profile, keeping item_size_availability in step with
// the stock sweep, and resolving "can she buy this" for a batch of items in one
// query rather than N.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import {
  canonicalise, sizeCategoryFor, SIZE_CATEGORIES,
  type SizeCategory, type SizeProfile, type BrandSizeOffsets,
} from '@/lib/size-canonical'
import {
  resolveAvailability, passesSizeGate,
  type ItemAvailability, type SizeRow, type StockLevel,
} from '@/lib/size-match'
import { isSecondHand, isUnique, type SourceBearing } from '@/lib/second-hand'

export interface ShopperSizeContext {
  profile: SizeProfile
  acceptsSecondHand: boolean
  /** She has told us at least one size. Gates fall back to lenient when false. */
  hasProfile: boolean
}

export const EMPTY_SIZE_CONTEXT: ShopperSizeContext = {
  profile: {},
  acceptsSecondHand: false,
  hasProfile: false,
}

// ── User size profile ────────────────────────────────────────────────────────

function profileFromRow(row: Record<string, any> | null | undefined): SizeProfile {
  const p: SizeProfile = {}
  if (!row) return p
  for (const c of SIZE_CATEGORIES) {
    const value = row[c]
    const adjacent = row[`${c}_adjacent`]
    if (value != null) p[c] = { value: Number(value), adjacent: adjacent != null ? Number(adjacent) : null }
  }
  return p
}

function rowFromProfile(profile: SizeProfile): Record<string, number | null> {
  const row: Record<string, number | null> = {}
  for (const c of SIZE_CATEGORIES) {
    row[c] = profile[c]?.value ?? null
    row[`${c}_adjacent`] = profile[c]?.adjacent ?? null
  }
  return row
}

export async function loadUserSizeProfile(userId: string | null | undefined): Promise<ShopperSizeContext> {
  if (!userId) return EMPTY_SIZE_CONTEXT
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('user_size_profile' as any)
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (!data) return EMPTY_SIZE_CONTEXT
    const profile = profileFromRow(data as any)
    return {
      profile,
      acceptsSecondHand: !!(data as any).accepts_second_hand,
      hasProfile: SIZE_CATEGORIES.some((c) => profile[c]?.value != null),
    }
  } catch (err) {
    console.error('[loadUserSizeProfile]', err)
    return EMPTY_SIZE_CONTEXT
  }
}

export async function saveUserSizeProfile(
  userId: string,
  profile: SizeProfile,
  acceptsSecondHand: boolean,
): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient()
    const { error } = await (admin.from('user_size_profile') as any).upsert({
      user_id: userId,
      ...rowFromProfile(profile),
      accepts_second_hand: acceptsSecondHand,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
    return {}
  } catch (err) {
    console.error('[saveUserSizeProfile]', err)
    return { error: err instanceof Error ? err.message : 'Could not save your sizes' }
  }
}

/**
 * A private-stylist client's sizes. pilot_member carries them as free text
 * ({ top: "M", bottom: "28", shoe: "39", dress: "10" }) from the intake form,
 * so they're canonicalised on read — the intake stays in her words.
 */
export async function loadMemberSizeProfile(memberId: string): Promise<ShopperSizeContext> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('pilot_member' as any)
      .select('sizes, size_profile, accepts_second_hand')
      .eq('member_id', memberId)
      .maybeSingle()
    if (!data) return EMPTY_SIZE_CONTEXT

    // The structured profile wins when it's been filled in; otherwise fall back
    // to canonicalising the free-text intake answers.
    const structured = ((data as any).size_profile ?? {}) as Record<string, any>
    const profile: SizeProfile = {}
    for (const c of SIZE_CATEGORIES) {
      const s = structured[c]
      if (s && s.value != null) profile[c] = { value: Number(s.value), adjacent: s.adjacent != null ? Number(s.adjacent) : null }
    }

    if (!SIZE_CATEGORIES.some((c) => profile[c])) {
      const raw = ((data as any).sizes ?? {}) as Record<string, string>
      const legacy: [SizeCategory, string | undefined][] = [
        ['tops', raw.dress ?? raw.top],
        ['bottoms', raw.bottom],
        ['outerwear', raw.top ?? raw.dress],
        ['shoes', raw.shoe],
      ]
      for (const [cat, label] of legacy) {
        if (!label) continue
        const c = canonicalise(String(label), cat)
        if (c.value != null) profile[cat] = { value: c.value, adjacent: null }
      }
    }

    return {
      profile,
      acceptsSecondHand: !!(data as any).accepts_second_hand,
      hasProfile: SIZE_CATEGORIES.some((c) => profile[c]?.value != null),
    }
  } catch (err) {
    console.error('[loadMemberSizeProfile]', err)
    return EMPTY_SIZE_CONTEXT
  }
}

// ── item_size_availability ───────────────────────────────────────────────────

export interface SizeEntry {
  label: string
  inStock: boolean
  level?: StockLevel
}

/**
 * Replace an item's size rows with what the source just told us.
 *
 * Rows that disappear from the source are marked sold_out rather than deleted:
 * a size vanishing from a product page IS the sell-out event, and deleting the
 * row would erase the evidence that we ever had it — and with it every alert we
 * owe the people watching that size.
 */
export async function upsertSizeAvailability(
  itemId: string,
  entries: SizeEntry[],
  opts: { itemType?: string | null; brandOffsets?: BrandSizeOffsets | null } = {},
): Promise<{ changed: SizeRow[]; previous: SizeRow[] }> {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const category = sizeCategoryFor(opts.itemType as any)

  const previous = await loadSizeRowsFor([itemId])
  const before = previous.get(itemId) ?? []

  const seen = new Set(entries.map((e) => e.label))
  const rows = entries.map((e) => {
    const c = canonicalise(e.label, category, opts.brandOffsets)
    return {
      item_id: itemId,
      size_label: e.label,
      size_system: c.system,
      canonical_category: c.category,
      canonical_value: c.value,
      canonical_values: c.values,
      in_stock: e.inStock,
      stock_level: e.level ?? (e.inStock ? 'in_stock' : 'sold_out'),
      last_checked: now,
    }
  })

  if (rows.length) {
    const { error } = await (admin.from('item_size_availability') as any).upsert(rows, {
      onConflict: 'item_id,size_label',
    })
    if (error) console.error('[upsertSizeAvailability]', error)
  }

  // Sizes we used to see and no longer do → sold out.
  const gone = before.filter((r) => !seen.has(r.size_label) && r.in_stock).map((r) => r.size_label)
  if (gone.length) {
    await (admin.from('item_size_availability') as any)
      .update({ in_stock: false, stock_level: 'sold_out', last_checked: now })
      .eq('item_id', itemId)
      .in('size_label', gone)
  }

  const after = (await loadSizeRowsFor([itemId])).get(itemId) ?? []
  return { changed: after, previous: before }
}

/** Size rows for a batch of items, keyed by item_id. Paged — a busy feed can exceed 1000. */
export async function loadSizeRowsFor(itemIds: string[]): Promise<Map<string, SizeRow[]>> {
  const out = new Map<string, SizeRow[]>()
  if (!itemIds.length) return out
  const admin = createAdminClient()
  const CHUNK = 200
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const slice = itemIds.slice(i, i + CHUNK)
    const { data, error } = await admin
      .from('item_size_availability' as any)
      .select('item_id, size_label, size_system, canonical_category, canonical_value, canonical_values, in_stock, stock_level')
      .in('item_id', slice)
    if (error) { console.error('[loadSizeRowsFor]', error); continue }
    for (const r of (data ?? []) as any[]) {
      const list = out.get(r.item_id) ?? []
      list.push(r as SizeRow)
      out.set(r.item_id, list)
    }
  }
  return out
}

// ── Batch resolution ─────────────────────────────────────────────────────────

export interface SizedItem extends SourceBearing {
  item_id: string
  item_type?: string | null
  brand?: { size_offset?: BrandSizeOffsets | null; source_type?: string | null } | null
}

/** One availability verdict per item, for a shopper. */
export async function availabilityForItems<T extends SizedItem>(
  items: T[],
  ctx: ShopperSizeContext,
): Promise<Map<string, ItemAvailability>> {
  const rows = await loadSizeRowsFor(items.map((i) => i.item_id))
  const out = new Map<string, ItemAvailability>()
  for (const item of items) {
    out.set(item.item_id, resolveAvailability(item as any, rows.get(item.item_id) ?? [], ctx.profile))
  }
  return out
}

/**
 * The shopper-facing pool.
 *
 *  · sold pieces are gone, full stop
 *  · second-hand pieces appear only for a shopper who opted in
 *  · unique pieces are HARD-FILTERED to her size
 *  · replenishable pieces always survive — they're ranked later, not filtered
 *
 * `strict` (private-stylist lookbooks) applies the size gate to everything.
 */
export async function filterItemsForShopper<T extends SizedItem>(
  items: T[],
  ctx: ShopperSizeContext,
  opts: { strict?: boolean } = {},
): Promise<T[]> {
  const consentFiltered = items.filter((i) => {
    if ((i as any).status === 'sold') return false
    if (isSecondHand(i) && !ctx.acceptsSecondHand) return false
    return true
  })

  const needsGate = consentFiltered.filter((i) => opts.strict || isUnique(i))
  if (!needsGate.length || !ctx.hasProfile) return consentFiltered

  const rows = await loadSizeRowsFor(needsGate.map((i) => i.item_id))
  const blocked = new Set(
    needsGate
      .filter((i) => !passesSizeGate(i as any, rows.get(i.item_id) ?? [], ctx.profile, opts))
      .map((i) => i.item_id),
  )
  return consentFiltered.filter((i) => !blocked.has(i.item_id))
}

/** Brand size offsets for a batch of brands, for canonicalising at ingest. */
export async function loadBrandOffsets(brandIds: string[]): Promise<Map<string, BrandSizeOffsets>> {
  const out = new Map<string, BrandSizeOffsets>()
  if (!brandIds.length) return out
  const admin = createAdminClient()
  const { data } = await admin
    .from('brand' as any)
    .select('brand_id, size_offset')
    .in('brand_id', Array.from(new Set(brandIds)))
  for (const r of (data ?? []) as any[]) out.set(r.brand_id, (r.size_offset ?? {}) as BrandSizeOffsets)
  return out
}
