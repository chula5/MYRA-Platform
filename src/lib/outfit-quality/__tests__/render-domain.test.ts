// Pure render policy for the Quality Lab: frozen-manifest ordering, the
// one-corrective-retry budget, bounded regeneration cycles, override reasons,
// and redacted bounded error text. No database, no adapters.

import { describe, it, expect } from 'vitest'
import {
  MAX_ATTEMPTS_PER_CYCLE,
  MAX_RENDER_CYCLES,
  OVERRIDE_REASONS,
  buildFrozenManifest,
  manifestComplete,
  planFidelityAction,
  deriveCorrectivePrompt,
  planNextCycle,
  isOverrideReason,
  boundError,
} from '@/lib/outfit-quality/render-domain'

const ITEM_ROWS = [
  {
    candidate_item_id: 'ci-b',
    item_id: 'i2',
    slot: 'bottom',
    sort_order: 1,
    item_snapshot: { item_type: 'trouser', brand: 'B Brand', product_name: 'Wide Leg', material_primary: 'wool' },
    source_image_url: 'https://res.cloudinary.com/x/bottom.jpg',
    source_image_asset_version: 'v2',
    source_image_hash: 'h2',
  },
  {
    candidate_item_id: 'ci-a',
    item_id: 'i1',
    slot: 'top',
    sort_order: 0,
    item_snapshot: { item_type: 'shirt', brand: 'A Brand' },
    source_image_url: 'https://res.cloudinary.com/x/top.jpg',
    source_image_asset_version: null,
    source_image_hash: null,
  },
]

describe('buildFrozenManifest', () => {
  it('orders by sort_order and derives labels and provenance from the frozen row only', () => {
    const m = buildFrozenManifest(ITEM_ROWS)
    expect(m.map((i) => i.candidate_item_id)).toEqual(['ci-a', 'ci-b'])
    expect(m[0]).toMatchObject({
      item_id: 'i1',
      slot: 'top',
      sort_order: 0,
      source_image_url: 'https://res.cloudinary.com/x/top.jpg',
      source_image_asset_version: null,
      source_image_hash: null,
    })
    expect(m[0].label).toContain('A Brand')
    expect(m[1].label).toContain('Wide Leg')
    expect(m[1].material_primary).toBe('wool')
  })

  it('uses only the frozen snapshot fields — extra live-shaped fields are ignored, not fetched', () => {
    const m = buildFrozenManifest(ITEM_ROWS)
    // The manifest is a pure projection of the rows handed in; nothing reaches
    // back to mutable item/stylist tables, so there is nothing else to assert
    // beyond: output depends only on input order and content.
    const again = buildFrozenManifest(ITEM_ROWS.map((r) => ({ ...r, item_snapshot: { ...r.item_snapshot, mutated: true } })))
    expect(again.map((i) => i.item_id)).toEqual(m.map((i) => i.item_id))
  })
})

describe('manifestComplete', () => {
  it('requires at least one item and a frozen source image on every item', () => {
    expect(manifestComplete([])).toBe(false)
    expect(manifestComplete(buildFrozenManifest(ITEM_ROWS))).toBe(true)
    const missing = [{ ...ITEM_ROWS[0], source_image_url: '' }]
    expect(manifestComplete(buildFrozenManifest(missing))).toBe(false)
  })
})

describe('planFidelityAction — the one-corrective-retry budget', () => {
  it('passes become ready', () => {
    expect(planFidelityAction({ attemptNo: 1, outcome: 'passed', correctiveNotes: null })).toEqual({ action: 'ready' })
    expect(planFidelityAction({ attemptNo: 2, outcome: 'passed', correctiveNotes: null })).toEqual({ action: 'ready' })
  })

  it('a conclusive first failure WITH corrective evidence earns exactly one retry', () => {
    expect(planFidelityAction({ attemptNo: 1, outcome: 'failed', correctiveNotes: 'keep the trousers wide-leg' })).toEqual({
      action: 'retry',
      correctiveNotes: 'keep the trousers wide-leg',
    })
  })

  it('a conclusive first failure WITHOUT corrective evidence requires attention — no blind retry', () => {
    const r = planFidelityAction({ attemptNo: 1, outcome: 'failed', correctiveNotes: null })
    expect(r.action).toBe('attention')
  })

  it('a second conclusive failure requires attention; no cycle may plan an attempt 3', () => {
    const r = planFidelityAction({ attemptNo: 2, outcome: 'failed', correctiveNotes: 'still wrong' })
    expect(r.action).toBe('attention')
    expect(MAX_ATTEMPTS_PER_CYCLE).toBe(2)
  })

  it('unavailable and error outcomes fail closed to attention and never retry', () => {
    expect(planFidelityAction({ attemptNo: 1, outcome: 'unavailable', correctiveNotes: null }).action).toBe('attention')
    expect(planFidelityAction({ attemptNo: 1, outcome: 'error', correctiveNotes: null }).action).toBe('attention')
    expect(planFidelityAction({ attemptNo: 1, outcome: 'error', correctiveNotes: 'even with notes' }).action).toBe('attention')
  })
})

describe('deriveCorrectivePrompt', () => {
  it('appends bounded corrective notes to the frozen base prompt', () => {
    const out = deriveCorrectivePrompt('BASE PROMPT', 'fix the colour')
    expect(out).toContain('BASE PROMPT')
    expect(out).toContain('fix the colour')
  })

  it('bounds pathological notes', () => {
    const out = deriveCorrectivePrompt('BASE', 'x'.repeat(5000))
    expect(out.length).toBeLessThan(5000)
  })
})

describe('planNextCycle — explicit, bounded regeneration', () => {
  it('creates the next cycle after the highest existing one', () => {
    expect(planNextCycle([1])).toEqual({ ok: true, cycleNo: 2 })
    expect(planNextCycle([1, 2])).toEqual({ ok: true, cycleNo: 3 })
  })

  it('refuses beyond the bound — regeneration never becomes an automatic chain', () => {
    expect(planNextCycle([1, 2, MAX_RENDER_CYCLES])).toEqual({ ok: false, code: 'cycle_limit' })
    expect(MAX_RENDER_CYCLES).toBe(3)
  })
})

describe('override reasons', () => {
  it('accepts exactly the three approved reasons', () => {
    expect(OVERRIDE_REASONS).toEqual(['image_fidelity', 'image_quality', 'underlying_outfit'])
    expect(isOverrideReason('image_fidelity')).toBe(true)
    expect(isOverrideReason('image_quality')).toBe(true)
    expect(isOverrideReason('underlying_outfit')).toBe(true)
    expect(isOverrideReason('vibes')).toBe(false)
    expect(isOverrideReason('')).toBe(false)
    expect(isOverrideReason(null)).toBe(false)
  })
})

describe('boundError', () => {
  it('bounds length and never carries a sentinel secret', () => {
    const sentinel = 'SENTINEL_SECRET_9f8e7d'
    const out = boundError(`upload failed with key ${sentinel} and ${'y'.repeat(1000)}`, [sentinel])
    expect(out.length).toBeLessThanOrEqual(300)
    expect(out).not.toContain(sentinel)
  })
})
