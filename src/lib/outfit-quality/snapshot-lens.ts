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
import { HOUSE_LENS_WEIGHT } from '@/lib/pilot-composer'

/**
 * The house layer of the lens: Chloe's frozen envelope and looks, at the house
 * weight. Undefined when the snapshot froze no house base (the selected
 * stylist IS the house) or the base has no usable envelope.
 */
export function houseLensFromSnapshot(payload: SnapshotPayload | null | undefined): NonNullable<PersonaLens['house']> | undefined {
  const env = payload?.house_base?.envelope
  if (!env || !isValidVector(env.mean)) return undefined
  const spread = isValidVector(env.spread) ? env.spread : env.mean.map(() => 0)
  const looks = (env.looks ?? []).filter((v) => isValidVector(v))
  return { envelope: { mean: env.mean, spread }, looks: looks.length ? sampleLooks(looks) : null, weight: HOUSE_LENS_WEIGHT }
}

/**
 * The stylist's lens, in layers: her own reference-image envelope + inspiration
 * vectors (absent when the snapshot is rules-only or has no usable envelope),
 * and the house underneath (houseLensFromSnapshot). Undefined only when there
 * is neither — the composer then scores with rules alone.
 */
export function personaLensFromSnapshot(payload: SnapshotPayload | null | undefined): PersonaLens | undefined {
  if (!payload) return undefined
  const house = houseLensFromSnapshot(payload) ?? null
  let envelope: { mean: number[]; spread: number[] } | null = null
  let looks: number[][] | null = null
  if (!payload.rules_only) {
    const env = (payload.envelope?.payload ?? null) as { mean?: unknown; spread?: unknown } | null
    const mean = Array.isArray(env?.mean) && env!.mean.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (env!.mean as number[]) : null
    if (mean && mean.length > 0) {
      envelope = { mean, spread: Array.isArray(env?.spread) ? (env!.spread as number[]) : mean.map(() => 0) }
      const vectors = (payload.inspiration?.images ?? [])
        .map((img) => img.vector)
        .filter((v): v is number[] => isValidVector(v))
      looks = vectors.length ? sampleLooks(vectors) : null
    }
  }
  if (!envelope && !house) return undefined
  return {
    name: payload.stylist?.display_name ?? null,
    envelope,
    weight: PERSONA_START_WEIGHT,
    looks,
    reference: null,
    referenceLooks: null,
    house,
  }
}

/**
 * THE HOUSE BASE model frozen on the snapshot — Chloe's learned Style Brain,
 * the base this stylist's own model (styleModelFromSnapshot) narrows from.
 * Null when the snapshot froze no base (the stylist IS Chloe) or it is absent.
 */
export function houseBaseModelFromSnapshot(payload: SnapshotPayload | null | undefined): StyleModel | null {
  const hb = payload?.house_base
  if (!hb) return null
  return modelFromFrozen(hb.model)
}

/**
 * The stylist's own learned Style Brain model, frozen on the snapshot. Null
 * when she has none yet (`status: 'absent'`) — never borrowed from anyone.
 */
export function styleModelFromSnapshot(payload: SnapshotPayload | null | undefined): StyleModel | null {
  return modelFromFrozen(payload?.learned_model)
}

function modelFromFrozen(lm: SnapshotPayload['learned_model'] | null | undefined): StyleModel | null {
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
