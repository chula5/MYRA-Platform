import { describe, it, expect } from 'vitest'
import {
  buildPreDecisionCandidate,
  findProtectedLeaks,
  PROTECTED_SUBJECTIVE_FIELDS,
  type BuildPreDecisionInput, objectiveFailureLines } from '@/lib/outfit-quality/queue-read-model'

function input(overrides: Partial<BuildPreDecisionInput> = {}): BuildPreDecisionInput {
  return {
    candidate_version_id: 'cv-1',
    case_id: 'case-1',
    version_no: 1,
    state: 'awaiting_human',
    rules_only: true,
    real_member_id: null,
    evaluation_profile_id: 'prof-1',
    selected_stylist_id: 'sty-1',
    subjectiveChecks: [
      {
        check_id: 'chk-1',
        kind: 'subjective',
        status: 'failed',
        verdict: 'reject',
        score: 0.2,
        issues: { colour: 'clash' },
        reasons: ['too busy'],
        model: 'claude-opus-5',
        prompt_version: 'quality-lab-subjective-v1',
        raw_response_hash: 'abc123',
      },
    ],
    items: [
      { candidate_item_id: 'ci-2', item_id: 'i2', slot: 'bottom', sort_order: 1, source_image_url: 'https://cdn/b.jpg', item_snapshot: { item_type: 'trousers', brand: 'Toteme' } },
      { candidate_item_id: 'ci-1', item_id: 'i1', slot: 'top', sort_order: 0, source_image_url: 'https://cdn/t.jpg', item_snapshot: { item_type: 'shirt', brand: 'Arket' } },
    ],
    ...overrides,
  }
}

describe('buildPreDecisionCandidate', () => {
  it('discloses that a subjective check exists but omits every protected field', () => {
    const payload = buildPreDecisionCandidate(input())
    expect(payload.has_subjective_check).toBe(true)
    const leaks = findProtectedLeaks(payload)
    expect(leaks).toEqual([])
    // Spot check the raw fields are truly gone from the serialised payload.
    const json = JSON.stringify(payload)
    for (const f of ['reject', '0.2', 'abc123', 'too busy']) {
      expect(json).not.toContain(f)
    }
  })

  it('reports rules_only and context type, and orders items by sort_order', () => {
    const payload = buildPreDecisionCandidate(input())
    expect(payload.rules_only).toBe(true)
    expect(payload.context_type).toBe('evaluation_profile')
    expect(payload.items.map((i) => i.slot)).toEqual(['top', 'bottom'])
  })

  it('marks a real-member context distinctly', () => {
    const payload = buildPreDecisionCandidate(input({ real_member_id: 'mem-1', evaluation_profile_id: null }))
    expect(payload.context_type).toBe('real_member')
  })

  it('has_subjective_check is false when no subjective check exists yet', () => {
    const payload = buildPreDecisionCandidate(input({ subjectiveChecks: [] }))
    expect(payload.has_subjective_check).toBe(false)
  })
})

describe('findProtectedLeaks', () => {
  it('detects a protected field injected at any depth', () => {
    const bad = { a: { b: { verdict: 'reject' } }, list: [{ score: 1 }] }
    const leaks = findProtectedLeaks(bad)
    expect(leaks).toContain('$.a.b.verdict')
    expect(leaks).toContain('$.list[0].score')
  })
  it('covers the documented protected field set', () => {
    expect(PROTECTED_SUBJECTIVE_FIELDS).toContain('verdict')
    expect(PROTECTED_SUBJECTIVE_FIELDS).toContain('raw_response_hash')
    expect(PROTECTED_SUBJECTIVE_FIELDS).toContain('agreement')
  })
})

describe('objectiveFailureLines', () => {
  const items = [
    { candidate_item_id: 'ci-1', item_id: 'i-1', slot: 'top', sort_order: 0, source_image_url: 'x', item_snapshot: { brand: 'Sézane' } },
    { candidate_item_id: 'ci-2', item_id: 'i-2', slot: 'bottom', sort_order: 1, source_image_url: 'x', item_snapshot: { brand: 'Antik Batik' } },
    { candidate_item_id: 'ci-3', item_id: 'i-3', slot: 'bag', sort_order: 2, source_image_url: 'x', item_snapshot: { brand: 'DeMellier' } },
  ]

  it('says which pieces could not be confirmed in her size', () => {
    const lines = objectiveFailureLines(
      [{ check_name: 'size_possibility', status: 'unavailable', detail: { unconfirmed: ['i-1', 'i-2'], not_applicable: ['i-3'] } }],
      items,
    )
    expect(lines).toEqual(['SIZE UNCONFIRMED · Sézane, Antik Batik'])
  })

  it('names a sold-out size and an unsellable piece, and skips passed checks', () => {
    const lines = objectiveFailureLines(
      [
        { check_name: 'valid_structure', status: 'passed' },
        { check_name: 'size_possibility', status: 'failed', detail: { not_in_size: ['i-2'] } },
        { check_name: 'sellable_stock', status: 'failed', detail: { not_sellable: ['i-3'] } },
      ],
      items,
    )
    expect(lines).toEqual(['NOT IN HER SIZE · Antik Batik', 'NOT SELLABLE · DeMellier'])
  })

  it('carries no protected field onto the candidate', () => {
    const payload = buildPreDecisionCandidate({
      candidate_version_id: 'v', case_id: 'c', version_no: 1, state: 'objective_failed', rules_only: false,
      real_member_id: 'm', evaluation_profile_id: null, selected_stylist_id: 's',
      subjectiveChecks: [],
      objectiveChecks: [{ check_name: 'size_possibility', status: 'unavailable', detail: { unconfirmed: ['i-1'] } }],
      items,
    })
    expect(payload.objective_failures).toEqual(['SIZE UNCONFIRMED · Sézane'])
    expect(findProtectedLeaks(payload)).toEqual([])
  })
})
