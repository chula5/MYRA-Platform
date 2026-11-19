'use server'

// WHOSE STYLE DO YOU LOVE — a member taps the people, and the brands' house
// styles, that inspire her. The member is resolved on the server (her session,
// or the member Chloe names from HER VIEW, honoured for the admin only); a
// browser-supplied id from anyone else resolves to nobody.
//
// Two shelves behind one dropdown: PEOPLE (celebrity / influencer / muse) and
// HOUSE STYLES (kind 'house' — a brand as a reference, "I love ME+EM"). Anyone
// Chloe has made live can be tapped; a name that isn't there yet can be typed:
// it is saved as a draft linked to her, and Chloe fills in the brief and
// pictures on /admin/influences.

import { revalidatePath } from 'next/cache'
import { resolveClientMember } from '@/lib/client-member'
import { createAdminClient } from '@/lib/supabase-server'
import { forgetMemberMemory } from '@/lib/member-memory'
import { normaliseInfluence } from '@/lib/style-influence-store'
import { slugify } from '@/lib/style-influence'

export type InfluenceShelf = 'people' | 'houses'

export interface InfluencePickerPerson {
  id: string
  name: string
  shelf: InfluenceShelf
  image_url: string | null
  /** A house with no picture yet shows its brand's logo. */
  logo_url: string | null
  summary: string
  /** Typed by her and not yet written up by Chloe. */
  pending: boolean
}

export interface InfluencePickerView {
  people: InfluencePickerPerson[]
  chosen: string[]
  error?: string
}

/** How many she can hold — enough to say who she is, not a scrapbook. */
const MAX_CHOSEN = 12

const shelfOf = (kind: string): InfluenceShelf => (kind === 'house' ? 'houses' : 'people')

async function brandLogos(admin: any, names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!names.length) return out
  const { data } = await admin.from('brand').select('name, logo_url').in('name', names).not('logo_url', 'is', null)
  for (const b of (data ?? []) as any[]) out.set(String(b.name).toLowerCase(), b.logo_url)
  return out
}

function toPerson(p: ReturnType<typeof normaliseInfluence>, logos: Map<string, string>): InfluencePickerPerson {
  return {
    id: p.influence_id,
    name: p.name,
    shelf: shelfOf(p.kind),
    image_url: p.image_url,
    logo_url: p.kind === 'house' ? logos.get(p.name.toLowerCase()) ?? null : null,
    summary: p.brief.summary,
    pending: p.status !== 'live',
  }
}

async function chosenCount(admin: any, memberId: string): Promise<number> {
  const { count } = await admin.from('member_style_influence').select('influence_id', { count: 'exact', head: true }).eq('member_id', memberId)
  return count ?? 0
}

export async function loadMyInfluences(asMemberId?: string): Promise<InfluencePickerView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { people: [], chosen: [], error: 'Not signed in' }
  const admin = createAdminClient() as any
  const [{ data: live, error }, { data: mine }] = await Promise.all([
    admin.from('style_influence').select('*').eq('status', 'live').order('name', { ascending: true }),
    admin.from('member_style_influence').select('influence_id, influence:influence_id(*)').eq('member_id', me.memberId),
  ])
  if (error) return { people: [], chosen: [] }
  // Everyone live, plus anyone linked to her while they are still a draft.
  const byId = new Map<string, any>()
  for (const r of (live ?? []) as any[]) byId.set(r.influence_id, r)
  for (const r of (mine ?? []) as any[]) if (r.influence) byId.set(r.influence_id, r.influence)
  const rows = Array.from(byId.values()).map(normaliseInfluence)
  const logos = await brandLogos(admin, rows.filter((p) => p.kind === 'house' && !p.image_url).map((p) => p.name))
  return {
    people: rows.map((p) => toPerson(p, logos)).sort((a, b) => a.name.localeCompare(b.name)),
    chosen: ((mine ?? []) as any[]).map((r) => r.influence_id),
  }
}

export async function setMyInfluence(influenceId: string, on: boolean, asMemberId?: string): Promise<{ ok?: true; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const admin = createAdminClient() as any
  if (on) {
    // Only a live person (or one already hers) can be chosen from the browser.
    const { data: person } = await admin.from('style_influence').select('status').eq('influence_id', influenceId).maybeSingle()
    if (!person || person.status !== 'live') return { error: 'Not available' }
    if ((await chosenCount(admin, me.memberId)) >= MAX_CHOSEN) return { error: `Up to ${MAX_CHOSEN} — take one off first` }
    const { error } = await admin.from('member_style_influence')
      .upsert({ member_id: me.memberId, influence_id: influenceId, source: 'member' }, { onConflict: 'member_id,influence_id', ignoreDuplicates: true })
    if (error) return { error: 'Could not save that — try again' }
  } else {
    const { error } = await admin.from('member_style_influence').delete().eq('member_id', me.memberId).eq('influence_id', influenceId)
    if (error) return { error: 'Could not save that — try again' }
  }
  forgetMemberMemory(me.memberId)
  revalidatePath('/me/profile')
  return { ok: true }
}

/**
 * She types a name that isn't on the shelf. If MYRA already knows it (same
 * slug, live or draft) it is linked; otherwise a draft is made — a house for
 * HOUSE STYLES, a person for PEOPLE (an @handle reads as an influencer) — and
 * linked to her. A draft has no brief or pictures, so it pulls nothing in the
 * composer until Chloe writes it up; the name still reaches her look check.
 */
export async function addMyInfluence(rawName: string, shelf: InfluenceShelf, asMemberId?: string): Promise<{ person?: InfluencePickerPerson; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const typed = rawName.replace(/\s+/g, ' ').trim()
  if (typed.length < 2) return { error: 'Type a name first' }
  if (typed.length > 60) return { error: 'That name is too long' }
  const isHandle = typed.startsWith('@')
  const name = isHandle ? typed : typed.replace(/(^|\s)(\p{Ll})/gu, (_m, s, c) => s + c.toUpperCase())
  const slug = slugify(name)
  const admin = createAdminClient() as any

  if ((await chosenCount(admin, me.memberId)) >= MAX_CHOSEN) return { error: `Up to ${MAX_CHOSEN} — take one off first` }

  let { data: row } = await admin.from('style_influence').select('*').eq('slug', slug).maybeSingle()
  if (!row) {
    const kind = shelf === 'houses' ? 'house' : isHandle ? 'influencer' : 'celebrity'
    const { data, error } = await admin.from('style_influence')
      .insert({ name, slug, kind, handle: isHandle ? typed : null, status: 'draft' })
      .select('*').single()
    if (error) return { error: 'Could not save that — try again' }
    row = data
  }
  const { error } = await admin.from('member_style_influence')
    .upsert({ member_id: me.memberId, influence_id: row.influence_id, source: 'member' }, { onConflict: 'member_id,influence_id', ignoreDuplicates: true })
  if (error) return { error: 'Could not save that — try again' }
  forgetMemberMemory(me.memberId)
  revalidatePath('/me/profile')

  const p = normaliseInfluence(row)
  const logos = p.kind === 'house' && !p.image_url ? await brandLogos(admin, [p.name]) : new Map<string, string>()
  return { person: toPerson(p, logos) }
}
