// Pure: blend MYRA's read of one piece into one number she can trust.
// brand .35 · piece .40 · size .15 · wardrobe .10. A component she has not
// given us (no sizes, no wardrobe) hands its weight to brand and piece rather
// than counting against her.

export interface TakeComponents { brand: number; piece: number; size: number | null; wardrobe: number | null }

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export function blendConfidence(c: TakeComponents): number {
  let wb = 0.35, wp = 0.40, ws = 0.15, ww = 0.10
  if (c.size == null) { wb += ws * 0.5; wp += ws * 0.5; ws = 0 }
  if (c.wardrobe == null) { wb += ww * 0.4; wp += ww * 0.6; ww = 0 }
  const v = wb * c.brand + wp * c.piece + ws * (c.size ?? 0) + ww * (c.wardrobe ?? 0)
  return Math.round(100 * clamp01(v))
}
