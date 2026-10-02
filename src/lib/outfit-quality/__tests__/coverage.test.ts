// VAL-METRIC-001/002 — Coverage reporting: every approved measure and
// dimension, labeled partitions and context types, release-denominator
// exclusions, sparse/zero warnings, and manual-only programme guidance.
//
// All partition semantics here (training/validation/holdout/synthetic) are
// hypothetical deterministic fixtures; connected suites use only `test` rows.

import { describe, it, expect } from 'vitest'
import {
  buildCoverageReport,
  PROGRAMME_GUIDANCE,
  SPARSE_SAMPLE_THRESHOLD,
  type CoverageInput,
} from '@/lib/outfit-quality/coverage'

const STYLIST_X = '11111111-2222-4333-8444-555555555555'
const STYLIST_Y = '66666666-7777-4888-8999-000000000000'
const MEMBER_A = 'df918c45-3063-484e-b83b-dc41d25ac804'
const PROFILE_P = '22222222-3333-4444-8555-666666666666'

let n = 0
function id(prefix: string) {
  n += 1
  return `${prefix}-${String(n).padStart(4, '0')}`
}
function ts(step: number) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, step)).toISOString()
}

interface FixtureUnit {
  partition: string
  context: 'member' | 'profile'
  stylist: string
  decision?: 'yes' | 'no'
  reason?: string | null
  undecidedAfterUndo?: boolean
  machine?: 'passed' | 'failed' | 'unavailable'
}

/** Build coverage input rows modeling one case with one current version each. */
function fixture(units: FixtureUnit[]): CoverageInput {
  const batches: any[] = []
  const cases: any[] = []
  const versions: any[] = []
  const events: any[] = []
  const subjectiveChecks: any[] = []
  const byBatch = new Map<string, FixtureUnit[]>()
  for (const u of units) {
    const key = `${u.partition}:${u.context}:${u.stylist}`
    byBatch.set(key, [...(byBatch.get(key) ?? []), u])
  }
  for (const [key, group] of Array.from(byBatch.entries())) {
    const [partition, context, stylist] = key.split(':')
    const batchId = id('b')
    batches.push({
      batch_id: batchId,
      data_partition: partition,
      real_member_id: context === 'member' ? MEMBER_A : null,
      evaluation_profile_id: context === 'profile' ? PROFILE_P : null,
      selected_stylist_id: stylist,
    })
    group.forEach((u, idx) => {
      const caseId = id('c')
      const versionId = id('v')
      cases.push({ case_id: caseId, batch_id: batchId, current_version_id: versionId })
      versions.push({ candidate_version_id: versionId, case_id: caseId, version_no: 1, created_at: ts(idx) })
      if (u.machine) {
        subjectiveChecks.push({ candidate_version_id: versionId, status: u.machine, created_at: ts(idx) })
      }
      if (u.decision) {
        const decideId = id('e')
        events.push({
          review_event_id: decideId,
          candidate_version_id: versionId,
          action: 'decide',
          decision: u.decision,
          reason_code: u.reason ?? null,
          candidate_item_id: null,
          note: null,
          reverses_event_id: null,
          reviewer_user_id: 'admin-1',
          idempotency_key: decideId,
          created_at: ts(idx + 100),
        })
        if (u.undecidedAfterUndo) {
          const undoId = id('e')
          events.push({
            review_event_id: undoId,
            candidate_version_id: versionId,
            action: 'undo',
            decision: null,
            reason_code: null,
            candidate_item_id: null,
            note: null,
            reverses_event_id: decideId,
            reviewer_user_id: 'admin-1',
            idempotency_key: undoId,
            created_at: ts(idx + 200),
          })
        }
      }
    })
  }
  return {
    batches,
    cases,
    versions,
    events,
    subjectiveChecks,
    stylists: [
      { stylist_id: STYLIST_X, name: 'Stylist X' },
      { stylist_id: STYLIST_Y, name: 'Stylist Y' },
    ],
    profiles: [
      { profile_id: PROFILE_P, name: 'Profile P', style_families: ['minimal', 'classic'], brand_groups: ['luxury'], occasions: ['everyday'] },
    ],
    members: [{ member_id: MEMBER_A, name: 'Member A' }],
  }
}

function blockOf(report: ReturnType<typeof buildCoverageReport>, partition: string) {
  const block = report.blocks.find((b) => b.partition === partition)
  expect(block, `partition block ${partition}`).toBeTruthy()
  return block!
}

