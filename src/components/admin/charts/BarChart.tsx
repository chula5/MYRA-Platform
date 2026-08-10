'use client'

import { useState } from 'react'
import { INK, SERIES } from './palette'
import { resolveFormat, type FormatKind } from './format'

/**
 * Vertical bars over a time axis — for counts per period, where the question is
 * "how much in each bucket", not "what shape is the trend".
 *
 * Bars are anchored to the baseline with rounded top ends only; a bar rounded at
 * both ends floats off its own zero and misreads its magnitude. Adjacent bars
 * carry a 2px surface gap.
 */
export default function BarChart({
  labels,
  values,
  height = 180,
  colour = SERIES[0],
  format: formatKind = 'count',
  highlightLast = true,
}: {
  labels: string[]
  values: number[]
  height?: number
  colour?: string
  format?: FormatKind
  highlightLast?: boolean
}) {
  const format = resolveFormat(formatKind)
  const [hover, setHover] = useState<number | null>(null)

  const n = values.length
  const max = Math.max(1, ...values)
  const PAD = { top: 18, bottom: 22 }
  const innerH = height - PAD.top - PAD.bottom
  // Percent-based geometry so the chart is fluid without a resize observer.
  const slot = 100 / Math.max(1, n)
  const barW = Math.max(2, slot * 0.62)

  return (
    <div className="relative" style={{ height }}>
      <div className="absolute inset-0 flex items-end" onMouseLeave={() => setHover(null)}>
        {values.map((v, i) => {
          const h = (v / max) * innerH
          const active = hover === i || (hover === null && highlightLast && i === n - 1)
          return (
            <div
              key={`${labels[i]}-${i}`}
              className="relative flex flex-col items-center justify-end"
              style={{ width: `${slot}%`, height }}
              onMouseEnter={() => setHover(i)}
            >
              {/* Full-height hit target — bigger than the mark, per interaction spec. */}
              <div
                className="rounded-t-[4px] transition-opacity duration-200"
                style={{
                  width: `${barW}%`,
                  minWidth: 3,
                  height: Math.max(v > 0 ? 2 : 0, h),
                  marginBottom: PAD.bottom,
                  background: colour,
                  opacity: active ? 1 : 0.45,
                  boxShadow: `0 0 0 2px ${'#FFFFFF'}`,
                }}
              />
              <span
                className="absolute bottom-0 text-[8px] tracking-[0.09em] whitespace-nowrap"
                style={{ color: active ? INK.body : INK.faint }}
              >
                {labels[i]}
              </span>
              {active && (
                <span
                  className="absolute text-[10px] tracking-[0.045em] whitespace-nowrap"
                  style={{ color: INK.primary, bottom: PAD.bottom + Math.max(2, h) + 6 }}
                >
                  {format(v)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
