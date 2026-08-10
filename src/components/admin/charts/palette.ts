// Chart palette for the admin studio.
//
// MYRA's public surfaces are near-monochrome by design. The admin studio is
// internal chrome, so it carries a small amount of colour — but only where
// colour does a job (telling series apart, flagging state), never as decoration.
//
// The categorical set below was validated with the data-viz palette checker
// against the admin surface #FAFAF8, all-pairs (not just adjacent), light mode:
//
//   lightness band  PASS
//   chroma floor    PASS (all >= 0.1)
//   CVD separation  PASS (worst all-pairs deutan dE 8.9, tritan 9.6)
//   normal vision   PASS (worst all-pairs dE 19.1)
//   contrast        WARN — AQUA is 2.69:1 on #FAFAF8
//
// The contrast WARN is discharged by relief, not ignored: every chart that uses
// AQUA ships a direct label or the table view underneath it. Do not reorder or
// extend these four without re-running the validator — the ORDER is the
// colourblind-safety mechanism, not a preference.
//
// MYRA does not support dark mode, so there is one set of steps only.

export const SURFACE = '#FAFAF8'
export const SURFACE_CARD = '#FFFFFF'

/** Categorical slots. Assign in fixed order; never cycle, never generate a 5th. */
export const SERIES = ['#B0782A', '#2A78D6', '#A8326E', '#1BAF7A'] as const
export type SeriesColor = (typeof SERIES)[number]

/** Affiliate networks get fixed slots so a colour always means the same network. */
export const NETWORK_COLOR: Record<string, string> = {
  awin: SERIES[0],
  rakuten: SERIES[1],
  cj: SERIES[2],
  direct: SERIES[3],
}

export const NETWORK_LABEL: Record<string, string> = {
  awin: 'AWIN',
  rakuten: 'RAKUTEN',
  cj: 'CJ',
  direct: 'DIRECT',
}

/**
 * Status colours are reserved. They never stand in for "series 5", and they
 * never carry meaning on their own — always paired with a word.
 */
export const STATUS = {
  good: '#1B7F4B',
  warning: '#B0782A',
  critical: '#B83A3A',
  neutral: '#6B6B6B',
} as const

/** Ink + chrome, matching the rest of the admin studio. */
export const INK = {
  primary: '#0A0A0A',
  body: '#4A4E57',
  secondary: '#6B6B6B',
  muted: '#A8A8A4',
  faint: '#C9C7C2',
  grid: '#EDEBE6',
  border: '#E2E0DB',
  accent: '#C4A882',
} as const

/** Single-hue sequential ramp for magnitude (heat cells, intensity fills). */
export const SEQUENTIAL = ['#EFE3CE', '#DFC6A0', '#CFAA73', '#B0782A', '#7E5518'] as const

/**
 * Direction of a change, for delta chips. `inverted` flips the colouring for
 * metrics where down is good (swap rate, error rate, cost per signup).
 */
export function deltaTone(delta: number, inverted = false): keyof typeof STATUS {
  if (Math.abs(delta) < 0.0001) return 'neutral'
  const up = delta > 0
  const good = inverted ? !up : up
  return good ? 'good' : 'critical'
}
