// Read the stylist's EYE out of a frozen Quality Lab snapshot — pure, no I/O.
//
// A snapshot already freezes the stylist's learned Style Brain model, her
// reference-image envelope and every confirmed inspiration vector. Until now
// the generator ignored all of it and composed with the house composer alone,
// which is why the Lab's outfits looked the same for every stylist and never
// moved after a review. These helpers turn the frozen payload into the same
// PersonaLens / StyleModel shapes the pilot composer scores with, so the Lab
// composes through the identical lens — and a new Start picks up whatever the
// last round of YES/NO taught.

import type { SnapshotPayload } from '@/lib/outfit-quality/stylist-snapshot'
import type { PersonaLens } from '@/lib/pilot-composer'
import { isValidVector } from '@/lib/outfit-quality/stylist-snapshot'
import { sampleLooks } from '@/lib/inspiration'
import { PERSONA_START_WEIGHT } from '@/lib/user-persona'
import { emptyModel, type StyleModel } from '@/lib/style-brain'

/**
 * The stylist's reference-image lens from the frozen envelope + inspiration
 * vectors. Undefined when the snapshot is rules-only or has no usable
 * envelope — the composer then scores with rules alone, as before.
 */
export function personaLensFromSnapshot(payload: SnapshotPayload | null | undefined): PersonaLens | undefined {
  if (!payload || payload.rules_only) return undefined
  const env = (payload.envelope?.payload ?? null) as { mean?: unknown; spread?: unknown } | null
  const mean = Array.isArray(env?.mean) && env!.mean.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (env!.mean as number[]) : null
  if (!mean || mean.length === 0) return undefined
  const spread = Array.isArray(env?.spread) ? (env!.spread as number[]) : mean.map(() => 0)
  const vectors = (payload.inspiration?.images ?? [])
    .map((img) => img.vector)
    .filter((v): v is number[] => isValidVector(v))
  return {
    name: payload.stylist?.display_name ?? null,
    envelope: { mean, spread },
    weight: PERSONA_START_WEIGHT,
    looks: vectors.length ? sampleLooks(vectors) : null,
    reference: null,
    referenceLooks: null,
  }
}

/**
 * The stylist's own learned Style Brain model, frozen on the snapshot. Null
 * when she has none yet (`status: 'absent'`) — never borrowed from anyone.
 */
export function styleModelFromSnapshot(payload: SnapshotPayload | null | undefined): StyleModel | null {
  const lm = payload?.learned_model
  if (!lm || lm.status !== 'loaded') return null
  const m = lm.payload as Partial<StyleModel> | null
  if (!m || typeof m !== 'object' || !m.version) return null
  return {
    ...emptyModel(),
    ...m,
    singles: m.singles ?? {},
    pairs: m.pairs ?? {},
    offers: (m as any).offers ?? {},
    offerCount: (m as any).offerCount ?? 0,
  } as StyleModel
}
