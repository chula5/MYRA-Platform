// Coverage reporting for the Outfit Quality Lab.
//
// Every number is derived from immutable provenance (batch → case → current
// candidate version → append-only review events) and EFFECTIVE review state,
// so reversals never double count and superseded decisions stay out of rates.
//
// Hard rules (architecture.md / validation-contract.md):
//   * Every segment is labeled with its partition AND context type. There is
//     deliberately no unlabeled blended rate — platform-wide confidence can
//     never be inferred from an overall average.
//   * `synthetic` and `test` never enter release evidence; `training` is
//     development-only; `validation` is reported separately; `holdout` stays
//     closed (counts shown, excluded from tuning/release) until deliberately
//     opened, and remains labeled HOLDOUT afterwards.
//   * Evaluation-profile reviews never enter real-user trust denominators,
//     even though their training reviews legitimately teach global quality
//     and the selected stylist.
//   * Sparse and missing segments display their sample size and a warning.
//   * Programme stages (pilot 100–150, calibration 350–500, validation
//     1,000–1,500, rolling ≈5,000) are GUIDANCE ONLY. Nothing here creates,
//     starts, or schedules any work.

import { latestActiveDecision, orderEvents, type ReviewEventRow } from '@/lib/outfit-quality/review-state'

/** Below this sample size a segment is indicative only, never a conclusion. */
export const SPARSE_SAMPLE_THRESHOLD = 30

export interface ProgrammeStage {
  stage: 'pilot' | 'calibration' | 'validation' | 'rolling'
  label: string
  targetMin?: number
  targetMax?: number
  targetApprox?: number
  description: string
  /** Always true: a stage is guidance; it never creates or starts work. */
  manualOnly: true
}

export const PROGRAMME_GUIDANCE: readonly ProgrammeStage[] = [
  {
    stage: 'pilot',
    label: 'PILOT',
    targetMin: 100,
    targetMax: 150,
    description: 'Refine the rubric and workflow with the first prospective real reviews.',
    manualOnly: true,
  },
  {
    stage: 'calibration',
    label: 'CALIBRATION',
    targetMin: 350,
    targetMax: 500,
    description: 'Another 350–500 diverse reviews across stylists, style families, brand groups, and occasions.',
    manualOnly: true,
  },
  {
    stage: 'validation',
    label: 'VALIDATION',
    targetMin: 1000,
    targetMax: 1500,
    description: 'Unseen, version-frozen reviews with segment coverage, reported separately.',
    manualOnly: true,
  },
  {
    stage: 'rolling',
    label: 'ONGOING',
    targetApprox: 5000,
    description: 'Later rolling batches toward roughly 5,000 prospective real reviews, each created and started by hand.',
    manualOnly: true,
  },
] as const

// ── Input rows (already fetched by the server read model) ────────────────────

export interface CoverageBatchRow {
  batch_id: string
  data_partition: string
  real_member_id: string | null
  evaluation_profile_id: string | null
  selected_stylist_id: string
}

export interface CoverageCaseRow {
  case_id: string
  batch_id: string
  current_version_id: string | null
}

export interface CoverageVersionRow {
  candidate_version_id: string
  case_id: string
  version_no: number
  created_at: string
}

export interface CoverageSubjectiveCheckRow {
  candidate_version_id: string
  status: 'passed' | 'failed' | 'unavailable' | 'error'
  created_at?: string
}

export interface CoverageStylistRow {
  stylist_id: string
  name: string
}

export interface CoverageProfileRow {
  profile_id: string
  name: string
  style_families: string[]
  brand_groups: string[]
  occasions: string[]
}

export interface CoverageMemberRow {
  member_id: string
  name: string
}

export interface CoverageInput {
  batches: CoverageBatchRow[]
  cases: CoverageCaseRow[]
  versions: CoverageVersionRow[]
  events: ReviewEventRow[]
  subjectiveChecks: CoverageSubjectiveCheckRow[]
  stylists: CoverageStylistRow[]
  profiles: CoverageProfileRow[]
  members: CoverageMemberRow[]
}

export interface CoverageOptions {
  /** Deliberate holdout opening. Default false: holdout is excluded and labeled NOT OPENED. */
  holdoutOpened?: boolean
  sparseThreshold?: number
  generatedAt?: string
}

// ── Output model ─────────────────────────────────────────────────────────────

export type CoverageContextType = 'real_member' | 'evaluation_profile'
export type CoverageDimension = 'stylist' | 'evaluationProfile' | 'realMember' | 'styleFamily' | 'brandGroup' | 'occasion'

