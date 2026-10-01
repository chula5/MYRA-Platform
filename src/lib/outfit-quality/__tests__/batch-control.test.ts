import { describe, it, expect } from 'vitest'
import {
  MAX_TARGET_COUNT,
  MAX_CHUNK,
  validateTargetCount,
  validateChunkRequest,
  canStart,
  canGenerate,
  canPause,
  canResume,
  planChunkClaim,
  isBatchComplete,
  type BatchStatus,
} from '@/lib/outfit-quality/batch-control'

describe('target count bounds (1–150)', () => {
  it('accepts the inclusive endpoints and a middle value', () => {
    expect(validateTargetCount(1)).toEqual({ ok: true })
    expect(validateTargetCount(150)).toEqual({ ok: true })
    expect(validateTargetCount(75)).toEqual({ ok: true })
  })
  it('rejects below 1 and above 150', () => {
    expect(validateTargetCount(0)).toMatchObject({ ok: false, code: 'target_out_of_range' })
    expect(validateTargetCount(151)).toMatchObject({ ok: false, code: 'target_out_of_range' })
    expect(validateTargetCount(MAX_TARGET_COUNT + 1)).toMatchObject({ ok: false, code: 'target_out_of_range' })
  })
  it('rejects non-integers and non-numbers', () => {
    expect(validateTargetCount(10.5)).toMatchObject({ ok: false, code: 'target_not_integer' })
    expect(validateTargetCount('10' as unknown)).toMatchObject({ ok: false, code: 'target_not_integer' })
    expect(validateTargetCount(NaN)).toMatchObject({ ok: false, code: 'target_not_integer' })
  })
})

describe('chunk request bounds (1–25)', () => {
  it('accepts the inclusive endpoints', () => {
    expect(validateChunkRequest(1)).toEqual({ ok: true })
    expect(validateChunkRequest(25)).toEqual({ ok: true })
  })
  it('rejects 0, above 25, and non-integers', () => {
    expect(validateChunkRequest(0)).toMatchObject({ ok: false, code: 'chunk_out_of_range' })
    expect(validateChunkRequest(26)).toMatchObject({ ok: false, code: 'chunk_out_of_range' })
    expect(validateChunkRequest(MAX_CHUNK + 1)).toMatchObject({ ok: false, code: 'chunk_out_of_range' })
    expect(validateChunkRequest(3.2)).toMatchObject({ ok: false, code: 'chunk_not_integer' })
  })
})

describe('batch state machine', () => {
  it('only a draft is startable', () => {
    expect(canStart('draft')).toBe(true)
    for (const s of ['active', 'paused', 'completed', 'failed'] as BatchStatus[]) expect(canStart(s)).toBe(false)
  })
  it('only an active batch generates', () => {
    expect(canGenerate('active')).toBe(true)
    for (const s of ['draft', 'paused', 'completed', 'failed'] as BatchStatus[]) expect(canGenerate(s)).toBe(false)
  })
  it('pause applies only to an active batch; resume only to a paused one', () => {
    expect(canPause('active')).toBe(true)
    expect(canPause('paused')).toBe(false)
    expect(canResume('paused')).toBe(true)
    expect(canResume('active')).toBe(false)
  })
})

describe('planChunkClaim', () => {
  it('claims min(requested, 25, remaining)', () => {
    expect(planChunkClaim({ status: 'active', requested: 10, remaining: 100 })).toEqual({ ok: true, claim: 10 })
    expect(planChunkClaim({ status: 'active', requested: 25, remaining: 5 })).toEqual({ ok: true, claim: 5 })
    expect(planChunkClaim({ status: 'active', requested: 25, remaining: 100 })).toEqual({ ok: true, claim: 25 })
  })
  it('never exceeds the 25 ceiling even when more is requested', () => {
    // Requested is itself rejected above 25, so an over-request fails closed.
    expect(planChunkClaim({ status: 'active', requested: 40, remaining: 100 })).toMatchObject({ ok: false, code: 'chunk_out_of_range' })
  })
  it('a paused batch claims nothing (pause blocks new claims)', () => {
    expect(planChunkClaim({ status: 'paused', requested: 10, remaining: 100 })).toMatchObject({ ok: false, code: 'not_generatable' })
  })
  it('a draft, completed or failed batch claims nothing', () => {
    for (const s of ['draft', 'completed', 'failed'] as BatchStatus[]) {
      expect(planChunkClaim({ status: s, requested: 10, remaining: 100 })).toMatchObject({ ok: false, code: 'not_generatable' })
    }
  })
  it('a full batch is rejected rather than rolling into another claim', () => {
    expect(planChunkClaim({ status: 'active', requested: 10, remaining: 0 })).toMatchObject({ ok: false, code: 'batch_full' })
  })
})

describe('isBatchComplete', () => {
  it('is true only once produced reaches the target', () => {
    expect(isBatchComplete({ produced: 149, targetCount: 150 })).toBe(false)
    expect(isBatchComplete({ produced: 150, targetCount: 150 })).toBe(true)
  })
})
