/**
 * White or cream — read from the colour itself, not the label.
 *
 * The colour_family label is not reliable at the pale end: the halter top,
 * wide-leg trousers and blazer in Alison's all-"cream" looks measure L 95–96
 * with b* 2.4–3.4, which is white. Optic white sits at b* ≈ 0 (library median
 * 0.0); genuine cream is warm (library median b* 11.1). So a white-with-cream
 * clash can hide entirely inside the "cream" label, and a label-only rule
 * never fires on the looks it exists to stop.
 */

export type PaleTone = 'white' | 'cream'

/** b* at or above this reads as cream; below it, white. */
export const CREAM_MIN_B = 5
/** Pale enough to count at all. Below this it is a beige/sand/stone, not white or cream. */
export const PALE_MIN_L = 85

function hexToLab(hex: string): { L: number; b: number } | null {
  const h = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  const lin = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const [r, g, bl] = lin
  const Y = r * 0.2126 + g * 0.7152 + bl * 0.0722
  const Z = (r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return { L: 116 * f(Y) - 16, b: 200 * (f(Y) - f(Z)) }
}

/**
 * The pale tone of a piece, or null if it is not white or cream.
 * Hex wins when present; the label is only a fallback.
 */
export function paleTone(item: { colour_family?: string | null; colour_hex?: string | null }): PaleTone | null {
  const fam = (item.colour_family ?? '').toLowerCase()
  const lab = item.colour_hex ? hexToLab(item.colour_hex) : null
  if (lab) {
    if (lab.L < PALE_MIN_L) return null
    return lab.b >= CREAM_MIN_B ? 'cream' : 'white'
  }
  if (fam === 'white') return 'white'
  if (fam === 'cream') return 'cream'
  return null
}

/** True when the look puts white and cream together — Chloe's rule: they do not go. */
export function mixesWhiteAndCream(items: { colour_family?: string | null; colour_hex?: string | null }[]): boolean {
  let white = false
  let cream = false
  for (const it of items) {
    const t = paleTone(it)
    if (t === 'white') white = true
    if (t === 'cream') cream = true
    if (white && cream) return true
  }
  return false
}
