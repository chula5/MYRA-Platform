// A house style's profile — where lessons learned on that style are kept.
//
// A persona (a `stylist` row of type 'persona', e.g. SCandi-Mum) is the house
// style a client is assigned. Promoted style rules (`learned_rule`, scope
// 'style') are keyed to a `style_profile`, and a client's lessons can only reach
// the style when she is linked to one. Nothing created the profile or the link,
// so every lesson stayed "just her". This makes both exist.
import 'server-only'

/** The profile for a house style, created on first use. Null if it cannot be made. */
export async function ensureStyleProfileForPersona(admin: any, personaId: string): Promise<string | null> {
  const { data: existing } = await admin.from('style_profile')
    .select('profile_id').eq('moodboard_persona_id', personaId).maybeSingle()
  if (existing?.profile_id) return existing.profile_id as string

  const { data: persona } = await admin.from('stylist')
    .select('name, centroid, envelope, vector_range').eq('stylist_id', personaId).maybeSingle()
  if (!persona) return null
  // Profiles sit under the stylist who owns the style — Chloe.
  const { data: owner } = await admin.from('stylist').select('stylist_id').eq('slug', 'chloe').maybeSingle()
  if (!owner?.stylist_id) return null

  const { data: created, error } = await admin.from('style_profile').insert({
    stylist_id: owner.stylist_id,
    name: persona.name,
    moodboard_persona_id: personaId,
    vector: persona.centroid ?? null,
    envelope: persona.envelope ?? persona.vector_range ?? null,
  }).select('profile_id').single()
  if (error) {
    console.error('[ensureStyleProfileForPersona]', error.message)
    return null
  }
  return created.profile_id as string
}

/** Link a member to her house style's profile, so her lessons can reach the style. */
export async function linkMemberToStyleProfile(admin: any, memberId: string, personaId: string | null): Promise<string | null> {
  const profileId = personaId ? await ensureStyleProfileForPersona(admin, personaId) : null
  await admin.from('pilot_member').update({ style_profile_id: profileId }).eq('member_id', memberId)
  return profileId
}
