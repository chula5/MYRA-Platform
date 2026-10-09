// The stylist's eye, read from a frozen snapshot: her reference-image
// envelope + looks become a PersonaLens, her learned model a StyleModel —
// and a rules-only or model-less snapshot yields nothing, never a borrowed lens.

import { describe, it, expect } from 'vitest'
import { personaLensFromSnapshot, styleModelFromSnapshot } from '@/lib/outfit-quality/snapshot-lens'
import { VECTOR_DIM } from '@/lib/taste-vector'
import { PERSONA_START_WEIGHT } from '@/lib/user-persona'

const vec = (fill: number) => Array.from({ length: VECTOR_DIM }, () => fill)

function payload(over: Record<string, unknown> = {}): any {
  return {
    stylist: { stylist_id: 's1', slug: 'scandi', display_name: 'Scandi', status: 'live', constitution_version: 1 },
    constitution: null,
    brief: { nevers: [], brands: [], signature_pieces: [], fabrics: [] },
    brand_direction: [], palette: [], fabrics: [], signature_pieces: [], exclusions: [],
    voice: { voice_notes: null, tagline: '', day: null, evening: null, weekend: null, how_she_routes: null },
    item_mask: { count: 0, decisions: [] },
    learned_model: { status: 'loaded', payload: { version: 1, decisions: 12, approves: 8, skips: 4, singles: { 'colour_family=black': 0.4 }, pairs: {} }, version: 1, decision_count: 12 },
    inspiration: {
      confirmed_count: 2,
      images: [
        { image_id: 'a', vector: vec(0.6) },
        { image_id: 'b', vector: vec(0.4) },
        { image_id: 'c', vector: [1, 2] }, // malformed — must be dropped
      ],
    },
    envelope: { payload: { mean: vec(0.5), spread: vec(0.1) }, status: 'ready', computed_at: null },
    rules_only: false,
    system_versions: {},
    ...over,
  }
}

describe('personaLensFromSnapshot', () => {
  it('builds the envelope + whole looks from the frozen vectors at the starting persona weight', () => {
    const lens = personaLensFromSnapshot(payload())
    expect(lens).toBeDefined()
    expect(lens!.envelope?.mean).toHaveLength(VECTOR_DIM)
    expect(lens!.looks).toHaveLength(2)
    expect(lens!.weight).toBe(PERSONA_START_WEIGHT)
    expect(lens!.reference).toBeNull()
    expect(lens!.name).toBe('Scandi')
  })

  it('is undefined for a rules-only snapshot or one without a usable envelope', () => {
    expect(personaLensFromSnapshot(payload({ rules_only: true }))).toBeUndefined()
    expect(personaLensFromSnapshot(payload({ envelope: null }))).toBeUndefined()
    expect(personaLensFromSnapshot(payload({ envelope: { payload: { mean: 'x' }, status: null, computed_at: null } }))).toBeUndefined()
    expect(personaLensFromSnapshot(null)).toBeUndefined()
  })
})

describe('styleModelFromSnapshot', () => {
  it('hydrates the stylist\'s own frozen model with the empty-model defaults filled in', () => {
    const m = styleModelFromSnapshot(payload())
    expect(m).not.toBeNull()
    expect(m!.decisions).toBe(12)
    expect(m!.singles['colour_family=black']).toBe(0.4)
    expect(m!.offers).toEqual({})
  })

  it('is null when the stylist has no model of her own (never borrowed)', () => {
    expect(styleModelFromSnapshot(payload({ learned_model: { status: 'absent', payload: null, version: null, decision_count: 0 } }))).toBeNull()
    expect(styleModelFromSnapshot(payload({ learned_model: { status: 'loaded', payload: { nonsense: true }, version: null, decision_count: 0 } }))).toBeNull()
  })
})
