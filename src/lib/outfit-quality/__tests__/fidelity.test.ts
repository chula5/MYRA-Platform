// The STRICT Quality Lab fidelity adapter. The legacy checker represents
// missing credentials, fetch failures, parse failures, and exceptions as
// passes; this adapter reinterprets every one of those as unavailable/error
// and fails closed. A pass is possible only from a clean, conclusive check.

import { describe, it, expect } from 'vitest'
import { checkQualityRenderFidelity, FIDELITY_MODEL } from '@/lib/outfit-quality/fidelity'
import type { FidelityResult } from '@/app/admin/ai/render-fidelity'

const ITEMS = [
  { label: 'A Brand — Shirt', image_url: 'https://res.cloudinary.com/x/top.jpg' },
  { label: 'B Brand — Trouser', image_url: 'https://res.cloudinary.com/x/bottom.jpg' },
]
const RENDER = 'https://res.cloudinary.com/x/render.png'

function raw(result: Partial<FidelityResult>): () => Promise<FidelityResult> {
  return async () => ({ passed: false, score: 0, issues: [], correctiveNotes: null, ...result })
}

describe('checkQualityRenderFidelity', () => {
  it('a clean pass is the only pass', async () => {
    const r = await checkQualityRenderFidelity(RENDER, ITEMS, { apiKeyPresent: true, rawCheck: raw({ passed: true, score: 0.93 }) })
    expect(r).toMatchObject({ status: 'passed', score: 0.93, detail: null })
  })

  it('a conclusive failure carries issues and corrective notes', async () => {
    const r = await checkQualityRenderFidelity(RENDER, ITEMS, {
      apiKeyPresent: true,
      rawCheck: raw({ passed: false, score: 0.4, issues: [{ item: 'Trouser', field: 'silhouette', expected: 'wide-leg', seen: 'cargo' }], correctiveNotes: 'keep the trousers wide-leg' }),
    })
    expect(r).toMatchObject({ status: 'failed', score: 0.4, correctiveNotes: 'keep the trousers wide-leg' })
    expect(r.issues).toHaveLength(1)
  })

  it('the legacy pass-with-error shape becomes unavailable, never a pass', async () => {
    // Every one of these is a `passed: true` + error from the legacy checker.
    for (const error of [
      'ANTHROPIC_API_KEY not configured — check skipped',
      'Could not fetch render — check skipped',
      'No response — check skipped',
      'request timed out',
    ]) {
      const r = await checkQualityRenderFidelity(RENDER, ITEMS, { apiKeyPresent: true, rawCheck: raw({ passed: true, score: 1, error }) })
      expect(r.status, error).toBe('unavailable')
    }
  })

  it('malformed checker responses are errors, never passes', async () => {
    const r = await checkQualityRenderFidelity(RENDER, ITEMS, { apiKeyPresent: true, rawCheck: raw({ passed: true, score: 1, error: 'Unparseable response — check skipped' }) })
    expect(r.status).toBe('error')
  })

  it('a checker exception is an error with a bounded detail', async () => {
    const r = await checkQualityRenderFidelity(RENDER, ITEMS, {
      apiKeyPresent: true,
      rawCheck: async () => {
        throw new Error(`socket blew up ${'z'.repeat(2000)}`)
      },
    })
    expect(r.status).toBe('error')
    expect((r.detail ?? '').length).toBeLessThanOrEqual(300)
  })

  it('a missing frozen source image fails closed before the checker is called', async () => {
    let called = 0
    const r = await checkQualityRenderFidelity(RENDER, [{ label: 'A', image_url: '' }], {
      rawCheck: async () => {
        called += 1
        return { passed: true, score: 1, issues: [], correctiveNotes: null }
      },
    })
    expect(r.status).toBe('error')
    expect(called).toBe(0)
  })

  it('missing checker configuration is unavailable and never calls the checker', async () => {
    let called = 0
    const r = await checkQualityRenderFidelity(RENDER, ITEMS, {
      apiKeyPresent: false,
      rawCheck: async () => {
        called += 1
        return { passed: true, score: 1, issues: [], correctiveNotes: null }
      },
    })
    expect(r.status).toBe('unavailable')
    expect(called).toBe(0)
  })

  it('recorded details never contain the configured API key value', async () => {
    const sentinel = 'SENTINEL_ANTHROPIC_KEY_123'
    const prev = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = sentinel
    try {
      const r = await checkQualityRenderFidelity(RENDER, ITEMS, {
        rawCheck: async () => {
          throw new Error(`provider rejected key ${sentinel}`)
        },
      })
      expect(r.status).toBe('error')
      expect(r.detail ?? '').not.toContain(sentinel)
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prev
    }
  })

  it('records the checker model for provenance', async () => {
    const r = await checkQualityRenderFidelity(RENDER, ITEMS, { apiKeyPresent: true, rawCheck: raw({ passed: true, score: 1 }) })
    expect(r.model).toBe(FIDELITY_MODEL)
  })
})