export interface CoverageSegment {
  key: string
  label: string
  partition: string
  /** Context types present in this segment's sample — always labeled. */
  contextTypes: CoverageContextType[]
  sampleSize: number
  reviewed: number
  accepted: number
  acceptanceRate: number | null
  machineComparisons: number
  machineAgreement: number | null
  rejectionReasons: Record<string, number>
  sparse: boolean
  warning: string | null
}

export interface CoveragePartitionBlock {
  partition: string
  label: string
  releaseRole: 'development' | 'validation' | 'holdout' | 'excluded'
  /** False for a closed holdout: shown for audit, excluded from release use. */
  included: boolean
  totals: Omit<CoverageSegment, 'key' | 'label' | 'partition' | 'contextTypes'>
  dimensions: Record<CoverageDimension, CoverageSegment[]>
}

export interface RealUserTrust {
  label: string
  /** The partitions whose real-member evidence composes this block — always labeled. */
  partitions: string[]
  /** Human-readable composition, e.g. "TRAINING + VALIDATION (+ HOLDOUT when deliberately opened)". */
  partitionLabel: string
  note: string
  sampleSize: number
  reviewed: number
  accepted: number
  acceptanceRate: number | null
  sparse: boolean
  warning: string | null
}

export interface CoverageGuidance {
  stages: readonly ProgrammeStage[]
  observedTrainingReviews: number
  manualOnly: true
  text: string
}

export interface CoverageReport {
  generatedAt: string
  sparseThreshold: number
  blocks: CoveragePartitionBlock[]
  realUserTrust: RealUserTrust
  guidance: CoverageGuidance
}

// ── Internals ────────────────────────────────────────────────────────────────

interface Unit {
  partition: string
  contextType: CoverageContextType
  stylistId: string
  memberId: string | null
  profileId: string | null
  decision: 'yes' | 'no' | null
  reasonCode: string | null
  machineStatus: 'passed' | 'failed' | null // null = no conclusive subjective check
}

const PARTITION_ORDER = ['training', 'validation', 'holdout', 'synthetic', 'test'] as const

const PARTITION_PRESENTATION: Record<string, { label: string; releaseRole: CoveragePartitionBlock['releaseRole'] }> = {
  training: { label: 'TRAINING — DEVELOPMENT ONLY', releaseRole: 'development' },
  validation: { label: 'VALIDATION — REPORTED SEPARATELY', releaseRole: 'validation' },
  holdout: { label: 'HOLDOUT', releaseRole: 'holdout' },
  synthetic: { label: 'SYNTHETIC — EXCLUDED FROM LEARNING AND RELEASE', releaseRole: 'excluded' },
  test: { label: 'TEST — AUTOMATED FIXTURES, EXCLUDED', releaseRole: 'excluded' },
}

interface SegmentAccum {
  key: string
  label: string
  partition: string
  contextTypes: Set<CoverageContextType>
  sampleSize: number
  reviewed: number
  accepted: number
  agreements: number
  comparisons: number
  rejectionReasons: Record<string, number>
}

function newAccum(key: string, label: string, partition: string): SegmentAccum {
  return { key, label, partition, contextTypes: new Set(), sampleSize: 0, reviewed: 0, accepted: 0, agreements: 0, comparisons: 0, rejectionReasons: {} }
}

function addUnit(acc: SegmentAccum, unit: Unit) {
  acc.sampleSize += 1
  acc.contextTypes.add(unit.contextType)
  if (unit.decision) {
    acc.reviewed += 1
    if (unit.decision === 'yes') acc.accepted += 1
    else if (unit.reasonCode) acc.rejectionReasons[unit.reasonCode] = (acc.rejectionReasons[unit.reasonCode] ?? 0) + 1
    // Machine agreement uses only conclusive subjective outcomes; an
    // unavailable or errored check is never a comparison.
    if (unit.machineStatus) {
      acc.comparisons += 1
      const machinePositive = unit.machineStatus === 'passed'
      const humanPositive = unit.decision === 'yes'
      if (machinePositive === humanPositive) acc.agreements += 1
    }
  }
}

function finalizeSegment(acc: SegmentAccum, threshold: number): CoverageSegment {
  const sparse = acc.sampleSize < threshold
  const warning =
    acc.sampleSize === 0
      ? 'NO DATA — no candidates in this segment; nothing is claimed'
      : sparse
        ? `SPARSE SAMPLE — n=${acc.sampleSize} (< ${threshold}); indicative only, not a segment conclusion`
        : null
  return {
    key: acc.key,
    label: acc.label,
    partition: acc.partition,
    contextTypes: Array.from(acc.contextTypes).sort(),
    sampleSize: acc.sampleSize,
    reviewed: acc.reviewed,
    accepted: acc.accepted,
    acceptanceRate: acc.reviewed > 0 ? acc.accepted / acc.reviewed : null,
    machineComparisons: acc.comparisons,
    machineAgreement: acc.comparisons > 0 ? acc.agreements / acc.comparisons : null,
    rejectionReasons: acc.rejectionReasons,
    sparse,
    warning,
  }
}

