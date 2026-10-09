import { describe, it, expect } from 'vitest'
import { mapWithConcurrency } from '@/lib/outfit-quality/concurrency'

describe('mapWithConcurrency', () => {
  it('never exceeds the limit and preserves order', async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapWithConcurrency([5, 1, 3, 2, 4], 2, async (ms) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, ms))
      inFlight--
      return ms * 10
    })
    expect(peak).toBeLessThanOrEqual(2)
    expect(out.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([50, 10, 30, 20, 40])
  })

  it('reports a rejection in place without aborting the others', async () => {
    const out = await mapWithConcurrency([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error('boom')
      return n
    })
    expect(out[0]).toEqual({ status: 'fulfilled', value: 1 })
    expect(out[1].status).toBe('rejected')
    expect(out[2]).toEqual({ status: 'fulfilled', value: 3 })
  })

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([])
  })
})
