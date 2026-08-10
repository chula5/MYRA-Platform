'use client'

import { useMemo, useRef, useState } from 'react'
import { INK, SERIES } from './palette'
import { resolveFormat, type FormatKind } from './format'

/**
 * Round a raw axis step up to the nearest 1 / 2 / 2.5 / 5 / 10 × 10^k, so the
 * gridlines land on numbers a person would have chosen. Count axes never step
 * below 1 — there is no such thing as half a click.
 */
function niceStep(raw: number, integerOnly = false): number {
  if (!Number.isFinite(raw) || raw <= 0) return integerOnly ? 1 : 0.1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const snapped = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  const step = snapped * mag
  return integerOnly ? Math.max(1, Math.round(step)) : step
}

export interface TrendSeries {
  name: string
  values: number[]
  /** Overrides the slot colour — used when a series has a fixed identity (a network). */
  colour?: string
}

/**
 * Line / area chart over a time axis, with a crosshair and a tooltip.
 *
 * One y-axis only, always. Two measures at different scales get two charts,
 * never a second axis.
 *
 * Colour is assigned by SERIES slot order and follows the ENTITY, not its rank —
 * filtering a series out never repaints the survivors, because the colour comes
 * from the series' own index in the array it was given.
 */
export default function TrendChart({
  labels,
  series,
  height = 200,
  // A tag rather than a function: server components render this page, and a
  // function can't cross the server/client boundary.
  format: formatKind = 'count',
  showTable = true,
  zeroBaseline = true,
}: {
  labels: string[]
  series: TrendSeries[]
  height?: number
  format?: FormatKind
  showTable?: boolean
  zeroBaseline?: boolean
}) {
  const format = resolveFormat(formatKind)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [tableOpen, setTableOpen] = useState(false)

  const W = 1000
  const H = height
  const PAD = { top: 14, right: 46, bottom: 24, left: 44 }

  // Axis bounds land on round numbers rather than whatever the data happened to
  // peak at — "0 / 10 / 20 / 30" is readable, "0 / 10.8 / 21.7 / 32.5" is not.
  const { max, min, step } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v))
    const hi = all.length ? Math.max(...all) : 1
    const lo = zeroBaseline ? Math.min(0, ...all) : all.length ? Math.min(...all) : 0
    const span = hi === lo ? Math.abs(hi) || 1 : hi - lo
    const raw = niceStep(span / 3, formatKind === 'count')
    let top = lo + Math.max(1, Math.ceil((hi - lo) / raw)) * raw
    // A peak sitting exactly on the frame reads as clipped — give it one step.
    if (top <= hi) top += raw
    return { max: top, min: lo, step: raw }
  }, [series, zeroBaseline, formatKind])

  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const n = labels.length

  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min || 1)) * innerH

  // Four gridlines is enough structure to read a value off; more is noise.
  const ticks = useMemo(() => {
    const out: number[] = []
    for (let v = min; v <= max + step / 2; v += step) out.push(Number(v.toFixed(6)))
    return out.slice(0, 6)
  }, [min, max, step])

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || n === 0) return
    const rel = ((e.clientX - rect.left) / rect.width) * W
    const clamped = Math.max(PAD.left, Math.min(W - PAD.right, rel))
    const idx = n <= 1 ? 0 : Math.round(((clamped - PAD.left) / innerW) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, idx)))
  }

  const colourOf = (s: TrendSeries, i: number) => s.colour ?? SERIES[i % SERIES.length]
  const multi = series.length > 1

  return (
    <div>
      {/* Legend — always present for two or more series, so identity is never
          carried by colour alone. A single series is named by the title above. */}
      {multi && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mb-3">
          {series.map((s, i) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: colourOf(s, i) }}
                aria-hidden
              />
              <span className="text-[9px] tracking-[0.09em] text-[#6B6B6B]">{s.name}</span>
            </span>
          ))}
        </div>
      )}

      <div
        ref={wrapRef}
        className="relative"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" preserveAspectRatio="none">
          {/* Recessive grid — present enough to read against, quiet enough to ignore. */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke={INK.grid}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(t) + 3}
                textAnchor="end"
                fontSize={9}
                letterSpacing="0.06em"
                fill={INK.muted}
              >
                {format(t)}
              </text>
            </g>
          ))}

          {/* Crosshair sits under the marks so it never obscures a value. */}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke={INK.border}
              strokeWidth={1}
            />
          )}

          {series.map((s, si) => {
            const c = colourOf(s, si)
            const pts = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
            const gid = `trend-fill-${si}-${c.replace('#', '')}`
            return (
              <g key={s.name}>
                {/* The single-series case gets a fill; stacked fills would read
                    as area-on-area and lie about magnitude. */}
                {series.length === 1 && (
                  <>
                    <defs>
                      <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={c} stopOpacity="0.16" />
                        <stop offset="100%" stopColor={c} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={`${pts} L${x(n - 1)},${PAD.top + innerH} L${x(0)},${PAD.top + innerH} Z`} fill={`url(#${gid})`} />
                  </>
                )}
                <path d={pts} fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                {/* Direct end label — the relief that discharges the low-contrast
                    warning on the aqua slot, and the fastest way to read "now". */}
                {n > 0 && (
                  <text
                    x={x(n - 1) + 8}
                    y={y(s.values[n - 1]) + 3}
                    fontSize={9}
                    letterSpacing="0.06em"
                    fill={INK.body}
                  >
                    {format(s.values[n - 1])}
                  </text>
                )}
                {hover !== null && (
                  <circle
                    cx={x(hover)}
                    cy={y(s.values[hover])}
                    r={4.5}
                    fill={c}
                    stroke="#FFFFFF"
                    strokeWidth={2}
                  />
                )}
              </g>
            )
          })}

          {/* First / middle / last x labels only — a label under every point is
              unreadable at this width. */}
          {[0, Math.floor((n - 1) / 2), n - 1]
            .filter((i, idx, arr) => i >= 0 && arr.indexOf(i) === idx)
            .map((i) => (
              <text
                key={i}
                x={x(i)}
                y={H - 6}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                fontSize={9}
                letterSpacing="0.09em"
                fill={INK.muted}
              >
                {labels[i]}
              </text>
            ))}
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-1 bg-white border border-[#E2E0DB] rounded-[8px] px-3 py-2 shadow-[0_2px_12px_rgba(0,0,0,0.07)]"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              transform: hover > n / 2 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
            }}
          >
            <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-1">{labels[hover]}</p>
            {series.map((s, i) => (
              <p key={s.name} className="text-[10px] tracking-[0.045em] text-[#0A0A0A] whitespace-nowrap">
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                  style={{ background: colourOf(s, i) }}
                  aria-hidden
                />
                {multi ? `${s.name} · ` : ''}
                {format(s.values[hover])}
              </p>
            ))}
          </div>
        )}
      </div>

      {showTable && (
        <div className="mt-3">
          <button
            onClick={() => setTableOpen((v) => !v)}
            className="text-[9px] tracking-[0.14em] text-[#A8A8A4] hover:text-[#4A4E57] transition-colors duration-300"
          >
            {tableOpen ? 'HIDE TABLE' : 'TABLE VIEW'}
          </button>
          {tableOpen && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="text-[9px] tracking-[0.14em] text-[#A8A8A4] font-normal py-2 pr-4 border-b border-[#E2E0DB]">PERIOD</th>
                    {series.map((s) => (
                      <th key={s.name} className="text-[9px] tracking-[0.14em] text-[#A8A8A4] font-normal py-2 pr-4 border-b border-[#E2E0DB]">
                        {s.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {labels.map((l, i) => (
                    <tr key={l + i}>
                      <td className="text-[10px] tracking-[0.045em] text-[#6B6B6B] py-1.5 pr-4 border-b border-[#F2F2F0]">{l}</td>
                      {series.map((s) => (
                        <td key={s.name} className="text-[10px] tracking-[0.045em] text-[#0A0A0A] py-1.5 pr-4 border-b border-[#F2F2F0]">
                          {format(s.values[i])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
