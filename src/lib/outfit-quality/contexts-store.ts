// Server-only context repositories for the Outfit Quality Lab.
//
// Real members load from `pilot_member` (synthetic rows excluded); evaluation
// profiles load from the dedicated `outfit_quality_evaluation_profile` table.
// These are deliberately different sources: an evaluation profile is never a
// member and can never resolve a member session.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import {
  type RealMemberRepository,
  type EvaluationProfileRepository,
  type RealMemberRow,
  type EvaluationProfileRow,
} from '@/lib/outfit-quality/contexts'

type Admin = ReturnType<typeof createAdminClient>

export function createSupabaseRealMemberRepository(admin: Admin = createAdminClient()): RealMemberRepository {
  const db = admin as any
  return {
    async listSelectable(): Promise<RealMemberRow[]> {
      // Synthetic rows are legacy plumbing — never selectable as a real context.
      const { data } = await db
        .from('pilot_member')
        .select('member_id, name, is_synthetic, brands')
        .eq('is_synthetic', false)
        .order('name')
      return ((data ?? []) as any[]).map((r) => ({
        member_id: r.member_id,
        name: r.name,
        is_synthetic: !!r.is_synthetic,
        preferences: { brands: r.brands ?? [] },
      }))
    },
    async getById(memberId: string): Promise<RealMemberRow | null> {
      const { data } = await db
        .from('pilot_member')
        .select('member_id, name, is_synthetic, brands')
        .eq('member_id', memberId)
        .maybeSingle()
      if (!data) return null
      return {
        member_id: data.member_id,
        name: data.name,
        is_synthetic: !!data.is_synthetic,
        preferences: { brands: data.brands ?? [] },
      }
    },
  }
}

export function createSupabaseEvaluationProfileRepository(admin: Admin = createAdminClient()): EvaluationProfileRepository {
  const db = admin as any
  const cols = 'profile_id, slug, name, active, style_families, brand_groups, budget_profile, size_profile, occasions, preferences'
  const toRow = (r: any): EvaluationProfileRow => ({
    profile_id: r.profile_id,
    slug: r.slug,
    name: r.name,
    active: !!r.active,
    style_families: r.style_families ?? [],
    brand_groups: r.brand_groups ?? [],
    budget_profile: r.budget_profile ?? {},
    size_profile: r.size_profile ?? {},
    occasions: r.occasions ?? [],
    preferences: r.preferences ?? {},
  })
  return {
    async listActive(): Promise<EvaluationProfileRow[]> {
      const { data } = await db
        .from('outfit_quality_evaluation_profile')
        .select(cols)
        .eq('active', true)
        .is('retired_at', null)
        .order('name')
      return ((data ?? []) as any[]).map(toRow)
    },
    async getById(profileId: string): Promise<EvaluationProfileRow | null> {
      const { data } = await db
        .from('outfit_quality_evaluation_profile')
        .select(cols)
        .eq('profile_id', profileId)
        .maybeSingle()
      return data ? toRow(data) : null
    },
  }
}
