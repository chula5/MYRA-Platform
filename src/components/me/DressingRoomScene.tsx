// The room itself, drawn: an arched mirror with a rail reflected in it, a
// wardrobe standing open beside it, and a bench with today's pieces folded on
// it. One stroke weight, MYRA's greys.
//
// Composed for a wide banner: the left third stays quiet for her name, the
// right for the YOUR LOOK card, and everything that matters sits in the middle
// band so it survives the crop at any height.

export default function DressingRoomScene({ className = '' }: { className?: string }) {
  const line = { fill: 'none', stroke: '#86837D', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  const soft = { fill: 'none', stroke: '#A9A59E', strokeWidth: 1.1, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  const faint = { fill: 'none', stroke: '#C2BEB7', strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

  /** A garment hanging from a rail at y, centred on x. */
  const hung = (x: number, y: number, h: number) =>
    `M${x} ${y}v4M${x - 5} ${y + 4}h10M${x - 9} ${y + 9}l4-5M${x + 9} ${y + 9}l-4-5`
    + `M${x - 9} ${y + 9}l-3 7 3 2 2-3v${h} h14 v${-h} l2 3 3-2-3-7`

  return (
    <svg viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      <defs>
        <linearGradient id="dr-wall" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#F7F7F8" />
          <stop offset="55%" stopColor="#EDEDEF" />
          <stop offset="100%" stopColor="#E3E3E6" />
        </linearGradient>
        <linearGradient id="dr-mirror" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="dr-light" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="1600" height="400" fill="url(#dr-wall)" />
      {/* Light falling across the floor, from the left */}
      <path d="M0 400l260-150h150L60 400z" fill="url(#dr-light)" />
      {/* Where the wall meets the floor */}
      <path d="M0 322h1600" {...faint} />

      {/* The wardrobe, standing open */}
      <g>
        <path d="M560 322V96h150v226" {...line} />
        <path d="M560 96l-56-16v226l56-14M710 96l56-16v226l-56-14" {...line} />
        <path d="M548 186v16M722 186v16" {...soft} />
        <path d="M578 124h114" {...soft} />
        <path d={hung(600, 124, 66)} {...faint} />
        <path d={hung(636, 124, 74)} {...faint} />
        <path d={hung(672, 124, 62)} {...faint} />
        <path d="M506 322v20M766 322v20" {...soft} />
      </g>

      {/* The arched mirror, lit, with a rail reflected in it */}
      <g>
        <path d="M860 322V176a100 100 0 0 1 200 0v146z" fill="url(#dr-mirror)" />
        <path d="M860 322V176a100 100 0 0 1 200 0v146" {...line} />
        <path d="M884 322V180a76 76 0 0 1 152 0v142" {...faint} />
        <path d="M918 232h84" {...faint} />
        <path d={hung(938, 232, 44)} {...faint} />
        <path d={hung(968, 232, 50)} {...faint} />
        <path d={hung(998, 232, 42)} {...faint} />
        {/* The pane's own shine */}
        <path d="M900 300l70-96M918 312l40-54" {...faint} />
      </g>

      {/* Wall light beside the mirror */}
      <rect x="806" y="150" width="11" height="86" rx="5.5" fill="#FFFFFF" stroke="#C9C6C0" strokeWidth="1.1" />
      <path d="M811 236v16" {...faint} />

      {/* The bench, with today's pieces folded on it */}
      <g>
        <path d="M1108 322v-52a30 30 0 0 1 30-30h190a30 30 0 0 1 30 30v52" {...line} />
        <path d="M1124 322v22M1342 322v22" {...line} />
        {/* A folded jumper, a folded coat, and a small bag */}
        <path d="M1152 240c0-16 14-26 34-26s34 10 34 26" {...soft} />
        <path d="M1152 240h68" {...soft} />
        <path d="M1240 240c0-12 12-20 28-20s28 8 28 20" {...soft} />
        <path d="M1240 240h56" {...soft} />
        <path d="M1310 240v-20h30v20z" {...soft} />
        <path d="M1318 220c0-9 4-14 7-14s7 5 7 14" {...soft} />
      </g>

      {/* A stem in a vase, off to the left */}
      <g>
        <path d="M430 322v-34a14 14 0 0 1 14-14h20a14 14 0 0 1 14 14v34" {...soft} />
        <path d="M454 274v-40M454 244c-12-4-18-14-18-26M454 250c12-6 16-16 16-28" {...faint} />
      </g>
    </svg>
  )
}
