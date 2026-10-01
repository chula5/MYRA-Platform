// Context resolution for the Outfit Quality Lab — real members vs evaluation
// profiles are different entities, loaded from different sources.
//
// A batch/case has EXACTLY ONE context: a non-synthetic real `pilot_member`, or
// an `outfit_quality_evaluation_profile`. These never collapse:
//
//   * Evaluation profiles live outside `pilot_member`. They cannot own member
//     feedback and cannot resolve a member session. A profile id resolved as a
//     member fails closed (returns null), and vice versa.
//   * Legacy synthetic `pilot_member.is_synthetic = true` rows are NOT selectable
//     as a real-member context.
//   * Chloe, Alison and Devika resolve by three configured, pairwise-distinct,
//     immutable, non-synthetic member ids. Member Chloe and stylist Chloe are
//     independent identities with different ids.

import { REAL_MEMBER_IDS, REAL_MEMBER_ID_LIST, CHLOE_STYLIST_ID } from '@/lib/outfit-quality/identities'

export type ContextType = 'real_member' | 'evaluation_profile'

export interface RealMemberContext {
  type: 'real_member'
  member_id: string
  name: string
  /** Explicit preferences are stronger context overrides — never member feedback. */
  size_profile?: unknown
  preferences?: unknown
}

export interface EvaluationProfileContext {
  type: 'evaluation_profile'
  profile_id: string
  slug: string
  name: string
  style_families: string[]
  brand_groups: string[]
  budget_profile: unknown
  size_profile: unknown
  occasions: string[]
  preferences: unknown
}

export type ResolvedContext = RealMemberContext | EvaluationProfileContext

export type ContextResolveError =
  | 'no_context'
  | 'both_contexts'
  | 'member_not_selectable'
  | 'profile_not_found'

export type ContextResolveResult =
  | { ok: true; context: ResolvedContext }
  | { ok: false; code: ContextResolveError; message: string }

// ── Pure identity invariants ─────────────────────────────────────────────────

/** Every configured real-member id is distinct from the others. */
export function configuredMemberIdsArePairwiseDistinct(): boolean {
  const ids = REAL_MEMBER_ID_LIST
  return new Set(ids).size === ids.length
}

/** Member Chloe and stylist Chloe are independent identities. */
export function memberChloeIsNotStylistChloe(): boolean {
  return (REAL_MEMBER_IDS.chloe as string) !== (CHLOE_STYLIST_ID as string)
}

export function isConfiguredRealMember(id: string): boolean {
  return (REAL_MEMBER_ID_LIST as readonly string[]).includes(id)
}

// ── Repositories (loaded from separate sources) ───────────────────────────────

export interface RealMemberRow {
  member_id: string
  name: string
  is_synthetic: boolean
  size_profile?: unknown
  preferences?: unknown
}

export interface EvaluationProfileRow {
  profile_id: string
  slug: string
  name: string
  active: boolean
  style_families: string[]
  brand_groups: string[]
  budget_profile: unknown
  size_profile: unknown
  occasions: string[]
  preferences: unknown
}

/** Real members come from `pilot_member`; synthetic rows are excluded. */
export interface RealMemberRepository {
  listSelectable(): Promise<RealMemberRow[]>
  getById(memberId: string): Promise<RealMemberRow | null>
}

/** Evaluation profiles come from a dedicated table — never `pilot_member`. */
export interface EvaluationProfileRepository {
  listActive(): Promise<EvaluationProfileRow[]>
  getById(profileId: string): Promise<EvaluationProfileRow | null>
}

export interface ContextInput {
  realMemberId?: string | null
  evaluationProfileId?: string | null
}

/**
 * Resolve exactly one context from the correct repository. A real-member id is
 * resolved only against the member repository (and must be non-synthetic); a
 * profile id only against the profile repository. Cross-resolution is
 * impossible: a profile id passed as a member will not be found as a member.
 */
export async function resolveContext(
  input: ContextInput,
  repos: { members: RealMemberRepository; profiles: EvaluationProfileRepository },
): Promise<ContextResolveResult> {
  const hasMember = !!input.realMemberId
  const hasProfile = !!input.evaluationProfileId
  if (hasMember && hasProfile) {
    return { ok: false, code: 'both_contexts', message: 'exactly one context is required; both were supplied' }
  }
  if (!hasMember && !hasProfile) {
    return { ok: false, code: 'no_context', message: 'exactly one context is required; neither was supplied' }
  }

  if (hasMember) {
    const row = await repos.members.getById(input.realMemberId as string)
    // A missing row, or a synthetic row, is not a selectable real-member context.
    if (!row || row.is_synthetic) {
      return { ok: false, code: 'member_not_selectable', message: 'the member is not a selectable non-synthetic real member' }
    }
    return {
      ok: true,
      context: { type: 'real_member', member_id: row.member_id, name: row.name, size_profile: row.size_profile, preferences: row.preferences },
    }
  }

  const profile = await repos.profiles.getById(input.evaluationProfileId as string)
  if (!profile) {
    return { ok: false, code: 'profile_not_found', message: 'the evaluation profile was not found' }
  }
  return {
    ok: true,
    context: {
      type: 'evaluation_profile',
      profile_id: profile.profile_id,
      slug: profile.slug,
      name: profile.name,
      style_families: profile.style_families,
      brand_groups: profile.brand_groups,
      budget_profile: profile.budget_profile,
      size_profile: profile.size_profile,
      occasions: profile.occasions,
      preferences: profile.preferences,
    },
  }
}

/**
 * The frozen context snapshot stored on each candidate version. Real-member
 * preferences are included as application context (stronger overrides), never as
 * member behavioural feedback.
 */
export function toContextSnapshot(context: ResolvedContext): Record<string, unknown> {
  if (context.type === 'real_member') {
    return {
      type: 'real_member',
      member_id: context.member_id,
      size_profile: context.size_profile ?? null,
      preferences: context.preferences ?? null,
    }
  }
  return {
    type: 'evaluation_profile',
    profile_id: context.profile_id,
    slug: context.slug,
    style_families: context.style_families,
    brand_groups: context.brand_groups,
    budget_profile: context.budget_profile,
    size_profile: context.size_profile,
    occasions: context.occasions,
    preferences: context.preferences,
  }
}
