import type { TasteAxis } from '@/lib/style-brain-store'

// A spider/radar chart of the site's taste profile across labelled axes. Two
// overlaid polygons: CATALOGUE (what you've built) and, optionally, PEOPLE
// (view-weighted — what visitors gravitate to). Pure SVG, server-rendered.
export default function TasteRadar({ axes, hasPeople }: { axes: TasteAxis[]; hasPeople: boolean }) {
  const N = axes.length
  if (N < 3) return null
  const size = 380
  const c = size / 2
  const maxR = c - 66 // leave room for labels

  const pointAt = (i: number, value: number) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / N
    const r = maxR * Math.max(0, Math.min(1, value))
    return [c + r * Math.cos(angle), c + r * Math.sin(angle)]
  }
  const polygon = (key: 'catalogue' | 'people') =>
    axes.map((a, i) => pointAt(i, a[key]).map((n) => n.toFixed(1)).join(',')).join(' ')

  const rings = [0.25, 0.5, 0.75, 1]

  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[420px]">
        {/* rings */}
        {rings.map((r) => (
          <circle key={r} cx={c} cy={c} r={maxR * r} fill="none" stroke="#EDEBE6" strokeWidth="1" />
        ))}
        {/* spokes + labels */}
        {axes.map((a, i) => {
          const [x, y] = pointAt(i, 1)
          const [lx, ly] = pointAt(i, 1.18)
          const anchor = Math.abs(lx - c) < 8 ? 'middle' : lx > c ? 'start' : 'end'
          return (
            <g key={a.label}>
              <line x1={c} y1={c} x2={x} y2={y} stroke="#EDEBE6" strokeWidth="1" />
              <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" className="fill-[#6B6B6B]" style={{ fontSize: 8, letterSpacing: '0.05em' }}>
                {a.label}
              </text>
            </g>
          )
        })}
        {/* catalogue polygon */}
        <polygon points={polygon('catalogue')} fill="rgba(196,168,130,0.28)" stroke="#C4A882" strokeWidth="1.5" />
        {/* people polygon */}
        {hasPeople && <polygon points={polygon('people')} fill="rgba(74,78,87,0.12)" stroke="#4A4E57" strokeWidth="1.5" strokeDasharray="4 3" />}
      </svg>
      <div className="flex items-center gap-5 mt-2">
        <span className="flex items-center gap-1.5 text-[9px] tracking-[0.08em] text-[#6B6B6B]">
          <span className="w-3 h-[2px] bg-[#C4A882] inline-block" /> CATALOGUE
        </span>
        {hasPeople && (
          <span className="flex items-center gap-1.5 text-[9px] tracking-[0.08em] text-[#6B6B6B]">
            <span className="w-3 h-[2px] bg-[#4A4E57] inline-block" style={{ borderTop: '2px dashed #4A4E57' }} /> WHAT PEOPLE VIEW
          </span>
        )}
      </div>
    </div>
  )
}