/**
 * Build the labeled coverage report. Only the CURRENT version of each case is
 * a review unit, and only the latest UNREVERSED decision counts — edits and
 * undo/withdraw can never double count.
 */
export function buildCoverageReport(input: CoverageInput, options: CoverageOptions = {}): CoverageReport {
  const threshold = options.sparseThreshold ?? SPARSE_SAMPLE_THRESHOLD
  const holdoutOpened = options.holdoutOpened === true

  const batchById = new Map(input.batches.map((b) => [b.batch_id, b]))
  const versionById = new Map(input.versions.map((v) => [v.candidate_version_id, v]))
  const checksByVersion = new Map<string, CoverageSubjectiveCheckRow[]>()
  for (const c of input.subjectiveChecks) {
    checksByVersion.set(c.candidate_version_id, [...(checksByVersion.get(c.candidate_version_id) ?? []), c])
  }
  const eventsByVersion = new Map<string, ReviewEventRow[]>()
  for (const e of input.events) {
    eventsByVersion.set(e.candidate_version_id, [...(eventsByVersion.get(e.candidate_version_id) ?? []), e])
  }

  const units: Unit[] = []
  for (const kase of input.cases) {
    if (!kase.current_version_id) continue
    const version = versionById.get(kase.current_version_id)
    const batch = batchById.get(kase.batch_id)
    if (!version || !batch) continue
    const decision = latestActiveDecision(eventsByVersion.get(version.candidate_version_id) ?? [])
    const checks = checksByVersion.get(version.candidate_version_id) ?? []
    const conclusive = checks.filter((c) => c.status === 'passed' || c.status === 'failed')
    const machine = conclusive.length
      ? conclusive.sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))[conclusive.length - 1].status
      : null
    units.push({
      partition: batch.data_partition,
      contextType: batch.real_member_id ? 'real_member' : 'evaluation_profile',
      stylistId: batch.selected_stylist_id,
      memberId: batch.real_member_id,
      profileId: batch.evaluation_profile_id,
      decision: decision?.decision ?? null,
      reasonCode: decision?.reason_code ?? null,
      machineStatus: machine as Unit['machineStatus'],
    })
  }

  const stylistName = new Map(input.stylists.map((s) => [s.stylist_id, s.name]))
  const profileName = new Map(input.profiles.map((p) => [p.profile_id, p.name]))
  const memberName = new Map(input.members.map((m) => [m.member_id, m.name]))

  // Dimension grids include every known value so a MISSING segment is visible
  // with n=0 instead of silently absent.
  const grids: Record<CoverageDimension, { key: string; label: string }[]> = {
    stylist: input.stylists.map((s) => ({ key: s.stylist_id, label: s.name })),
    evaluationProfile: input.profiles.map((p) => ({ key: p.profile_id, label: p.name })),
    realMember: input.members.map((m) => ({ key: m.member_id, label: m.name })),
    styleFamily: Array.from(new Set(input.profiles.flatMap((p) => p.style_families))).sort().map((f) => ({ key: f, label: f.toUpperCase() })),
    brandGroup: Array.from(new Set(input.profiles.flatMap((p) => p.brand_groups))).sort().map((g) => ({ key: g, label: g.toUpperCase() })),
    occasion: Array.from(new Set(input.profiles.flatMap((p) => p.occasions))).sort().map((o) => ({ key: o, label: o.toUpperCase() })),
  }
  const profileById = new Map(input.profiles.map((p) => [p.profile_id, p]))

  function unitDimensionKeys(dim: CoverageDimension, unit: Unit): string[] {
    switch (dim) {
      case 'stylist':
        return [unit.stylistId]
      case 'evaluationProfile':
        return unit.profileId ? [unit.profileId] : []
      case 'realMember':
        return unit.memberId ? [unit.memberId] : []
      case 'styleFamily':
        return unit.profileId ? (profileById.get(unit.profileId)?.style_families ?? []) : []
      case 'brandGroup':
        return unit.profileId ? (profileById.get(unit.profileId)?.brand_groups ?? []) : []
      case 'occasion':
        return unit.profileId ? (profileById.get(unit.profileId)?.occasions ?? []) : []
    }
  }

  const blocks: CoveragePartitionBlock[] = PARTITION_ORDER.map((partition) => {
    const presentation = PARTITION_PRESENTATION[partition]
    const isHoldout = partition === 'holdout'
    const included = !isHoldout || holdoutOpened
    const label = isHoldout
      ? holdoutOpened
        ? 'HOLDOUT — DELIBERATELY OPENED — LABELLED, NEVER BLENDED'
        : 'HOLDOUT — NOT OPENED — EXCLUDED FROM TUNING, PRIORITISATION, AND RELEASE'
      : presentation.label
    const partitionUnits = units.filter((u) => u.partition === partition)

    const totalsAccum = newAccum(partition, label, partition)
    const dimensionAccums: Record<CoverageDimension, Map<string, SegmentAccum>> = {
      stylist: new Map(),
      evaluationProfile: new Map(),
      realMember: new Map(),
      styleFamily: new Map(),
      brandGroup: new Map(),
      occasion: new Map(),
    }
    for (const dim of Object.keys(grids) as CoverageDimension[]) {
      for (const entry of grids[dim]) {
        dimensionAccums[dim].set(entry.key, newAccum(entry.key, entry.label, partition))
      }
    }

    for (const unit of partitionUnits) {
      addUnit(totalsAccum, unit)
      for (const dim of Object.keys(grids) as CoverageDimension[]) {
        for (const key of unitDimensionKeys(dim, unit)) {
          const acc = dimensionAccums[dim].get(key) ?? newAccum(key, key, partition)
          addUnit(acc, unit)
          dimensionAccums[dim].set(key, acc)
        }
      }
    }

    const totalsFinal = finalizeSegment(totalsAccum, threshold)
    const dimensions = Object.fromEntries(
      (Object.keys(grids) as CoverageDimension[]).map((dim) => [
        dim,
        Array.from(dimensionAccums[dim].values()).map((a) => finalizeSegment(a, threshold)),
      ]),
    ) as Record<CoverageDimension, CoverageSegment[]>

    return {
      partition,
      label,
      releaseRole: presentation.releaseRole,
      included,
      totals: {
        sampleSize: totalsFinal.sampleSize,
        reviewed: totalsFinal.reviewed,
        accepted: totalsFinal.accepted,
        acceptanceRate: totalsFinal.acceptanceRate,
        machineComparisons: totalsFinal.machineComparisons,
        machineAgreement: totalsFinal.machineAgreement,
        rejectionReasons: totalsFinal.rejectionReasons,
        sparse: totalsFinal.sparse,
        warning: totalsFinal.warning,
      },
      dimensions,
    }
  })

  // Real-user trust: REAL MEMBER contexts only, from development (training)
  // and validation evidence — plus a deliberately opened holdout, still
  // labeled. Evaluation-profile reviews never enter these denominators. The
  // composing partitions are always displayed alongside the context-type
  // label so the block can never be mistaken for a blended platform rate.
  const trustUnits = units.filter(
    (u) => u.contextType === 'real_member' && (u.partition === 'training' || u.partition === 'validation' || (u.partition === 'holdout' && holdoutOpened)),
  )
  const trustAccum = newAccum('real_user_trust', 'REAL-USER TRUST', 'training+validation')
  for (const u of trustUnits) addUnit(trustAccum, u)
  const trustFinal = finalizeSegment(trustAccum, threshold)
  const trustPartitions = holdoutOpened ? ['training', 'validation', 'holdout'] : ['training', 'validation']
  const trustPartitionLabel = holdoutOpened ? 'TRAINING + VALIDATION + HOLDOUT (DELIBERATELY OPENED — LABELLED)' : 'TRAINING + VALIDATION'

  const observedTrainingReviews = units.filter((u) => u.partition === 'training' && u.decision !== null).length

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sparseThreshold: threshold,
    blocks,
    realUserTrust: {
      label: 'REAL-USER TRUST — REAL MEMBERS ONLY',
      partitions: trustPartitions,
      partitionLabel: trustPartitionLabel,
      note: 'Evaluation-profile and machine-only evidence is excluded from these denominators; synthetic and test partitions never contribute.',
      sampleSize: trustFinal.sampleSize,
      reviewed: trustFinal.reviewed,
      accepted: trustFinal.accepted,
      acceptanceRate: trustFinal.acceptanceRate,
      sparse: trustFinal.sparse,
      warning: trustFinal.warning,
    },
    guidance: {
      stages: PROGRAMME_GUIDANCE,
      observedTrainingReviews,
      manualOnly: true,
      text: 'Programme stages are manual guidance only: every batch is created, started, paused, and processed by an explicit operator action. No stage creates, starts, or schedules work, and aggregate volume never unlocks a confidence claim.',
    },
  }
}

/** Order events helper re-exported for read-model determinism. */
export { orderEvents }
