// Unit proof of the chunk-claim orchestration in generateChunk: the atomic
// reservation RPC is the only way positions are claimed, its errors map to
// stable codes, nothing generates without a reservation, and a mid-chunk
// failure releases exactly the reservations that produced no case.
//
// The connected suite (chunk-claims.connected.test.ts) proves the RPC's
// serialization against the real database; here we prove the caller's side.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateAndCheckChunk = vi.hoisted(() => vi.fn())

vi.mock('@/lib/outfit-quality/candidate-generation', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/outfit-quality/candidate-generation')>()
  return { ...orig, generateAndCheckChunk: mockGenerateAndCheckChunk }
})

vi.mock('@/lib/outfit-quality/generation-adapters', () => ({
  createComposerGenerator: () => ({ generate: vi.fn(async () => []) }),
  createObjectiveEvidenceProvider: () => ({ gather: vi.fn(async () => ({})) }),
  createSubjectiveChecker: () => ({ check: vi.fn(async () => ({ status: 'passed' })) }),
  generatedItemFromRow: vi.fn(),
}))

import { generateChunk, claimErrorCode } from '@/lib/outfit-quality/batch-store'
import { CandidatePipelineError } from '@/lib/outfit-quality/candidate-generation'

// ── Fake admin client ─────────────────────────────────────────────────────────

type Result = { data?: any; error?: any; count?: number }
type Call = { kind: string; table?: string; fn?: string; op?: string; payload?: any; args?: any }

function chainable(result: Result): any {
  const self: any = {
    then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    catch: (rej: any) => Promise.resolve(result).catch(rej),
    select: () => self,
    eq: () => self,
    in: () => self,
    is: () => self,
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
  }
  return self
}

const BATCH_ROW = {
  batch_id: 'b1',
  run_id: 'run-1',
  data_partition: 'test',
  real_member_id: 'm-1',
  evaluation_profile_id: null,
  selected_stylist_id: 'sty-1',
  stylist_snapshot_id: 'snap-1',
  target_count: 5,
  chunk_limit: 25,
  status: 'active',
  last_error: null,
}

const SNAPSHOT_ROW = {
  snapshot_id: 'snap-1',
  payload_hash: 'hash-1',
  rules_only: false,
  payload: { stylist: { stylist_id: 'sty-1' } },
  generation_model: 'pilot-composer',
  prompt_version: 'quality-lab-generation-v1',
}