describe('buildCoverageReport — measures, dimensions, and labels (VAL-METRIC-001)', () => {
  const report = buildCoverageReport(
    fixture([
      { partition: 'training', context: 'profile', stylist: STYLIST_X, decision: 'yes', machine: 'passed' },
      { partition: 'training', context: 'profile', stylist: STYLIST_X, decision: 'yes', machine: 'failed' },
      { partition: 'training', context: 'profile', stylist: STYLIST_X, decision: 'no', reason: 'global_composition', machine: 'failed' },
      { partition: 'training', context: 'profile', stylist: STYLIST_X, decision: 'no', reason: 'wrong_for_stylist', machine: 'unavailable' },
      { partition: 'training', context: 'profile', stylist: STYLIST_X }, // awaiting review
      { partition: 'validation', context: 'member', stylist: STYLIST_Y, decision: 'yes', machine: 'passed' },
      { partition: 'validation', context: 'member', stylist: STYLIST_Y, decision: 'no', reason: 'wrong_for_member', machine: 'passed' },
      { partition: 'holdout', context: 'member', stylist: STYLIST_Y, decision: 'yes', machine: 'passed' },
      { partition: 'synthetic', context: 'profile', stylist: STYLIST_X, decision: 'yes', machine: 'passed' },
      { partition: 'test', context: 'member', stylist: STYLIST_X, decision: 'yes', machine: 'passed' },
    ]),
  )

  it('reports review volume, acceptance rate, machine agreement, and rejection reasons per labeled partition', () => {
    const training = blockOf(report, 'training')
    expect(training.releaseRole).toBe('development')
    expect(training.totals).toMatchObject({ sampleSize: 5, reviewed: 4, accepted: 2 })
    expect(training.totals.acceptanceRate).toBeCloseTo(0.5)
    // Agreement: yes+passed agree, yes+failed disagree, no+failed agree, unavailable excluded.
    expect(training.totals.machineComparisons).toBe(3)
    expect(training.totals.machineAgreement).toBeCloseTo(2 / 3)
    expect(training.totals.rejectionReasons).toEqual({ global_composition: 1, wrong_for_stylist: 1 })

    const validation = blockOf(report, 'validation')
    expect(validation.releaseRole).toBe('validation')
    expect(validation.label).toContain('VALIDATION')
    expect(validation.totals.rejectionReasons).toEqual({ wrong_for_member: 1 })
  })

  it('synthetic and test are labeled excluded; holdout is closed by default and labeled', () => {
    expect(blockOf(report, 'synthetic').releaseRole).toBe('excluded')
    expect(blockOf(report, 'synthetic').label).toContain('EXCLUDED')
    expect(blockOf(report, 'test').releaseRole).toBe('excluded')
    const holdout = blockOf(report, 'holdout')
    expect(holdout.releaseRole).toBe('holdout')
    expect(holdout.included).toBe(false)
    expect(holdout.label).toContain('HOLDOUT')
    expect(holdout.label).toContain('NOT OPENED')
  })

  it('an opened holdout stays labeled holdout and becomes separately reportable', () => {
    const opened = buildCoverageReport(
      fixture([{ partition: 'holdout', context: 'member', stylist: STYLIST_Y, decision: 'yes', machine: 'passed' }]),
      { holdoutOpened: true },
    )
    const holdout = blockOf(opened, 'holdout')
    expect(holdout.included).toBe(true)
    expect(holdout.label).toContain('HOLDOUT')
    expect(holdout.totals.reviewed).toBe(1)
    // Still never blended: training/validation blocks remain separate.
    expect(blockOf(opened, 'training').totals.sampleSize).toBe(0)
  })

  it('covers every approved dimension with labeled partition and context type', () => {
    const training = blockOf(report, 'training')
    for (const dim of ['stylist', 'evaluationProfile', 'realMember', 'styleFamily', 'brandGroup', 'occasion'] as const) {
      expect(training.dimensions[dim], dim).toBeDefined()
      for (const seg of training.dimensions[dim]) {
        expect(seg.partition).toBe('training')
        // Segments with any sample are always context-labeled; an empty grid
        // segment has no context to label yet and shows NO DATA instead.
        if (seg.sampleSize > 0) expect(seg.contextTypes.length).toBeGreaterThan(0)
        else expect(seg.warning).toContain('NO DATA')
      }
    }
    const stylistSeg = training.dimensions.stylist.find((s) => s.key === STYLIST_X)!
    expect(stylistSeg.reviewed).toBe(4)
    const familySeg = training.dimensions.styleFamily.find((s) => s.key === 'minimal')!
    expect(familySeg.reviewed).toBe(4)
    expect(familySeg.contextTypes).toEqual(['evaluation_profile'])
  })

  it('excludes evaluation-profile reviews from real-user trust denominators (VAL-LEARN-002)', () => {
    // Real-member evidence: validation yes+no (2 reviewed, 1 accepted). Training
    // rows are profile-context and must not enter real-user trust.
    expect(report.realUserTrust).toMatchObject({ sampleSize: 2, reviewed: 2, accepted: 1 })
    expect(report.realUserTrust.label).toContain('REAL MEMBERS')
    expect(report.realUserTrust.note).toContain('Evaluation-profile')
  })

  it('labels which partitions compose the real-user trust block alongside the context-type label', () => {
    // Closed holdout: development (training) + validation real-member evidence.
    expect(report.realUserTrust.label).toContain('REAL MEMBERS')
    expect(report.realUserTrust.partitions).toEqual(['training', 'validation'])
    expect(report.realUserTrust.partitionLabel).toBe('TRAINING + VALIDATION')

    // A deliberately opened holdout joins the composition and stays labeled.
    const opened = buildCoverageReport(
      fixture([
        { partition: 'validation', context: 'member', stylist: STYLIST_Y, decision: 'yes', machine: 'passed' },
        { partition: 'holdout', context: 'member', stylist: STYLIST_Y, decision: 'no', reason: 'global_composition', machine: 'failed' },
      ]),
      { holdoutOpened: true },
    )
    expect(opened.realUserTrust.partitions).toEqual(['training', 'validation', 'holdout'])
    expect(opened.realUserTrust.partitionLabel).toContain('TRAINING + VALIDATION + HOLDOUT')
    expect(opened.realUserTrust.partitionLabel).toContain('OPENED')
    expect(opened.realUserTrust).toMatchObject({ sampleSize: 2, reviewed: 2, accepted: 1 })
  })

  it('carries no unlabeled blended platform-wide rate', () => {
    const json = JSON.stringify(report)
    expect(report).not.toHaveProperty('overallAcceptanceRate')
    expect(report).not.toHaveProperty('acceptanceRate')
    expect(json).not.toContain('platform-wide confidence')
    for (const block of report.blocks) expect(block.label.length).toBeGreaterThan(0)
  })
})

