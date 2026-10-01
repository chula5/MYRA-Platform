import { describe, it, expect, vi } from 'vitest'
import {
  generateAndCheckChunk,
  prepareChildVersion,
  type CompositionGenerator,
  type ObjectiveEvidenceProvider,
  type SubjectiveChecker,
  type CandidatePersistence,
  type FrozenSnapshot,
  type GenerationContext,
  type GeneratedCandidate,
  type PersistCandidateInput,
  type PersistedCandidate,
  type SubjectiveOutcome,
} from '@/lib/outfit-quality/candidate-generation'
import type { RuleOutcome } from '@/lib/outfit-quality/objective-checks'

const SNAPSHOT: FrozenSnapshot = {
  snapshotId: 'snap-1',
  payloadHash: 'hash-1',
  rulesOnly: false,
  payload: { stylist: { stylist_id: 'sty-1' } },
  systemVersions: { prompt_version: 'quality-lab-generation-v1' },
}

const CONTEXT: GenerationContext = {
  dataPartition: 'test',
  realMemberId: null,
  evaluationProfileId: 'prof-1',
  selectedStylistId: 'sty-1',
  contextSnapshot: { style_families: ['scandi'] },
}

function candidate(idSuffix: string, opts: { badStructure?: boolean } = {}): GeneratedCandidate {
  const items = [
    { item_id: `top-${idSuffix}`, slot: 'top', sort_order: 0, item_snapshot: { item_type: 'shirt', brand: 'Arket' }, source_image_url: 'https://cdn/t.jpg', source_image_asset_version: 'v1' },
    { item_id: `bot-${idSuffix}`, slot: 'bottom', sort_order: 1, item_snapshot: { item_type: 'trousers', brand: 'Toteme' }, source_image_url: 'https://cdn/b.jpg', source_image_asset_version: 'v1' },
    { item_id: `shoe-${idSuffix}`, slot: 'shoe', sort_order: 2, item_snapshot: { item_type: 'flat', brand: 'The Row' }, source_image_url: 'https://cdn/s.jpg', source_image_asset_version: 'v1' },
  ]
  return {
    requiredSlots: ['top', 'bottom', 'shoe'],
    items: opts.badStructure ? items.filter((i) => i.slot !== 'shoe') : items,
  }
}

class RecordingStore implements CandidatePersistence {
  calls: string[] = []
  versions: Record<string, string> = {}
  objectiveByVersion: Record<string, RuleOutcome[]> = {}
  subjectiveByVersion: Record<string, SubjectiveOutcome> = {}
  private n = 0
  persistCandidate = vi.fn(async (input: PersistCandidateInput): Promise<PersistedCandidate> => {
    this.calls.push(`persist:${input.position}`)
    const vid = `cv-${++this.n}`
    return {
      caseId: `case-${this.n}`,
      candidateVersionId: vid,
      items: input.candidate.items.map((it, i) => ({ candidate_item_id: `ci-${this.n}-${i}`, item_id: it.item_id, slot: it.slot })),
    }
  })
  recordObjectiveChecks = vi.fn(async (vid: string, outcomes: RuleOutcome[]) => {
    this.calls.push(`objective:${vid}`)
    this.objectiveByVersion[vid] = outcomes
  })
  recordSubjectiveCheck = vi.fn(async (vid: string, outcome: SubjectiveOutcome) => {
    this.calls.push(`subjective:${vid}`)
    this.subjectiveByVersion[vid] = outcome
  })
  setVersionState = vi.fn(async (vid: string, state: string) => {
    this.calls.push(`state:${vid}:${state}`)
    this.versions[vid] = state
  })
  setCaseStatus = vi.fn(async (caseId: string, status: string) => {
    this.calls.push(`case:${caseId}:${status}`)
  })
}

function goodEvidence(): ObjectiveEvidenceProvider {
  return {
    gather: vi.fn(async ({ items }: { items: { item_id: string }[] }) => ({
      size: Object.fromEntries(items.map((i) => [i.item_id, 'in_size' as const])),
      stock: Object.fromEntries(items.map((i) => [i.item_id, true])),
    })),
  }
}

function makeGenerator(cands: GeneratedCandidate[]): CompositionGenerator {
  return { generate: vi.fn(async ({ count }) => cands.slice(0, count)) }
}

function subjectiveReturning(outcome: SubjectiveOutcome): SubjectiveChecker {
  return { check: vi.fn(async () => outcome) }
}

describe('generateAndCheckChunk — ordering and persistence', () => {
  it('commits the candidate (case + version + items) BEFORE any check runs', async () => {
    const store = new RecordingStore()
    const gen = makeGenerator([candidate('a')])
    const subj = subjectiveReturning({ status: 'passed', verdict: 'works', score: 0.8 })
    await generateAndCheckChunk({
      batchId: 'b1', runId: 'run1', claim: 1, startPosition: 0,
      snapshot: SNAPSHOT, context: CONTEXT, generator: gen, evidence: goodEvidence(), subjectiveChecker: subj, store,
    })
    const persistIdx = store.calls.findIndex((c) => c.startsWith('persist:'))
    const objIdx = store.calls.findIndex((c) => c.startsWith('objective:'))
    const subjIdx = store.calls.findIndex((c) => c.startsWith('subjective:'))
    expect(persistIdx).toBeGreaterThanOrEqual(0)
    expect(persistIdx).toBeLessThan(objIdx)
    expect(objIdx).toBeLessThan(subjIdx)
  })

  it('passes the SAME frozen snapshot id + hash to generation and subjective checking', async () => {
    const store = new RecordingStore()
    const gen = makeGenerator([candidate('a')])
    const subj = subjectiveReturning({ status: 'passed' })
    await generateAndCheckChunk({
      batchId: 'b1', runId: 'run1', claim: 1, startPosition: 0,
      snapshot: SNAPSHOT, context: CONTEXT, generator: gen, evidence: goodEvidence(), subjectiveChecker: subj, store,
    })
    expect(gen.generate).toHaveBeenCalledWith(expect.objectContaining({ snapshot: SNAPSHOT }))
    expect(subj.check).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 'snap-1', payloadHash: 'hash-1' }))
  })
})

