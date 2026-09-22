'use server'

// YOU — her own settings: what MYRA calls her, her sizes, the colours she
// loves and won't wear, and the accounts she has connected. Every action
// resolves the member on the server (her session, or the member Chloe names
// from HER VIEW, admin only). Changes here are real: they are her profile.

import { resolveClientMember } from '@/lib/client-member'
import { createAdminClient } from '@/lib/supabase-server'
import { SIZE_CATEGORIES, ladderFor, type SizeCategory } from '@/lib/size-canonical'
import { COLOUR_SHADES, COLOUR_FAMILY_IDS, OCCASION_TYPES, SHAPE_PREFERENCES, PIECE_PREFERENCES } from '@/lib/pilot-stylist'
import { buildYouSettings, type YouSettingsView, type YouSizes } from '@/lib/you-settings'

export type { YouSettingsView, YouSizes }

export async function loadMySettings(asMemberId?: string): Promise<YouSettingsView | null> {
  const me = await resolveClientMember(asMemberId)
  return me ? buildYouSettings(me.memberId, me.test, me.name) : null
}

export interface YouSettingsPatch {
  name?: string
  sizes?: Record<SizeCategory, YouSizes>
  acceptsSecondHand?: boolean
  coloursLoved?: string[]
  coloursAvoided?: string[]
  shapesLoved?: string[]
  shapesAvoided?: string[]
  typesLoved?: string[]
  typesAvoided?: string[]
  neverWears?: string
  occasions?: string[]
  brands?: string[]
}

export async function saveMySettings(patch: YouSettingsPatch, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const admin = createAdminClient() as any
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 80)
    if (!name) return { error: 'Your name can’t be empty' }
    update.name = name
  }
  if (patch.sizes) {
    // Only sizes on the ladder are kept: a typo can't hide every piece from her.
    const onLadder = (c: SizeCategory, n: number | null) => (n != null && ladderFor(c).includes(Number(n)) ? Number(n) : null)
    const profile: Record<string, { value: number; adjacent: number | null }> = {}
    for (const c of SIZE_CATEGORIES) {
      const value = onLadder(c, patch.sizes[c]?.value ?? null)
      if (value == null) continue
      const adjacent = onLadder(c, patch.sizes[c]?.adjacent ?? null)
      profile[c] = { value, adjacent: adjacent === value ? null : adjacent }
    }
    update.size_profile = profile
  }
  if (patch.acceptsSecondHand !== undefined) update.accepts_second_hand = !!patch.acceptsSecondHand
  // A whole family ("black") is as valid a love as a shade ("true black"); dropping families on save lost real preferences.
  const known = new Set([...COLOUR_SHADES.map((s) => s.id), ...COLOUR_FAMILY_IDS])
  const shapes = new Set(SHAPE_PREFERENCES.map((s) => s.id))
  const pieces = new Set(PIECE_PREFERENCES.map((p) => p.value))
  if (patch.coloursLoved) update.colours_loved = patch.coloursLoved.filter((c) => known.has(c))
  if (patch.coloursAvoided) update.colours_avoided = patch.coloursAvoided.filter((c) => known.has(c))
  if (patch.shapesLoved) update.shapes_loved = patch.shapesLoved.filter((x) => shapes.has(x))
  if (patch.shapesAvoided) update.shapes_avoided = patch.shapesAvoided.filter((x) => shapes.has(x))
  if (patch.typesLoved) update.types_loved = patch.typesLoved.filter((x) => pieces.has(x))
  if (patch.typesAvoided) update.types_avoided = patch.typesAvoided.filter((x) => pieces.has(x))
  if (patch.brands) {
    // Ranked in the order she put them, keeping the stylist's note on the ones already there.
    const { data: had } = await admin.from('pilot_member').select('brands').eq('member_id', me.memberId).maybeSingle()
    const known = new Map(((had?.brands ?? []) as any[]).map((b) => [String(b?.name ?? '').toLowerCase(), b]))
    update.brands = patch.brands.map((b) => String(b).trim()).filter(Boolean).slice(0, 40)
      .map((name, i) => ({ ...(known.get(name.toLowerCase()) ?? {}), name, rank: i + 1 }))
  }
  if (patch.occasions) {
    // Kept as frequencies, the shape the stylist's maths reads; her ticks mean "yes, I dress for this".
    const ticked = new Set(patch.occasions)
    update.occasions = Object.fromEntries(OCCASION_TYPES.map((o) => [o.id, ticked.has(o.id) ? 'weekly' : 'never']))
  }
  if (patch.neverWears !== undefined) update.never_wears = patch.neverWears.trim().slice(0, 600) || null

  const { error } = await admin.from('pilot_member').update(update).eq('member_id', me.memberId)
  return error ? { error: error.message } : {}
}
