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
import { forgetMemberMemory } from '@/lib/member-memory'

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

/**
 * HER MYRA LINK for an assistant (Claude, ChatGPT). One signed member token in
 * a URL: a connector that takes only a URL can still ask about her wardrobe.
 * Only the hash is stored — enough to say whether she has a link, when it was
 * last used, and to turn it off. Making a new one turns the old one off.
 */
export async function myAssistantLink(asMemberId?: string): Promise<{ url?: string; days?: number; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const { mintMirrorToken, MIRROR_TOKEN_TTL_S } = await import('@/lib/mirror/auth')
  const { hashAssistantToken } = await import('@/lib/mcp/link')
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.myraassistant.co.uk').replace(/\/+$/, '')
  const token = mintMirrorToken(me.memberId, { ttlS: MIRROR_TOKEN_TTL_S })
  const admin = createAdminClient() as any
  try {
    await admin.from('member_assistant_link').upsert(
      { member_id: me.memberId, token_hash: hashAssistantToken(token), issued_at: new Date().toISOString(), last_used_at: null, uses: 0 },
      { onConflict: 'member_id' },
    )
  } catch { /* before migration 0068 the link still works, it just cannot be turned off */ }
  return { url: `${base}/api/mcp/${encodeURIComponent(token)}`, days: Math.round(MIRROR_TOKEN_TTL_S / 86400) }
}

export interface AssistantLinkState {
  connected: boolean
  issuedAt: string | null
  lastUsedAt: string | null
  uses: number
  /** The link is not shown again — she copies it when she makes it. */
  needsMigration?: boolean
}

/** Whether she has a link, and whether anything has used it. */
export async function myAssistantLinkState(asMemberId?: string): Promise<AssistantLinkState> {
  const me = await resolveClientMember(asMemberId)
  const none = { connected: false, issuedAt: null, lastUsedAt: null, uses: 0 }
  if (!me) return none
  const admin = createAdminClient() as any
  try {
    const { data, error } = await admin.from('member_assistant_link')
      .select('issued_at, last_used_at, uses').eq('member_id', me.memberId).maybeSingle()
    if (error) return { ...none, needsMigration: /member_assistant_link/.test(error.message) }
    if (!data) return none
    return { connected: true, issuedAt: data.issued_at, lastUsedAt: data.last_used_at ?? null, uses: data.uses ?? 0 }
  } catch {
    return { ...none, needsMigration: true }
  }
}

/** Turn the link off: whatever holds it stops being able to ask. */
export async function revokeMyAssistantLink(asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const admin = createAdminClient() as any
  const { error } = await admin.from('member_assistant_link').delete().eq('member_id', me.memberId)
  return error ? { error: error.message } : {}
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
  // What MYRA knows about her has changed: the brief is rebuilt next time it is read.
  forgetMemberMemory(me.memberId)
  return error ? { error: error.message } : {}
}