describe('generateAndCheckChunk — fail closed', () => {
  it('an objective failure moves to objective_failed, never calls the subjective checker, stays out of the queue', async () => {
    const store = new RecordingStore()
    const gen = makeGenerator([candidate('a', { badStructure: true })])
    const subj = subjectiveReturning({ status: 'passed' })
    const res = await generateAndCheckChunk({
      batchId: 'b1', runId: 'run1', claim: 1, startPosition: 0,
      snapshot: SNAPSHOT, context: CONTEXT, generator: gen, evidence: goodEvidence(), subjectiveChecker: subj, store,
    })
    expect(subj.check).not.toHaveBeenCalled()
    expect(res.objectiveFailed).toBe(1)
    expect(res.awaitingHuman).toBe(0)
    expect(res.results[0].state).toBe('objective_failed')
    // The candidate was still persisted with its objective evidence (auditable).
    expect(store.persistCandidate).toHaveBeenCalledTimes(1)
    expect(Object.values(store.objectiveByVersion)[0].some((o) => o.status === 'failed')).toBe(true)
  })

  it('an unavailable objective dependency is non-pass and skips subjective', async () => {
    const store = new RecordingStore()
    const gen = makeGenerator([candidate('a')])
    const evidence: ObjectiveEvidenceProvider = { gather: vi.fn(async () => ({ size: null, stock: null })) }
    const subj = subjectiveReturning({ status: 'passed' })
    const res = await generateAndCheckChunk({
      batchId: 'b1', runId: 'run1', claim: 1, startPosition: 0,
      snapshot: SNAPSHOT, context: CONTEXT, generator: gen, evidence, subjectiveChecker: subj, store,
    })
    expect(subj.check).not.toHaveBeenCalled()
    expect(res.results[0].state).toBe('objective_failed')
  })
})

describe('generateAndCheckChunk — every subjective outcome reaches awaiting_human', () => {
  for (const status of ['passed', 'failed', 'unavailable', 'error'] as const) {
    it(`routes a subjective ${status} to awaiting_human with no decision/learning`, async () => {
      const store = new RecordingStore()
      const gen = makeGenerator([candidate('a')])
      const subj = subjectiveReturning({ status, verdict: 'x', score: 0.5 })
      const res = await generateAndCheckChunk({
        batchId: 'b1', runId: 'run1', claim: 1, startPosition: 0,
        snapshot: SNAPSHOT, context: CONTEXT, generator: gen, evidence: goodEvidence(), subjectiveChecker: subj, store,
      })
      expect(res.awaitingHuman).toBe(1)
      expect(res.results[0].state).toBe('awaiting_human')
      expect(store.calls.some((c) => /case:.*:awaiting_human/.test(c))).toBe(true)
      // Exactly one subjective check recorded; no review/projection created here.
      expect(subj.check).toHaveBeenCalledTimes(1)
    })
  }
})

describe('generateAndCheckChunk — bounded chunk', () => {
  it('asks the generator for exactly the claimed count and produces that many', async () => {
    const store = new RecordingStore()
    const cands = [candidate('a'), candidate('b'), candidate('c')]
    const gen = makeGenerator(cands)
    const subj = subjectiveReturning({ status: 'passed' })
    const res = await generateAndCheckChunk({
      batchId: 'b1', runId: 'run1', claim: 2, startPosition: 0,
      snapshot: SNAPSHOT, context: CONTEXT, generator: gen, evidence: goodEvidence(), subjectiveChecker: subj, store,
    })
    expect(gen.generate).toHaveBeenCalledWith(expect.objectContaining({ count: 2 }))
    expect(res.produced).toBe(2)
  })
})

describe('prepareChildVersion — edit creates a fresh child', () => {
  it('increments version, uses a new hash + request key, and inherits nothing', () => {
    const plan = prepareChildVersion({
      parentVersionId: 'cv-1',
      parentVersionNo: 1,
      snapshotHash: 'hash-1',
      context: { a: 1 },
      systemVersions: { v: 1 },
      editedItems: [{ slot: 'top', item_id: 'new-top', source_image_version: 'v2' }],
      editKey: 'k1',
    })
    expect(plan.versionNo).toBe(2)
    expect(plan.parentVersionId).toBe('cv-1')
    expect(plan.inheritsChecks).toBe(false)
    expect(plan.inheritsApproval).toBe(false)
    expect(plan.generationRequestKey).toContain('edit:cv-1')
    expect(plan.compositionHash).toMatch(/^[0-9a-f]{64}$/)
  })
})
