import { STATUS, deltaTone } from './palette'

/**
 * Period-over-period change. Colour is never the only signal — the arrow
 * glyph and the number carry the meaning on their own.
 *
 * `inverted` marks metrics where a fall is the good outcome (swap rate,
 * error rate, cost per sign-up).
 */
export default function DeltaChip({
  delta,
  inverted = false,
  suffix = '%',
  note,
}: {
  /** Fractional change, e.g. 0.12 for +12%. Null when there's no prior period. */
  delta: number | null
  inverted?: boolean
  suffix?: string
  note?: string
}) {
  if (delta === null || !Number.isFinite(delta)) {
    return (
      <span className="text-[9px] tracking-[0.09em] text-[#C9C7C2]">
        NO PRIOR PERIOD
      </span>
    )
  }

  const tone = deltaTone(delta, inverted)
  const colour = STATUS[tone]
  const pct = Math.round(Math.abs(delta) * 100)
  const glyph = Math.abs(delta) < 0.0001 ? '→' : delta > 0 ? '↑' : '↓'

  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] tracking-[0.09em]"
      style={{ color: colour }}
    >
      <span aria-hidden>{glyph}</span>
      <span>
        {pct}
        {suffix}
      </span>
      {note && <span className="text-[#A8A8A4]">{note}</span>}
    </span>
  )
}
