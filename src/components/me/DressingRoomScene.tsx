// The room itself, drawn: an arched mirror with its light, a bench with today's
// pieces folded on it, a rail behind. One stroke weight, MYRA's greys, no
// photography to source or license, and it scales to any width.

export default function DressingRoomScene({ className = '' }: { className?: string }) {
  const line = { fill: 'none', stroke: '#8E8B85', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  const soft = { fill: 'none', stroke: '#B4B0A8', strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

  return (
    <svg viewBox="0 0 1200 380" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      <defs>
        <linearGradient id="room" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#F6F6F7" />
          <stop offset="60%" stopColor="#ECECEE" />
          <stop offset="100%" stopColor="#E2E2E5" />
        </linearGradient>
        <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      <rect width="1200" height="380" fill="url(#room)" />
      {/* Where the wall meets the floor */}
      <path d="M0 292h1200" {...soft} />

      {/* The arched mirror, lit */}
      <path d="M560 292V150a90 90 0 0 1 180 0v142z" fill="url(#glow)" />
      <path d="M560 292V150a90 90 0 0 1 180 0v142" {...line} />
      <path d="M596 292V156a54 54 0 0 1 108 0v136" {...soft} />
      {/* What the mirror holds: a rail of her clothes */}
      <path d="M612 196h80" {...soft} />
      <path d="M628 196v10l-6 34h12l-6-34v-10M652 196v10l-6 34h12l-6-34v-10M676 196v10l-6 34h12l-6-34v-10" {...soft} />

      {/* Wall light */}
      <rect x="486" y="120" width="10" height="72" rx="5" fill="#FFFFFF" stroke="#C9C6C0" strokeWidth="1" />

      {/* Bench, with today's pieces folded on it */}
      <path d="M404 292v-36a26 26 0 0 1 26-26h188a26 26 0 0 1 26 26v36" {...line} />
      <path d="M418 292v22M630 292v22" {...line} />
      <path d="M452 230c14-16 42-20 60-8" {...soft} />
      <path d="M470 222l10-14 18 6 10-8" {...soft} />
      <rect x="520" y="206" width="70" height="22" rx="4" {...soft} />
      <path d="M540 206c0-8 8-12 15-12s15 4 15 12" {...soft} />

      {/* A stem in a vase, and the bench opposite */}
      <path d="M300 292v-26h120v26" {...soft} />
      <path d="M346 266v-22M346 244c-10-4-14-12-14-22M346 244c10-6 12-14 12-24" {...soft} />
      <path d="M334 266a12 12 0 0 1 24 0z" {...line} />

      {/* Rail on the right, and the light falling across the floor */}
      <path d="M880 140h150M892 140v112M1018 140v112M876 252h32M1002 252h32" {...soft} />
      <path d="M918 140v10l-7 44h14l-7-44v-10M948 140v10l-7 44h14l-7-44v-10M978 140v10l-7 44h14l-7-44v-10" {...soft} />
      <path d="M120 380l180-88M60 380l180-88" stroke="#FFFFFF" strokeWidth="26" strokeLinecap="round" opacity="0.5" fill="none" />
    </svg>
  )
}
