import { describe, it, expect } from 'vitest'
import { buildSubjectiveCheckPrompt } from '@/lib/outfit-quality/subjective-prompt'
import type { SnapshotPayload } from '@/lib/outfit-quality/stylist-snapshot'

function payload(overrides: Partial<SnapshotPayload> = {}): SnapshotPayload {
  return {
    stylist: {
      stylist_id: 'sty-1',
      slug: 'sciura',
      display_name: 'Sciura',
      status: 'live',
      constitution_version: 3,
    },
    constitution: { principles: ['quiet luxury', 'no logos'] },
    brief: {
      public_name: 'Sciura',
      tagline: 'Milanese restraint',
      image_url: null,
      signature_pieces: ['silk scarf', 'tailored blazer'],
      brands: ['The Row', 'Loro Piana'],
      palette: ['ivory', 'camel', 'navy'],
      fabrics: ['cashmere', 'silk'],
      day: 'soft tailoring and loafers',
      evening: 'long lines, one jewel',
      weekend: 'knit set',
      nevers: [{ text: 'no fuchsia', kind: 'ban', match: ['fuchsia'] }],
      siblings: [],
      how_she_routes: 'elegance first',
    },
    brand_direction: ['The Row', 'Loro Piana'],
    palette: ['ivory', 'camel', 'navy'],
    fabrics: ['cashmere', 'silk'],
    signature_pieces: ['silk scarf', 'tailored blazer'],
    exclusions: [{ text: 'no fuchsia', kind: 'ban', match: ['fuchsia'] }],
    voice: {
      voice_notes: 'Never shout.',
      tagline: 'Milanese restraint',
      day: 'soft tailoring and loafers',
      evening: 'long lines, one jewel',
      weekend: 'knit set',
      how_she_routes: 'elegance first',
    },
    item_mask: { count: 0, decisions: [] },
    learned_model: { status: 'loaded', payload: { weights: [0.1, 0.2] }, version: 7, decision_count: 142 },
    inspiration: {
      confirmed_count: 18,
      images: [
        {
          image_id: 'img-1',
          image_url: 'https://cdn.example/private-inspiration-1.jpg',
          source_url: null,
          status: 'confirmed',
          source: 'upload',
          scores: null,
          scores_original: null,
          corrected_fields: [],
          corrected_at: null,
          score_confidence: null,
          vector: [0.1, 0.2, 0.3],
          occasion_read: ['evening', 'event'],
          created_at: null,
        },
      ],
    },
    envelope: { payload: { mean: [0.1], spread: [0.2], n: 18 }, status: 'ready', computed_at: '2026-09-01T00:00:00Z' },
    rules_only: false,
    system_versions: {
      generation_model: 'pilot-composer',
      prompt_version: 'quality-lab-generation-v1',
      objective_rules_version: 'quality-lab-objective-v1',
      subjective_check_model: 'claude-opus-5',
      subjective_prompt_version: 'quality-lab-subjective-v2',
      composer_version: 'pilot-composer-v1',
      item_query_version: 'quality-lab-item-query-v1',
    },
    ...overrides,
  }
}

describe('buildSubjectiveCheckPrompt — built from the frozen snapshot payload', () => {
  it('embeds the stylist identity, constitution, brief, and rules', () => {
    const prompt = buildSubjectiveCheckPrompt(payload())
    expect(prompt).toContain('Sciura')
    expect(prompt).toContain('constitution v3')
    expect(prompt).toContain('quiet luxury')
    expect(prompt).toContain('soft tailoring and loafers') // brief day
    expect(prompt).toContain('elegance first') // how she routes
    expect(prompt).toContain('ivory') // palette
    expect(prompt).toContain('cashmere') // fabrics
    expect(prompt).toContain('silk scarf') // signature pieces
    expect(prompt).toContain('The Row') // brand direction
    expect(prompt).toContain('no fuchsia') // exclusion rule
    expect(prompt).toContain('Never shout.') // voice
  })

  it('embeds a learned-model summary and an inspiration summary', () => {
    const prompt = buildSubjectiveCheckPrompt(payload())
    expect(prompt).toContain('142') // learned-model decision count
    expect(prompt).toMatch(/learned model.*(v7|version 7)/i)
    expect(prompt).toContain('18') // confirmed inspiration count
  })

  it('flags a rules-only snapshot explicitly', () => {
    const prompt = buildSubjectiveCheckPrompt(payload({ rules_only: true }))
    expect(prompt).toMatch(/rules.only/i)
  })

  it('never leaks raw inspiration image URLs or vectors into the prompt', () => {
    const prompt = buildSubjectiveCheckPrompt(payload())
    expect(prompt).not.toContain('private-inspiration-1.jpg')
    expect(prompt).not.toContain('0.1,0.2,0.3')
  })

  it('is deterministic: the same payload yields the same prompt', () => {
    expect(buildSubjectiveCheckPrompt(payload())).toBe(buildSubjectiveCheckPrompt(payload()))
  })
})

describe('buildSubjectiveCheckPrompt — different frozen lenses give different inputs', () => {
  it('two snapshots with different rules produce different prompts', () => {
    const a = payload()
    const b = payload({
      palette: ['black', 'white'],
      exclusions: [{ text: 'no beige', kind: 'ban', match: ['beige'] }],
    })
    const pa = buildSubjectiveCheckPrompt(a)
    const pb = buildSubjectiveCheckPrompt(b)
    expect(pa).not.toBe(pb)
    expect(pb).toContain('no beige')
    expect(pb).not.toContain('no fuchsia')
  })

  it('a different learned model or inspiration set changes the prompt', () => {
    const a = payload()
    const b = payload({ learned_model: { status: 'loaded', payload: { weights: [9, 9] }, version: 8, decision_count: 500 } })
    const c = payload({ inspiration: { confirmed_count: 0, images: [] } })
    expect(buildSubjectiveCheckPrompt(a)).not.toBe(buildSubjectiveCheckPrompt(b))
    expect(buildSubjectiveCheckPrompt(a)).not.toBe(buildSubjectiveCheckPrompt(c))
  })

  it('an absent learned model is stated explicitly, never silently omitted', () => {
    const prompt = buildSubjectiveCheckPrompt(
      payload({ learned_model: { status: 'absent', payload: null, version: null, decision_count: 0 } }),
    )
    expect(prompt).toMatch(/learned model.*absent/i)
  })
})
