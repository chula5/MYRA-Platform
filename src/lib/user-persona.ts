// ── SOFT PERSONA ASSIGNMENT ─────────────────────────────────────────────────
//
// A client is assigned to a persona, not filed under it. The assignment starts
// strong (0.9) and decays as she behaves, floored at 0.3:
//
//   weight = max(0.3, 0.9 − 0.02 × behavioural_event_count)
//
// Recomputed after every 10 taste events. At 30 behavioural events the persona
// is already down to 0.3 and her own vector carries the rest — which is the
// intent: the persona is a prior for session one, not an identity.
//
// Only BEHAVIOURAL events decay it. Inspiration uploads are aspirational and
// deliberately excluded — otherwise uploading things she admires would push her
// away from the persona she was matched to, which is backwards.

export const PERSONA_START_WEIGHT = 0.9
export const PERSONA_FLOOR_WEIGHT = 0.3
export const PERSONA_DECAY_PER_EVENT = 0.02
export const RECOMPUTE_EVERY = 10

/** Events that count as behaviour. Uploads are aspirational — never here. */
export const BEHAVIOURAL_EVENTS = [
  'like', 'dislike', 'save', 'shop_click', 'skip',
  'style_tap', 'source_tap', 'similar_tap', 'explore_tap',
] as const

export const ASPIRATIONAL_EVENTS = ['inspiration_upload'] as const

export function poolFor(eventType: string): 'behavioural' | 'aspirational' {
  return (ASPIRATIONAL_EVENTS as readonly string[]).includes(eventType) ? 'aspirational' : 'behavioural'
}

export function personaWeight(behaviouralEventCount: number): number {
  const w = PERSONA_START_WEIGHT - PERSONA_DECAY_PER_EVENT * Math.max(0, behaviouralEventCount)
  return +Math.max(PERSONA_FLOOR_WEIGHT, w).toFixed(4)
}

/** Recompute only on the 10-event boundary, so this can be called freely. */
export function shouldRecompute(totalEventCount: number): boolean {
  return totalEventCount > 0 && totalEventCount % RECOMPUTE_EVERY === 0
}

/**
 * Blend the persona's envelope centre with her own taste vector by the current
 * weight. Early on the persona leads; as she behaves, she does.
 */
export function blendedVector(
  personaMean: number[] | null,
  personalVector: number[] | null,
  weight: number,
): number[] | null {
  if (!personaMean?.length && !personalVector?.length) return null
  if (!personaMean?.length) return personalVector
  if (!personalVector?.length) return personaMean
  const n = Math.min(personaMean.length, personalVector.length)
  const out = new Array(n)
  for (let i = 0; i < n; i++) out[i] = weight * personaMean[i] + (1 - weight) * personalVector[i]
  return out
}

/**
 * How far an image sits outside the persona envelope, per dimension and in
 * total. Zero means fully inside. This is what the admin disagreement view
 * ranks on — the uploads that argue with the persona are the pilot's real
 * output, because they say where the assignment was wrong.
 */
export function envelopeDistance(
  vector: number[] | null,
  envelope: { mean: number[]; spread: number[] } | null,
  constrainedDims: number[],
): { total: number; worst: { dim: number; sigma: number }[] } {
  if (!vector?.length || !envelope?.mean?.length) return { total: 0, worst: [] }
  const per: { dim: number; sigma: number }[] = []
  let total = 0
  for (const i of constrainedDims) {
    const spread = envelope.spread[i] ?? 0
    // A dimension the persona is unanimous about still needs a scale to divide
    // by, or every tiny difference reads as infinitely far away.
    const denom = Math.max(spread, 0.125)
    const sigma = Math.abs((vector[i] ?? 0) - (envelope.mean[i] ?? 0)) / denom
    per.push({ dim: i, sigma: +sigma.toFixed(3) })
    total += sigma
  }
  per.sort((a, b) => b.sigma - a.sigma)
  return { total: +(total / Math.max(1, constrainedDims.length)).toFixed(3), worst: per.slice(0, 4) }
}
