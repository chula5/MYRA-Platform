'use server'

// WHAT A HOUSE STYLE HAS LEARNED — every source of a style's knowledge, read
// straight from where it is stored, so the panel can never claim more than the
// database holds.

import { createAdminClient, createServerClient } from '@/lib/supabase-server'
import { rulesForMember, GLOBAL_RULE_CODES } from '@/lib/style-rules'
import { CONSTITUTION_RULES } from '@/lib/house-style'

export interface StyleLearning {
  name: string
  status: string
  images: { confirmed: number; awaitingReview: number; pending: number; rejected: number }
  envelope: { images: number; tightness: number | null; computedAt: string | null } | null
  brain: { decisions: number; approves: number; skips: number; updatedAt: string | null }
  rules: { label: string; occurrences: number }[]
  enforced: { rules: number; families: string[] }
  clients: { name: string; weight: number | null; referencePictures: number }[]
  error?: string
}

export async function loadStyleLearning(personaId: string): Promise<StyleLearning | { error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) return { error: 'Not authorised' }

  try {
    const admin = createAdminClient() as any
    const { data: s } = await admin.from('stylist')
      .select('name, status, constitution, envelope, envelope_computed_at').eq('stylist_id', personaId).single()
    if (!s) return { error: 'Style not found' }

    const [{ data: imgs }, { data: model }, { data: profile }, { data: assigned }] = await Promise.all([
      admin.from('inspiration_image').select('status').eq('persona_id', personaId).is('user_id', null),
      admin.from('stylist_model').select('model, decisions, updated_at').eq('stylist_id', personaId).maybeSingle(),
      admin.from('style_profile').select('profile_id').eq('moodboard_persona_id', personaId).maybeSingle(),
      admin.from('user_persona').select('user_id, weight').eq('persona_id', personaId).eq('subject_kind', 'pilot_member'),
    ])

    const count = (st: string) => ((imgs ?? []) as any[]).filter((r) => r.status === st).length

    const { data: ruleRows } = profile?.profile_id
      ? await admin.from('learned_rule').select('pattern_label, occurrences')
          .eq('active', true).eq('scope', 'style').eq('profile_id', profile.profile_id).order('occurrences', { ascending: false })
      : { data: [] }

    const memberIds = ((assigned ?? []) as any[]).map((a) => a.user_id)
    const [{ data: members }, { data: refs }] = memberIds.length
      ? await Promise.all([
          admin.from('pilot_member').select('member_id, name, auth_user_id').in('member_id', memberIds),
          admin.from('inspiration_image').select('user_id').eq('persona_id', personaId).not('user_id', 'is', null).neq('status', 'rejected'),
        ])
      : [{ data: [] }, { data: [] }]

    const rules = rulesForMember({ name: s.name, constitution: s.constitution }, false)
    const styleCodes = Array.from(rules.codes).filter((c) => !GLOBAL_RULE_CODES.has(c))
    const families = Array.from(new Set(CONSTITUTION_RULES.filter((r) => styleCodes.includes(r.code)).map((r) => r.family)))

    return {
      name: s.name,
      status: s.status,
      images: { confirmed: count('confirmed'), awaitingReview: count('scored'), pending: count('pending_scoring'), rejected: count('rejected') },
      envelope: s.envelope?.mean?.length
        ? { images: s.envelope.n ?? 0, tightness: s.envelope.tightness ?? null, computedAt: s.envelope_computed_at ?? null }
        : null,
      brain: {
        decisions: Math.round(model?.decisions ?? 0),
        approves: Math.round(model?.model?.approves ?? 0),
        skips: Math.round(model?.model?.skips ?? 0),
        updatedAt: model?.updated_at ?? null,
      },
      rules: ((ruleRows ?? []) as any[]).map((r) => ({ label: r.pattern_label, occurrences: r.occurrences })),
      enforced: { rules: styleCodes.length, families },
      clients: ((members ?? []) as any[]).map((m) => ({
        name: m.name,
        weight: ((assigned ?? []) as any[]).find((a) => a.user_id === m.member_id)?.weight ?? null,
        referencePictures: ((refs ?? []) as any[]).filter((r) => r.user_id === m.member_id || (m.auth_user_id && r.user_id === m.auth_user_id)).length,
      })),
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not read what the style has learned' }
  }
}
