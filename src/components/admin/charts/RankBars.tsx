import { INK, SERIES } from './palette'

export interface RankRow {
  label: string
  value: number
  /** Optional secondary figure shown to the right of the value (e.g. "12 CLICKS"). */
  note?: string
  href?: string
  colour?: string
}

/**
 * Ranked horizontal bars — the right form for "which of these is biggest",
 * where the categories are named things rather than points in time.
 *
 * Every row is direct-labelled with its name AND its value, so the bar length is
 * a fast read rather than the only read. Renders on the server.
 */
export default function RankBars({
  rows,
  format = (n) => String(Math.round(n)),
  colour = SERIES[0],
  empty = 'NOTHING YET',
  max: maxOverride,
}: {
  rows: RankRow[]
  format?: (n: number) => string
  colour?: string
  empty?: string
  max?: number
}) {
  if (!rows.length) {
    return <p className="text-[10px] tracking-[0.09em] text-[#C9C7C2]">{empty}</p>
  }

  const max = maxOverride ?? Math.max(1, ...rows.map((r) => r.value))

  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-[10px] tracking-[0.054em] text-[#4A4E57] truncate">{r.label}</span>
              <span className="text-[10px] tracking-[0.045em] text-[#0A0A0A] flex-shrink-0">
                {format(r.value)}
                {r.note && <span className="text-[9px] text-[#A8A8A4] ml-2">{r.note}</span>}
              </span>
            </div>
            <div className="h-[6px] rounded-[3px] bg-[#F2F2F0] overflow-hidden">
              <div
                className="h-full rounded-[3px]"
                style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.colour ?? colour }}
              />
            </div>
          </>
        )

        if (r.href) {
          return (
            <a key={`${r.label}-${i}`} href={r.href} className="block group">
              {body}
            </a>
          )
        }
        return <div key={`${r.label}-${i}`}>{body}</div>
      })}
    </div>
  )
}

/**
 * A single stacked bar showing how a total splits between a handful of named
 * parts. Each segment is direct-labelled underneath, and segments are separated
 * by a 2px surface gap so adjacent fills never blend into one another.
 */
export function ShareBar({
  parts,
  format = (n) => String(Math.round(n)),
}: {
  parts: { label: string; value: number; colour: string }[]
  format?: (n: number) => string
}) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  if (total <= 0) {
    return <p className="text-[10px] tracking-[0.09em] text-[#C9C7C2]">NOTHING TO SPLIT YET</p>
  }

  return (
    <div>
      <div className="flex h-[10px] rounded-[5px] overflow-hidden" style={{ background: INK.grid, gap: 2 }}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div
              key={p.label}
              style={{ width: `${(p.value / total) * 100}%`, background: p.colour }}
              title={`${p.label}: ${format(p.value)}`}
            />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-baseline gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full translate-y-[-1px]" style={{ background: p.colour }} aria-hidden />
            <span className="text-[9px] tracking-[0.09em] text-[#6B6B6B]">{p.label}</span>
            <span className="text-[9px] tracking-[0.045em] text-[#0A0A0A]">{format(p.value)}</span>
            <span className="text-[9px] tracking-[0.045em] text-[#C9C7C2]">
              {total > 0 ? `${Math.round((p.value / total) * 100)}%` : ''}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
