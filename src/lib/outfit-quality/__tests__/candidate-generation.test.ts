import { describe, it, expect, vi } from 'vitest'
import {
  generateAndCheckChunk,
  prepareChildVersion,
  editAndCheckCandidate,
  CandidatePipelineError,
  type CompositionGenerator,
  type ObjectiveEvidenceProvider,
  type SubjectiveChecker,
  type CandidatePersistence,
  type ChildVersionPersistence,
  type PersistChildVersionInput,
  type FrozenSnapshot,
  type GenerationContext,
  type GeneratedCandidate,
  type PersistCandidateInput,
  type PersistedCandidate,
  type SubjectiveOutcome,
} from '@/lib/outfit-quality/candidate-generation'
import { compositionHash } from '@/lib/outfit-quality/candidate-hash'
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

  it('passes the frozen snapshot PAYLOAD to the subjective checker (the frozen lens, not a live read)', async () => {
    const store = new RecordingStore()
    const gen = makeGenerator([candidate('a')])
    const subj = subjectiveReturning({ status: 'passed' })
    await generateAndCheckChunk({
      batchId: 'b1', runId: 'run1', claim: 1, startPosition: 0,
      snapshot: SNAPSHOT, context: CONTEXT, generator: gen, evidence: goodEvidence(), subjectiveChecker: subj, store,
    })
    expect(subj.check).toHaveBeenCalledWith(expect.objectContaining({ snapshotPayload: SNAPSHOT.payload }))
  })
})

