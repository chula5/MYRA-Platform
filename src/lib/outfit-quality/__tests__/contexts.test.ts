import { describe, it, expect, vi } from 'vitest'
import {
  resolveContext,
  toContextSnapshot,
  configuredMemberIdsArePairwiseDistinct,
  memberChloeIsNotStylistChloe,
  isConfiguredRealMember,
  type RealMemberRepository,
  type EvaluationProfileRepository,
  type RealMemberRow,
  type EvaluationProfileRow,
} from '@/lib/outfit-quality/contexts'
import { REAL_MEMBER_IDS, CHLOE_STYLIST_ID } from '@/lib/outfit-quality/identities'

const MEMBER = REAL_MEMBER_IDS.alison
const SYNTH_MEMBER = 'ffffffff-0000-4000-8000-00000000000f'
const PROFILE = '11111111-1111-1111-1111-111111111111'

function memberRepo(rows: RealMemberRow[]): RealMemberRepository {
  return {
    listSelectable: vi.fn(async () => rows.filter((r) => !r.is_synthetic)),
    getById: vi.fn(async (id: string) => rows.find((r) => r.member_id === id) ?? null),
  }
}

function profileRepo(rows: EvaluationProfileRow[]): EvaluationProfileRepository {
  return {
    listActive: vi.fn(async () => rows.filter((r) => r.active)),
    getById: vi.fn(async (id: string) => rows.find((r) => r.profile_id === id) ?? null),
  }
}

const profileRow: EvaluationProfileRow = {
  profile_id: PROFILE, slug: 'scandi-minimal', name: 'Scandi Minimal', active: true,
  style_families: ['scandi'], brand_groups: ['contemporary'], budget_profile: { tier: 'mid' },
  size_profile: { uk: 10 }, occasions: ['work'], preferences: { avoid: ['neon'] },
}

const members: RealMemberRow[] = [
  { member_id: REAL_MEMBER_IDS.chloe, name: 'Chloe', is_synthetic: false },
  { member_id: REAL_MEMBER_IDS.alison, name: 'Alison', is_synthetic: false, preferences: { loves: ['wide-leg'] }, size_profile: { uk: 8 } },
  { member_id: REAL_MEMBER_IDS.devika, name: 'Devika', is_synthetic: false },
  { member_id: SYNTH_MEMBER, name: 'Synthetic Persona', is_synthetic: true },
]

describe('configured identities (VAL-DATA-002)', () => {
  it('the three configured member ids are pairwise distinct', () => {
    expect(configuredMemberIdsArePairwiseDistinct()).toBe(true)
    expect(new Set([REAL_MEMBER_IDS.chloe, REAL_MEMBER_IDS.alison, REAL_MEMBER_IDS.devika]).size).toBe(3)
  })
  it('member Chloe is a different identity from stylist Chloe', () => {
    expect(memberChloeIsNotStylistChloe()).toBe(true)
    expect(REAL_MEMBER_IDS.chloe).not.toBe(CHLOE_STYLIST_ID)
  })
  it('recognises each configured real member', () => {
    expect(isConfiguredRealMember(REAL_MEMBER_IDS.devika)).toBe(true)
    expect(isConfiguredRealMember(PROFILE)).toBe(false)
  })
})

describe('separate selector sources', () => {
  it('real-member listing excludes synthetic members', async () => {
    const repo = memberRepo(members)
    const list = await repo.listSelectable()
    expect(list.map((m) => m.member_id)).not.toContain(SYNTH_MEMBER)
    expect(list).toHaveLength(3)
  })
  it('profiles come from the profile repository, not the member repository', async () => {
    const repo = profileRepo([profileRow])
    const list = await repo.listActive()
    expect(list[0].profile_id).toBe(PROFILE)
  })
})