describe('buildCoverageReport — sparse and missing segments (VAL-METRIC-002)', () => {
  const report = buildCoverageReport(
    fixture([
      { partition: 'training', context: 'profile', stylist: STYLIST_X, decision: 'yes', machine: 'passed' },
      { partition: 'training', context: 'profile', stylist: STYLIST_X, decision: 'no', reason: 'wrong_for_stylist', machine: 'passed' },
    ]),
  )

  it('sparse segments show the sample size and a visible warning', () => {
    const seg = blockOf(report, 'training').dimensions.stylist.find((s) => s.key === STYLIST_X)!
    expect(seg.sampleSize).toBe(2)
    expect(seg.sparse).toBe(true)
    expect(seg.warning).toContain('n=2')
    expect(seg.warning).toContain(String(SPARSE_SAMPLE_THRESHOLD))
  })

  it('missing grid segments appear with n=0 and a NO DATA warning instead of an implied claim', () => {
    const training = blockOf(report, 'training')
    const idle = training.dimensions.stylist.find((s) => s.key === STYLIST_Y)!
    expect(idle.sampleSize).toBe(0)
    expect(idle.warning).toContain('NO DATA')
    expect(idle.acceptanceRate).toBeNull()
    const realMemberDim = training.dimensions.realMember.find((s) => s.key === MEMBER_A)!
    expect(realMemberDim.sampleSize).toBe(0)
    expect(realMemberDim.warning).toContain('NO DATA')
    const classic = training.dimensions.styleFamily.find((s) => s.key === 'classic')!
    expect(classic.sampleSize).toBe(2)
    expect(classic.sparse).toBe(true)
  })

  it('undone decisions count as unreviewed and versions never double count', () => {
    const r = buildCoverageReport(
      fixture([
        { partition: 'training', context: 'profile', stylist: STYLIST_X, decision: 'yes', machine: 'passed', undecidedAfterUndo: true },
        { partition: 'training', context: 'profile', stylist: STYLIST_X, decision: 'yes', machine: 'passed' },
      ]),
    )
    const totals = blockOf(r, 'training').totals
    expect(totals.sampleSize).toBe(2)
    expect(totals.reviewed).toBe(1)
    expect(totals.accepted).toBe(1)
  })

  it('programme stages are guidance only — exact targets, no automation hooks', () => {
    expect(PROGRAMME_GUIDANCE.map((s) => s.stage)).toEqual(['pilot', 'calibration', 'validation', 'rolling'])
    expect(PROGRAMME_GUIDANCE[0]).toMatchObject({ targetMin: 100, targetMax: 150 })
    expect(PROGRAMME_GUIDANCE[1]).toMatchObject({ targetMin: 350, targetMax: 500 })
    expect(PROGRAMME_GUIDANCE[2]).toMatchObject({ targetMin: 1000, targetMax: 1500 })
    expect(PROGRAMME_GUIDANCE[3]).toMatchObject({ targetApprox: 5000 })
    for (const stage of PROGRAMME_GUIDANCE) expect(stage.manualOnly).toBe(true)
    expect(report.guidance.manualOnly).toBe(true)
    expect(report.guidance.text).toContain('manual')
    // Guidance observes development (training) review volume; it never triggers work.
    expect(report.guidance.observedTrainingReviews).toBe(2)
    // The guidance text may only ever describe manual operation — the exact
    // negation is asserted so no automation phrasing can creep in.
    expect(report.guidance.text).toContain('manual guidance only')
    expect(report.guidance.text).toContain('No stage creates, starts, or schedules work')
    expect(report.guidance).not.toHaveProperty('action')
    expect(report.guidance).not.toHaveProperty('onTrigger')
  })
})