describe('generateAndCheckChunk — a persistence error aborts the flow', () => {
  const base = () => ({
    batchId: 'b1' as const, runId: 'run1', claim: 1, startPosition: 0,
    snapshot: SNAPSHOT, context: CONTEXT, evidence: goodEvidence(),
  })

  it('a failed objective-check insert aborts: no objective_failed advance, no subjective call', async () => {
    const store = new RecordingStore()
    store.recordObjectiveChecks = vi.fn(async () => { throw new Error('insert failed: unique violation') })
    const subj = subjectiveReturning({ status: 'passed' })
    const err = await generateAndCheckChunk({
      ...base(), generator: makeGenerator([candidate('a')]), subjectiveChecker: subj, store,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(CandidatePipelineError)
    expect((err as CandidatePipelineError).persistedCount).toBe(1)
    expect(err.message).toMatch(/objective/i)
    // The candidate is NOT silently advanced.
    expect(store.calls).not.toContain(expect.stringContaining('objective_failed'))
    expect(Object.values(store.versions)).not.toContain('objective_failed')
    expect(subj.check).not.toHaveBeenCalled()
  })

  it('a failed subjective-check insert aborts: the version never reaches awaiting_human', async () => {
    const store = new RecordingStore()
    store.recordSubjectiveCheck = vi.fn(async () => { throw new Error('insert failed: connection reset') })
    const subj = subjectiveReturning({ status: 'passed' })
    const err = await generateAndCheckChunk({
      ...base(), generator: makeGenerator([candidate('a')]), subjectiveChecker: subj, store,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(CandidatePipelineError)
    expect((err as CandidatePipelineError).persistedCount).toBe(1)
    expect(Object.values(store.versions)).not.toContain('awaiting_human')
    expect(store.calls.some((c) => /case:.*:awaiting_human/.test(c))).toBe(false)
  })

  it('a failed state write aborts before any check is recorded', async () => {
    const store = new RecordingStore()
    store.setVersionState = vi.fn(async () => { throw new Error('update failed: row gone') })
    const subj = subjectiveReturning({ status: 'passed' })
    const err = await generateAndCheckChunk({
      ...base(), generator: makeGenerator([candidate('a')]), subjectiveChecker: subj, store,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(CandidatePipelineError)
    expect((err as CandidatePipelineError).persistedCount).toBe(1)
    expect(Object.keys(store.objectiveByVersion)).toHaveLength(0)
    expect(subj.check).not.toHaveBeenCalled()
  })

  it('a failed case-status write aborts rather than silently advancing', async () => {
    const store = new RecordingStore()
    store.setCaseStatus = vi.fn(async () => { throw new Error('update failed') })
    const subj = subjectiveReturning({ status: 'passed' })
    const err = await generateAndCheckChunk({
      ...base(), generator: makeGenerator([candidate('a')]), subjectiveChecker: subj, store,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(CandidatePipelineError)
    expect((err as CandidatePipelineError).persistedCount).toBe(1)
  })

  it('a failed candidate persist counts the position as consumed (never double-claimed) and stops the chunk', async () => {
    const store = new RecordingStore()
    store.persistCandidate = vi.fn(async () => { throw new Error('case insert failed: batch gone') })
    const subj = subjectiveReturning({ status: 'passed' })
    const err = await generateAndCheckChunk({
      ...base(), claim: 3, generator: makeGenerator([candidate('a'), candidate('b'), candidate('c')]), subjectiveChecker: subj, store,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(CandidatePipelineError)
    // The failed position may hold a committed case — it is NOT released for a
    // retry, and no later position in the chunk is attempted.
    expect((err as CandidatePipelineError).persistedCount).toBe(1)
    expect(store.persistCandidate).toHaveBeenCalledTimes(1)
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

describe('generateAndCheckChunk — evaluation-profile candidate reaches awaiting_human', () => {
  // A profile candidate: sized garments/shoes matched to the profile size, plus
  // an unsized bag. Mimics the real evaluation-profile objective evidence.
  function profileCandidate(): GeneratedCandidate {
    return {
      requiredSlots: ['top', 'bottom', 'shoe'],
      items: [
        { item_id: 'top-p', slot: 'top', sort_order: 0, item_snapshot: { item_type: 'shirt', brand: 'Arket' }, source_image_url: 'https://cdn/t.jpg' },
        { item_id: 'bot-p', slot: 'bottom', sort_order: 1, item_snapshot: { item_type: 'trousers', brand: 'Arket' }, source_image_url: 'https://cdn/b.jpg' },
        { item_id: 'shoe-p', slot: 'shoe', sort_order: 2, item_snapshot: { item_type: 'flat', brand: 'Arket' }, source_image_url: 'https://cdn/s.jpg' },
        { item_id: 'bag-p', slot: 'bag', sort_order: 3, item_snapshot: { item_type: 'tote', brand: 'Polene' }, source_image_url: 'https://cdn/bag.jpg' },
      ],
    }
  }
  function profileEvidence(): ObjectiveEvidenceProvider {
    return {
      gather: vi.fn(async ({ items }: { items: { item_id: string; item_snapshot?: Record<string, unknown> }[] }) => ({
        // Sized pieces matched; the unsized bag is not-applicable.
        size: Object.fromEntries(items.map((i) => [i.item_id, i.item_snapshot?.item_type === 'tote' ? 'not_applicable' : 'in_size'])),
        stock: Object.fromEntries(items.map((i) => [i.item_id, true])),
      })) as any,
    }
  }

  it('objective-passes (unsized bag not-applicable) and lands at awaiting_human with one subjective result', async () => {
    const store = new RecordingStore()
    const gen = makeGenerator([profileCandidate()])
    const subj = subjectiveReturning({ status: 'passed', verdict: 'works', score: 0.8 })
    const res = await generateAndCheckChunk({
      batchId: 'b1', runId: 'run1', claim: 1, startPosition: 0,
      snapshot: SNAPSHOT, context: CONTEXT, generator: gen, evidence: profileEvidence(), subjectiveChecker: subj, store,
    })
    expect(res.objectiveFailed).toBe(0)
    expect(res.awaitingHuman).toBe(1)
    expect(res.results[0].state).toBe('awaiting_human')
    expect(subj.check).toHaveBeenCalledTimes(1)
  })

  it('still fails closed when a sized piece is unconfirmed, even with an unsized bag present', async () => {
    const store = new RecordingStore()
    const gen = makeGenerator([profileCandidate()])
    const evidence: ObjectiveEvidenceProvider = {
      gather: vi.fn(async () => ({
        size: { 'top-p': 'in_size', 'bot-p': 'unconfirmed', 'shoe-p': 'in_size', 'bag-p': 'not_applicable' },
        stock: { 'top-p': true, 'bot-p': true, 'shoe-p': true, 'bag-p': true },
      })) as any,
    }
    const subj = subjectiveReturning({ status: 'passed' })
    const res = await generateAndCheckChunk({
      batchId: 'b1', runId: 'run1', claim: 1, startPosition: 0,
      snapshot: SNAPSHOT, context: CONTEXT, generator: gen, evidence, subjectiveChecker: subj, store,
    })
    expect(subj.check).not.toHaveBeenCalled()
    expect(res.results[0].state).toBe('objective_failed')
  })
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
      editedItems: [{ slot: 'top', item_id: 'new-top', sort_order: 0, source_image_version: 'v2' }],
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

// ── Edit → persisted, freshly-checked child version ──────────────────────────

class FakeChildStore extends RecordingStore implements ChildVersionPersistence {
  childInputs: PersistChildVersionInput[] = []
  persistChildVersion = vi.fn(async (input: PersistChildVersionInput): Promise<PersistedCandidate> => {
    this.calls.push(`persistChild:${input.plan.versionNo}`)
    this.childInputs.push(input)
    return {
      caseId: input.caseId,
      candidateVersionId: 'cv-child-1',
      items: input.candidate.items.map((it, i) => ({ candidate_item_id: `ci-child-${i}`, item_id: it.item_id, slot: it.slot })),
    }
  })
}

function editArgs(store: FakeChildStore, subj: SubjectiveChecker, cand: GeneratedCandidate) {
  return {
    caseId: 'case-1',
    parentVersionId: 'cv-1',
    parentVersionNo: 1,
    parentContextSnapshot: CONTEXT.contextSnapshot,
    editKey: 'k1',
    snapshot: SNAPSHOT,
    context: CONTEXT,
    candidate: cand,
    evidence: goodEvidence(),
    subjectiveChecker: subj,
    store,
  }
}

describe('editAndCheckCandidate — persisted, freshly-checked child version', () => {
  it('inserts a parent-linked child with an incremented version and a new hash, then runs fresh checks to awaiting_human', async () => {
    const store = new FakeChildStore()
    const subj = subjectiveReturning({ status: 'passed' })
    const res = await editAndCheckCandidate(editArgs(store, subj, candidate('edited')))

    // Child linkage + fresh identity.
    expect(store.persistChildVersion).toHaveBeenCalledTimes(1)
    const input = store.childInputs[0]
    expect(input.caseId).toBe('case-1')
    expect(input.plan.parentVersionId).toBe('cv-1')
    expect(input.plan.versionNo).toBe(2)
    expect(input.plan.generationRequestKey).toBe('edit:cv-1:k1')
    expect(input.plan.inheritsChecks).toBe(false)
    expect(input.plan.inheritsApproval).toBe(false)

    // Fresh objective AND subjective checks ran against the frozen snapshot.
    expect(store.objectiveByVersion['cv-child-1']).toBeDefined()
    expect(subj.check).toHaveBeenCalledTimes(1)
    expect(subj.check).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 'snap-1', payloadHash: 'hash-1', snapshotPayload: SNAPSHOT.payload }))
    expect(res.state).toBe('awaiting_human')
    expect(store.calls.some((c) => /case:case-1:awaiting_human/.test(c))).toBe(true)

    // The parent is never mutated.
    expect(store.versions['cv-1']).toBeUndefined()
  })

  it('a deliberate reorder of a multi-item slot yields a DIFFERENT composition hash (a real new version, no collision)', async () => {
    const multiSlot = (aFirst: boolean): GeneratedCandidate => ({
      requiredSlots: ['top', 'bottom', 'shoe'],
      items: [
        { item_id: 'top-1', slot: 'top', sort_order: 0, item_snapshot: { item_type: 'shirt', brand: 'Arket' }, source_image_url: 'https://cdn/t.jpg' },
        { item_id: 'bot-1', slot: 'bottom', sort_order: 1, item_snapshot: { item_type: 'trousers', brand: 'Toteme' }, source_image_url: 'https://cdn/b.jpg' },
        { item_id: 'shoe-1', slot: 'shoe', sort_order: 2, item_snapshot: { item_type: 'flat', brand: 'The Row' }, source_image_url: 'https://cdn/s.jpg' },
        // Same two necklaces, deliberately re-sequenced.
        { item_id: aFirst ? 'neck-a' : 'neck-b', slot: 'jewellery', sort_order: 3, item_snapshot: { item_type: 'necklace', brand: 'Monica Vinader' }, source_image_url: 'https://cdn/n1.jpg' },
        { item_id: aFirst ? 'neck-b' : 'neck-a', slot: 'jewellery', sort_order: 4, item_snapshot: { item_type: 'necklace', brand: 'Monica Vinader' }, source_image_url: 'https://cdn/n2.jpg' },
      ],
    })
    const storeA = new FakeChildStore()
    const storeB = new FakeChildStore()
    await editAndCheckCandidate(editArgs(storeA, subjectiveReturning({ status: 'passed' }), multiSlot(true)))
    await editAndCheckCandidate(editArgs(storeB, subjectiveReturning({ status: 'passed' }), multiSlot(false)))
    expect(storeA.childInputs[0].plan.compositionHash).not.toBe(storeB.childInputs[0].plan.compositionHash)

    // And an unchanged edit collides with the parent's hash only if nothing
    // changed — sanity: parent hash over the parent's own ordered items.
    const parentHash = compositionHash({
      snapshotHash: SNAPSHOT.payloadHash,
      context: CONTEXT.contextSnapshot,
      systemVersions: SNAPSHOT.systemVersions,
      items: multiSlot(true).items.map((i) => ({ slot: i.slot, item_id: i.item_id, sort_order: i.sort_order, source_image_version: i.source_image_asset_version ?? null, source_image_hash: i.source_image_hash ?? null })),
    })
    expect(storeA.childInputs[0].plan.compositionHash).toBe(parentHash)
  })

  it('a child that fails objective checks fails closed: no subjective call, state objective_failed', async () => {
    const store = new FakeChildStore()
    const subj = subjectiveReturning({ status: 'passed' })
    const res = await editAndCheckCandidate(editArgs(store, subj, candidate('edited', { badStructure: true })))
    expect(subj.check).not.toHaveBeenCalled()
    expect(res.state).toBe('objective_failed')
    expect(res.subjectiveStatus).toBeNull()
    expect(store.versions['cv-child-1']).toBe('objective_failed')
  })

  it('a failed child insert aborts before any check is recorded', async () => {
    const store = new FakeChildStore()
    store.persistChildVersion = vi.fn(async () => { throw new Error('candidate version insert failed: duplicate hash') })
    const subj = subjectiveReturning({ status: 'passed' })
    await expect(editAndCheckCandidate(editArgs(store, subj, candidate('edited')))).rejects.toThrow(/duplicate hash/)
    expect(Object.keys(store.objectiveByVersion)).toHaveLength(0)
    expect(subj.check).not.toHaveBeenCalled()
  })
})
