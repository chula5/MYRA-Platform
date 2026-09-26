import { describe, it, expect } from 'vitest'
import { compareToVerdicts, buildReports, deltas, latestForStylist, type TrialRunLite } from '../stylist-trials'

const run = (over: Partial<TrialRunLite> & { run_id: string }): TrialRunLite => ({
  trial_id: 't1', stylist_id: 'rosie', batch_id: 'b1', run_at: '2026-09-01T10:00:00Z', hero_id: 'hero',
  items: [{ item_id: 'hero', brand: 'H' }, { item_id: 'a', brand: 'A' }, { item_id: 'b', brand: 'B' }, { item_id: 'c', brand: 'C' }, { item_id: 'd', brand: 'D' }],
  scores: { on_brief: 60, occasion: 50, distinct: 40, envelope: null, coherence: 80 },
  verdict: null, model_decisions: 0, envelope_images: 0, brief_hash: 'h1',
  ...over,
})
const items = (ids: string[]) => [{ item_id: 'hero', brand: 'H' }, ...ids.map((id) => ({ item_id: id, brand: id.toUpperCase() }))]

describe('compareToVerdicts — the same answer as one Chloe already judged?', () => {
  const yesLast = run({ run_id: 'old-yes', batch_id: 'b0', run_at: '2026-08-25T10:00:00Z', verdict: 'yes' })
  const noLast = run({ run_id: 'old-no', batch_id: 'b0', run_at: '2026-08-25T10:00:00Z', verdict: 'no', items: items(['x', 'y', 'z', 'w']) })

  it('recognises a look that shares most of its pieces with an earlier YES', () => {
    const now = run({ run_id: 'new', items: items(['a', 'b', 'c', 'q']) })
    const c = compareToVerdicts(now, [yesLast, noLast])
    expect(c.like_yes).toBe(true)
    expect(c.like_no).toBe(false)
    expect(c.nearest?.run_id).toBe('old-yes')
    expect(c.judged_before).toEqual({ yes: true, no: true })
  })

  it('recognises a look that repeats an earlier NO', () => {
    const now = run({ run_id: 'new', items: items(['x', 'y', 'z', 'q']) })
    expect(compareToVerdicts(now, [yesLast, noLast]).like_no).toBe(true)
  })

  it('never lets a batch grade itself, and ignores other trials and stylists', () => {
    const now = run({ run_id: 'new' })
    const sameBatch = run({ run_id: 'sib', verdict: 'yes' })
    const otherTrial = run({ run_id: 'ot', trial_id: 't2', batch_id: 'b0', run_at: '2026-08-25T10:00:00Z', verdict: 'yes' })
    const otherStylist = run({ run_id: 'os', stylist_id: 'clara', batch_id: 'b0', run_at: '2026-08-25T10:00:00Z', verdict: 'yes' })
    const c = compareToVerdicts(now, [sameBatch, otherTrial, otherStylist])
    expect(c.like_yes).toBe(false)
    expect(c.judged_before).toEqual({ yes: false, no: false })
  })
})

describe('buildReports and deltas — a stylist over time', () => {
  it('averages skip what is not measurable, and counts like-yes only where a YES came before', () => {
    const b0 = [
      run({ run_id: '1', trial_id: 't1', batch_id: 'b0', run_at: '2026-08-25T10:00:00Z', verdict: 'yes' }),
      run({ run_id: '2', trial_id: 't2', batch_id: 'b0', run_at: '2026-08-25T10:00:00Z', verdict: null, scores: { on_brief: 40, occasion: null, distinct: 60, envelope: null, coherence: 70 } }),
    ]
    const b1 = [
      run({ run_id: '3', trial_id: 't1', batch_id: 'b1', model_decisions: 3, brief_hash: 'h2' }),                   // same look as its earlier YES
      run({ run_id: '4', trial_id: 't2', batch_id: 'b1', model_decisions: 3, brief_hash: 'h2', scores: { on_brief: 80, occasion: 65, distinct: 60, envelope: 55, coherence: 90 } }),
      run({ run_id: '5', trial_id: 't3', batch_id: 'b1', model_decisions: 3, brief_hash: 'h2', error: 'nothing' , items: [] }),
    ]
    const reports = buildReports([...b0, ...b1])
    expect(reports.map((r) => r.batch_id)).toEqual(['b0', 'b1'])
    const [r0, r1] = reports
    expect(r0.occasion).toBe(50)       // null on t2 skipped, not averaged as 0
    expect(r0.envelope).toBeNull()
    expect(r0.pct_like_yes).toBeNull() // nothing judged before b0
    expect(r1.trials).toBe(3)
    expect(r1.errors).toBe(1)
    expect(r1.on_brief).toBe(70)
    expect(r1.envelope).toBe(55)
    expect(r1.pct_like_yes).toBe(100)  // t1 came back the same; t2 had no earlier YES so is not counted
    expect(r1.pct_like_no).toBeNull()
    expect(r1.model_decisions).toBe(3)

    const d = deltas(r1, r0)
    expect(d.on_brief).toBe(20)
    expect(d.envelope).toBeNull()
    expect(d.pct_like_yes).toBeNull()

    const l = latestForStylist(reports, 'rosie')
    expect(l.latest?.batch_id).toBe('b1')
    expect(l.previous?.batch_id).toBe('b0')
    expect(l.brief_changed).toBe(true)
    expect(latestForStylist(reports, 'clara').latest).toBeNull()
  })

  it('deltas against no previous batch are all null', () => {
    const [r] = buildReports([run({ run_id: '1' })])
    expect(Object.values(deltas(r, null)).every((v) => v === null)).toBe(true)
  })
})
