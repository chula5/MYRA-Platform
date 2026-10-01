import { describe, it, expect } from 'vitest'
import {
  TestRunManifest,
  OUTFIT_QUALITY_DELETE_ORDER,
} from '@/lib/outfit-quality/test-run-manifest'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const C = '33333333-3333-3333-3333-333333333333'

describe('TestRunManifest', () => {
  it('creates a unique run id and fixed test partition', () => {
    const m1 = new TestRunManifest()
    const m2 = new TestRunManifest()
    expect(m1.runId).not.toBe(m2.runId)
    expect(m1.partition).toBe('test')
  })

  it('records exact IDs and dedupes', () => {
    const m = new TestRunManifest('run-x')
    m.record('outfit_quality_batch', 'batch_id', A, A, B)
    expect(m.ids('outfit_quality_batch').sort()).toEqual([A, B].sort())
    expect(m.size()).toBe(2)
  })

  it('builds a dependency-safe delete plan with children before parents', () => {
    const m = new TestRunManifest()
    m.record('outfit_quality_batch', 'batch_id', A)
    m.record('outfit_quality_candidate_item', 'candidate_item_id', B)
    m.record('outfit_quality_case', 'case_id', C)
    const plan = m.deletePlan()
    const order = plan.map((s) => s.table)
    // candidate_item before case before batch
    expect(order.indexOf('outfit_quality_candidate_item')).toBeLessThan(order.indexOf('outfit_quality_case'))
    expect(order.indexOf('outfit_quality_case')).toBeLessThan(order.indexOf('outfit_quality_batch'))
  })

  it('renders delete SQL scoped to exact recorded IDs only', () => {
    const m = new TestRunManifest()
    m.record('outfit_quality_batch', 'batch_id', A, B)
    const sql = m.deleteSql()
    expect(sql).toHaveLength(1)
    expect(sql[0]).toBe(`delete from public.outfit_quality_batch where batch_id in ('${A}', '${B}');`)
    // No broad predicate ever appears.
    expect(sql[0]).not.toMatch(/data_partition/)
    expect(sql[0]).not.toMatch(/truncate/i)
    expect(sql[0]).not.toMatch(/like/i)
  })

  it('produces an empty plan when nothing recorded', () => {
    expect(new TestRunManifest().deletePlan()).toEqual([])
    expect(new TestRunManifest().deleteSql()).toEqual([])
  })

  it('rejects an unknown table and non-id-like values', () => {
    const m = new TestRunManifest()
    expect(() => m.record('not_a_table' as never, 'x', A)).toThrow()
    m.record('outfit_quality_batch', 'batch_id', "'; drop table outfit; --")
    expect(() => m.deleteSql()).toThrow()
  })

  it('delete order covers every table exactly once', () => {
    expect(new Set(OUTFIT_QUALITY_DELETE_ORDER).size).toBe(OUTFIT_QUALITY_DELETE_ORDER.length)
  })
})