function fakeAdmin(opts: {
  batch?: any
  claimResult?: Result
  caseCount?: number
} = {}) {
  const calls: Call[] = []
  const admin: any = {
    calls,
    rpc(fn: string, args: any) {
      calls.push({ kind: 'rpc', fn, args })
      if (fn === 'oq_claim_positions') return Promise.resolve(opts.claimResult ?? { data: [{ claim: 2, start_position: 0, remaining_after: 3 }], error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from(table: string) {
      const run = (op: string, payload?: any): any => {
        calls.push({ kind: 'table', table, op, payload })
        if (table === 'outfit_quality_batch') {
          if (op.startsWith('select')) return chainable({ data: opts.batch === undefined ? BATCH_ROW : opts.batch, error: null })
          return chainable({ data: null, error: null })
        }
        if (table === 'outfit_quality_stylist_snapshot') return chainable({ data: SNAPSHOT_ROW, error: null })
        if (table === 'outfit_quality_case') return chainable({ data: null, error: null, count: opts.caseCount ?? 0 })
        if (table === 'pilot_member') {
          return chainable({ data: { member_id: 'm-1', name: 'Member', is_synthetic: false, brands: [] }, error: null })
        }
        return chainable({ data: null, error: null })
      }
      return {
        select: (cols?: any) => run(`select:${typeof cols === 'string' ? cols : '*'}`),
        insert: (payload: any) => run('insert', payload),
        update: (payload: any) => run('update', payload),
      }
    },
  }
  return admin
}

beforeEach(() => {
  mockGenerateAndCheckChunk.mockReset()
  mockGenerateAndCheckChunk.mockResolvedValue({ produced: 2, awaitingHuman: 2, objectiveFailed: 0, results: [] })
})

describe('generateChunk — atomic claim orchestration', () => {
  it('claims positions through the database RPC and generates exactly the claimed range', async () => {
    const db = fakeAdmin()
    const res = await generateChunk({ batchId: 'b1', requested: 10 }, db)
    expect(res).toMatchObject({ ok: true, produced: 2, awaitingHuman: 2, remaining: 3 })
    const claimCall = db.calls.find((c: Call) => c.kind === 'rpc' && c.fn === 'oq_claim_positions')
    expect(claimCall?.args).toEqual({ p_batch_id: 'b1', p_requested: 10 })
    expect(mockGenerateAndCheckChunk).toHaveBeenCalledWith(expect.objectContaining({ claim: 2, startPosition: 0 }))
  })

  it('a full batch (RPC rejection) returns batch_full and generates nothing', async () => {
    const db = fakeAdmin({ claimResult: { data: null, error: { message: 'the batch has no remaining positions' } } })
    const res = await generateChunk({ batchId: 'b1', requested: 10 }, db)
    expect(res).toMatchObject({ ok: false, code: 'batch_full' })
    expect(mockGenerateAndCheckChunk).not.toHaveBeenCalled()
  })

  it('a paused batch (RPC rejection) returns not_generatable and generates nothing', async () => {
    const db = fakeAdmin({ claimResult: { data: null, error: { message: 'a paused batch cannot claim new work' } } })
    const res = await generateChunk({ batchId: 'b1', requested: 10 }, db)
    expect(res).toMatchObject({ ok: false, code: 'not_generatable' })
    expect(mockGenerateAndCheckChunk).not.toHaveBeenCalled()
  })

  it('an out-of-range request is rejected before any RPC or generation', async () => {
    const db = fakeAdmin()
    const res = await generateChunk({ batchId: 'b1', requested: 26 }, db)
    expect(res).toMatchObject({ ok: false, code: 'chunk_out_of_range' })
    expect(db.calls.some((c: Call) => c.kind === 'rpc')).toBe(false)
    expect(mockGenerateAndCheckChunk).not.toHaveBeenCalled()
  })

  it('a batch that was never started cannot claim', async () => {
    const db = fakeAdmin({ batch: { ...BATCH_ROW, stylist_snapshot_id: null } })
    const res = await generateChunk({ batchId: 'b1', requested: 5 }, db)
    expect(res).toMatchObject({ ok: false, code: 'not_started' })
    expect(db.calls.some((c: Call) => c.kind === 'rpc')).toBe(false)
  })

  it('a mid-chunk failure releases exactly the unproduced reservations and surfaces the error', async () => {
    const db = fakeAdmin({ claimResult: { data: [{ claim: 3, start_position: 0, remaining_after: 2 }], error: null } })
    mockGenerateAndCheckChunk.mockRejectedValue(new CandidatePipelineError('objective', new Error('insert failed: unique violation'), 1))
    const res = await generateChunk({ batchId: 'b1', requested: 3 }, db)
    expect(res).toMatchObject({ ok: false, code: 'generation_failed' })
    expect(res.message).toMatch(/insert failed: unique violation/)
    // claim 3, persisted 1 → exactly 2 reservations released.
    const release = db.calls.find((c: Call) => c.kind === 'rpc' && c.fn === 'oq_release_positions')
    expect(release?.args).toEqual({ p_batch_id: 'b1', p_count: 2 })
    // The error is recorded on the batch for the admin to see.
    const errUpdate = db.calls.find((c: Call) => c.table === 'outfit_quality_batch' && c.op === 'update' && c.payload?.last_error)
    expect(errUpdate?.payload.last_error).toMatch(/insert failed/)
  })

  it('a persist failure never reissues a possibly-committed position: it releases only the rest', async () => {
    const db = fakeAdmin({ claimResult: { data: [{ claim: 2, start_position: 0, remaining_after: 3 }], error: null } })
    mockGenerateAndCheckChunk.mockRejectedValue(new CandidatePipelineError('persist', new Error('case insert failed'), 1))
    const res = await generateChunk({ batchId: 'b1', requested: 2 }, db)
    expect(res.ok).toBe(false)
    const release = db.calls.find((c: Call) => c.kind === 'rpc' && c.fn === 'oq_release_positions')
    expect(release?.args).toEqual({ p_batch_id: 'b1', p_count: 1 })
  })

  it('marks the batch completed when the target is reached — and never starts more work', async () => {
    const db = fakeAdmin({
      claimResult: { data: [{ claim: 5, start_position: 0, remaining_after: 0 }], error: null },
      caseCount: 5,
    })
    mockGenerateAndCheckChunk.mockResolvedValue({ produced: 5, awaitingHuman: 5, objectiveFailed: 0, results: [] })
    const res = await generateChunk({ batchId: 'b1', requested: 5 }, db)
    expect(res).toMatchObject({ ok: true, completed: true, remaining: 0 })
    const statusUpdate = db.calls.find((c: Call) => c.table === 'outfit_quality_batch' && c.op === 'update' && c.payload?.status === 'completed')
    expect(statusUpdate).toBeTruthy()
    // No second claim, no scheduling.
    expect(db.calls.filter((c: Call) => c.kind === 'rpc' && c.fn === 'oq_claim_positions')).toHaveLength(1)
  })
})

describe('claimErrorCode', () => {
  it('maps the database messages to stable codes', () => {
    expect(claimErrorCode('a processing request must be between 1 and 25')).toBe('chunk_out_of_range')
    expect(claimErrorCode('a paused batch cannot claim new work')).toBe('not_generatable')
    expect(claimErrorCode('the batch has no remaining positions')).toBe('batch_full')
    expect(claimErrorCode('batch not found')).toBe('not_found')
    expect(claimErrorCode('something unexpected')).toBe('claim_failed')
  })
})
