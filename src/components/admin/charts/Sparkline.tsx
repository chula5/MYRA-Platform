import { INK } from './palette'

/**
 * A sparkline inside a metric tile is a GLYPH, not a chart — it shows shape,
 * not values. It carries no axes, no grid and no tooltip on purpose: the tile
 * direct-labels the current value, and clicking the tile opens the full
 * interactive chart with a crosshair, a table view and every number.
 *
 * Renders on the server; no client JS.
 */
export default function Sparkline({
  values,
  colour = INK.body,
  width = 132,
  height = 30,
  fill = true,
}: {
  values: number[]
  colour?: string
  width?: number
  height?: number
  fill?: boolean
}) {
  if (values.length < 2) {
    return <div style={{ width, height }} aria-hidden />
  }

  const max = Math.max(...values)
  const min = Math.min(...values)
  // A flat series still needs a line — put it through the middle rather than
  // dividing by a zero range.
  const span = max - min || 1
  const pad = 3
  const innerH = height - pad * 2

  const x = (i: number) => (i / (values.length - 1)) * width
  const y = (v: number) => pad + innerH - ((v - min) / span) * innerH

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`

  const lastX = x(values.length - 1)
  const lastY = y(values[values.length - 1])
  const gradientId = `spark-${colour.replace('#', '')}`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Trend across the last ${values.length} periods`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colour} stopOpacity="0.18" />
              <stop offset="100%" stopColor={colour} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      )}
      <path d={line} fill="none" stroke={colour} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* Endpoint marker — the "you are here" of a sparkline. */}
      <circle cx={lastX} cy={lastY} r={3} fill={colour} stroke="#FFFFFF" strokeWidth={2} />
    </svg>
  )
}
