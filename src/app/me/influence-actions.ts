'use server'

// WHOSE STYLE DO YOU LOVE — a member taps the people who inspire her. The
// member is resolved on the server (her session, or the member Chloe names from
// HER VIEW, honoured for the admin only); a browser-supplied id from anyone
// else resolves to nobody.

import { revalidatePath } from 'next/cache'
import { resolveClientMember } from '@/lib/client-member'
import { createAdminClient } from '@/lib/supabase-server'
import { forgetMemberMemory } from '@/lib/member-memory'
import { normaliseInfluence } from '@/lib/style-influence-store'

export interface InfluencePickerView {
  people: { id: string; name: string; image_url: string | null; summary: string }[]
  chosen: string[]
  error?: string
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
  // Everyone live, plus anyone Chloe linked her to while they are still a draft.
  const byId = new Map<string, any>()
  for (const r of (live ?? []) as any[]) byId.set(r.influence_id, r)
  for (const r of (mine ?? []) as any[]) if (r.influence) byId.set(r.influence_id, r.influence)
  return {
    people: Array.from(byId.values()).map(normaliseInfluence)
      .map((p) => ({ id: p.influence_id, name: p.name, image_url: p.image_url, summary: p.brief.summary })),
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
    const { error } = await admin.from('member_style_influence')
      .upsert({ member_id: me.memberId, influence_id: influenceId, source: 'member' }, { onConflict: 'member_id,influence_id', ignoreDuplicates: true })
    if (error) return { error: error.message }
  } else {
    const { error } = await admin.from('member_style_influence').delete().eq('member_id', me.memberId).eq('influence_id', influenceId)
    if (error) return { error: error.message }
  }
  forgetMemberMemory(me.memberId)
  revalidatePath('/me/profile')
  return { ok: true }
}
