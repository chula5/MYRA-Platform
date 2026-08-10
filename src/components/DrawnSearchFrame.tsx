'use client'

// DRAWN SEARCH FRAME — the search field as a hand-drawn box: a wobbling grey
// outline with a filled block at the right holding a sketched magnifier.
//
// The wobble is baked into the path (fixed offsets, not random) so the line is
// identical on the server and the client, then a light turbulence displacement
// adds the last bit of marker-pen unevenness. `vector-effect: non-scaling-stroke`
// keeps the line the same weight however wide the box gets, and
// preserveAspectRatio="none" lets the frame stretch to any container.

import { useId } from 'react'

const STROKE = '#6E7278'
const BLOCK = '#9EA29C'

export default function DrawnSearchFrame({
  children,
  onSubmit,
  className = '',
}: {
  children: React.ReactNode
  onSubmit?: () => void
  className?: string
}) {
  const fid = `drawn-${useId().replace(/[:»]/g, '')}`

  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox="0 0 1000 120"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden
      >
        <defs>
          <filter id={fid} x="-12%" y="-60%" width="124%" height="220%">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.02" numOctaves={2} seed={7} result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>

        <g filter={`url(#${fid})`}>
          {/* The box. Each side drifts a few units off true so the rectangle
              looks drawn by hand rather than snapped to a grid. */}
          <path
            d="M14 16 Q 500 9, 986 15 Q 992 60, 985 104 Q 500 111, 15 105 Q 8 60, 14 16 Z"
            fill="none"
            stroke={STROKE}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* The block at the right, and the rule dividing it off. */}
          <path d="M872 17 L985 15 Q 992 60, 985 104 L872 105 Z" fill={BLOCK} />
          <path
            d="M872 17 Q 868 60, 872 105"
            fill="none"
            stroke={STROKE}
            strokeWidth="3"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>

      {/* The magnifier is drawn OUTSIDE the stretched viewBox so the circle
          stays round no matter how wide the field is. */}
      <button
        type="submit"
        onClick={onSubmit}
        aria-label="Search"
        className="absolute right-0 top-0 h-full w-[11.5%] flex items-center justify-center z-10"
      >
        <svg viewBox="0 0 40 40" className="w-[42%] max-w-[30px] min-w-[18px]" aria-hidden>
          <circle cx="17" cy="16" r="10" fill="none" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M24.5 24 L33 33" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" />
        </svg>
      </button>

      <div className="relative pr-[13%]">{children}</div>
    </div>
  )
}
