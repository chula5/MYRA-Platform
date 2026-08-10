import Sparkline from './Sparkline'
import DeltaChip from './DeltaChip'
import { INK, STATUS, SERIES } from './palette'

/**
 * The headline unit of the dashboard: one number, its movement, its shape, and
 * a way in. The whole tile is the click target — every metric on the dashboard
 * opens the area it came from.
 */
export default function MetricTile({
  label,
  value,
  sub,
  href,
  delta,
  deltaInverted = false,
  series,
  colour = SERIES[0],
  tone,
  large = false,
}: {
  label: string
  value: string
  /** The line under the number — what it is measured over, or a breakdown. */
  sub?: string
  href: string
  delta?: number | null
  deltaInverted?: boolean
  series?: number[]
  colour?: string
  /** Forces a status colour on the number — for thresholds that have been crossed. */
  tone?: keyof typeof STATUS
  large?: boolean
}) {
  return (
    <a
      href={href}
      className="
        group relative block bg-white border border-[#E2E0DB] rounded-[14px] p-5
        transition-all duration-300
        hover:border-[#0A0A0A] hover:shadow-[0_2px_18px_rgba(0,0,0,0.06)]
      "
    >
      {/* Identity stripe — the tile's series colour, so a metric and its chart
          read as the same thing at a glance. */}
      <span
        className="absolute left-5 top-0 h-[3px] w-8 rounded-b-[2px] opacity-70 group-hover:opacity-100 transition-opacity"
        style={{ background: colour }}
        aria-hidden
      />

      <p className="text-[9px] tracking-[0.14em] text-[#6B6B6B] mb-3 mt-1">{label}</p>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p
            className="tracking-[0.02em] leading-none"
            style={{ fontSize: large ? 40 : 30, color: tone ? STATUS[tone] : INK.body }}
          >
            {value}
          </p>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {delta !== undefined && <DeltaChip delta={delta ?? null} inverted={deltaInverted} />}
            {sub && <span className="text-[9px] tracking-[0.054em] text-[#A8A8A4]">{sub}</span>}
          </div>
        </div>

        {series && series.length > 1 && (
          <div className="flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
            <Sparkline values={series} colour={colour} width={large ? 150 : 110} height={large ? 40 : 30} />
          </div>
        )}
      </div>

      <span className="absolute right-5 top-5 text-[11px] text-[#C9C7C2] group-hover:text-[#0A0A0A] transition-colors duration-300">
        →
      </span>
    </a>
  )
}