describe('resolveContext — exactly one context from the right source', () => {
  const repos = { members: memberRepo(members), profiles: profileRepo([profileRow]) }

  it('resolves a real member', async () => {
    const r = await resolveContext({ realMemberId: MEMBER }, repos)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.context.type).toBe('real_member')
  })
  it('resolves an evaluation profile', async () => {
    const r = await resolveContext({ evaluationProfileId: PROFILE }, repos)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.context.type).toBe('evaluation_profile')
  })
  it('rejects both or neither context', async () => {
    expect(await resolveContext({ realMemberId: MEMBER, evaluationProfileId: PROFILE }, repos)).toMatchObject({ ok: false, code: 'both_contexts' })
    expect(await resolveContext({}, repos)).toMatchObject({ ok: false, code: 'no_context' })
  })
  it('refuses a synthetic member as a real-member context', async () => {
    const r = await resolveContext({ realMemberId: SYNTH_MEMBER }, repos)
    expect(r).toMatchObject({ ok: false, code: 'member_not_selectable' })
  })
  it('a profile id does not resolve as a member (no cross-resolution)', async () => {
    const fresh = { members: memberRepo(members), profiles: profileRepo([profileRow]) }
    const r = await resolveContext({ realMemberId: PROFILE }, fresh)
    expect(r).toMatchObject({ ok: false, code: 'member_not_selectable' })
    // A real-member resolution never touches the profile repository.
    expect(fresh.profiles.getById).not.toHaveBeenCalled()
  })
  it('a member id does not resolve as a profile', async () => {
    const r = await resolveContext({ evaluationProfileId: MEMBER }, repos)
    expect(r).toMatchObject({ ok: false, code: 'profile_not_found' })
  })
})

describe('resolveContext — only active, non-retired profiles resolve', () => {
  const INACTIVE = '22222222-2222-2222-2222-222222222222'
  const RETIRED = '33333333-3333-3333-3333-333333333333'
  const rows: EvaluationProfileRow[] = [
    profileRow,
    { ...profileRow, profile_id: INACTIVE, slug: 'inactive', active: false },
    { ...profileRow, profile_id: RETIRED, slug: 'retired', active: true, retired_at: '2026-01-01T00:00:00Z' },
  ]
  // The repository can still find the row by a forged id — resolution must be
  // what refuses it, so a client forging the id gains nothing.
  const repos = { members: memberRepo(members), profiles: profileRepo(rows) }

  it('refuses an inactive profile even when its id is forged', async () => {
    const r = await resolveContext({ evaluationProfileId: INACTIVE }, repos)
    expect(r).toMatchObject({ ok: false, code: 'profile_not_active' })
  })
  it('refuses a retired profile', async () => {
    const r = await resolveContext({ evaluationProfileId: RETIRED }, repos)
    expect(r).toMatchObject({ ok: false, code: 'profile_not_active' })
  })
  it('still resolves a live profile', async () => {
    const r = await resolveContext({ evaluationProfileId: PROFILE }, repos)
    expect(r.ok).toBe(true)
  })
})

describe('toContextSnapshot', () => {
  it('carries real-member preferences as context only (member_id, no feedback)', async () => {
    const r = await resolveContext({ realMemberId: MEMBER }, { members: memberRepo(members), profiles: profileRepo([profileRow]) })
    if (!r.ok) throw new Error('expected ok')
    const snap = toContextSnapshot(r.context)
    expect(snap.type).toBe('real_member')
    expect(snap.member_id).toBe(MEMBER)
    expect(snap.preferences).toEqual({ loves: ['wide-leg'] })
    // No taste-event / feedback shape leaks into the context snapshot.
    expect(snap).not.toHaveProperty('taste_events')
  })
  it('carries evaluation-profile style/brand/budget/size/occasion context', async () => {
    const snap = toContextSnapshot({
      type: 'evaluation_profile', profile_id: PROFILE, slug: 'scandi-minimal', name: 'Scandi Minimal',
      style_families: ['scandi'], brand_groups: ['contemporary'], budget_profile: { tier: 'mid' },
      size_profile: { uk: 10 }, occasions: ['work'], preferences: {},
    })
    expect(snap.type).toBe('evaluation_profile')
    expect(snap.style_families).toEqual(['scandi'])
    expect(snap.occasions).toEqual(['work'])
  })
})
