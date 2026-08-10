'use client'

// TORN PAPER — a scrap of white paper behind any content, with a ragged edge.
//
// The edge is generated, not an image: an SVG rect is pushed around by a
// turbulence displacement map, which gives a different irregular tear for every
// `seed` and scales to any size without going soft. The paper sits in its own
// absolutely-positioned layer so the displacement never touches the text on top.

import { useId } from 'react'

export default function TornPaper({
  children,
  className = '',
  // Different seeds tear differently; keep it stable per element so the shape
  // doesn't change between renders.
  seed = 2,
  // How ragged the edge is, in px of displacement.
  rough = 12,
  // Collage tilt, in degrees.
  tilt = 0,
  onClick,
  as = 'div',
}: {
  children: React.ReactNode
  className?: string
  seed?: number
  rough?: number
  tilt?: number
  onClick?: () => void
  as?: 'div' | 'button'
}) {
  // useId is stable across server and client, so the filter reference matches
  // after hydration.
  const fid = `torn-${useId().replace(/[:»]/g, '')}`
  const Tag = as as React.ElementType

  return (
    <Tag
      onClick={onClick}
      className={`relative ${className}`}
      style={tilt ? { transform: `rotate(${tilt}deg)` } : undefined}
    >
      {/* Inset by the displacement amount so the ragged edge has room to wander
          outside the rect without being clipped by the SVG viewport. */}
      <svg
        className="absolute pointer-events-none"
        style={{ inset: `${rough}px`, width: `calc(100% - ${rough * 2}px)`, height: `calc(100% - ${rough * 2}px)`, overflow: 'visible' }}
        aria-hidden
      >
        <defs>
          <filter id={fid} x="-30%" y="-60%" width="160%" height="220%">
            {/* Slightly anisotropic noise — paper frays a little more along the
                tear than across it, but all four edges have to look torn. */}
            <feTurbulence type="fractalNoise" baseFrequency="0.03 0.045" numOctaves={4} seed={seed} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={rough} xChannelSelector="R" yChannelSelector="G" result="torn" />
            <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#000" floodOpacity="0.16" />
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="#FCFCFA" filter={`url(#${fid})`} />
      </svg>

      <span className="relative block">{children}</span>
    </Tag>
  )
}
