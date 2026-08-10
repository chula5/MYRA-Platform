'use client'

// PAPER — a sheet of white paper behind any content, in one of two edges:
//
//   'torn'  a scrap with a ragged edge, generated rather than drawn: an SVG
//           rect pushed around by a turbulence displacement map, so every
//           `seed` tears differently and it stays sharp at any size.
//   'clean' a crisp rectangle, like a sheet under a bulldog clip — square
//           corners, a soft shadow, and a faint grain so it reads as paper
//           rather than a white box.
//
// Either way the paper sits in its own absolutely-positioned layer, so nothing
// here can touch the text on top.

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
  edge = 'torn',
}: {
  children: React.ReactNode
  className?: string
  seed?: number
  rough?: number
  tilt?: number
  onClick?: () => void
  as?: 'div' | 'button'
  edge?: 'torn' | 'clean'
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
      {/* A torn edge needs room to wander outside the rect, so it is inset by
          the displacement amount; a clean sheet fills its box exactly. */}
      <svg
        className="absolute pointer-events-none"
        style={
          edge === 'torn'
            ? { inset: `${rough}px`, width: `calc(100% - ${rough * 2}px)`, height: `calc(100% - ${rough * 2}px)`, overflow: 'visible' }
            : { inset: 0, width: '100%', height: '100%', overflow: 'visible' }
        }
        aria-hidden
      >
        <defs>
          {edge === 'torn' ? (
            <filter id={fid} x="-30%" y="-60%" width="160%" height="220%">
              {/* Slightly anisotropic noise — paper frays a little more along
                  the tear than across it, but all four edges have to look
                  torn. */}
              <feTurbulence type="fractalNoise" baseFrequency="0.03 0.045" numOctaves={4} seed={seed} result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale={rough} xChannelSelector="R" yChannelSelector="G" />
              <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#000" floodOpacity="0.16" />
            </filter>
          ) : (
            <filter id={fid} x="-15%" y="-15%" width="130%" height="130%">
              {/* Fine grain, composited INSIDE the sheet so the noise can't
                  spill past its edges. It has to be BARELY there — at full
                  strength the multiply turns the paper grey. */}
              <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} result="grain" />
              <feColorMatrix
                in="grain"
                type="matrix"
                values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.05 0"
                result="softGrain"
              />
              <feComposite in="softGrain" in2="SourceGraphic" operator="in" result="clipped" />
              <feBlend in="SourceGraphic" in2="clipped" mode="multiply" result="sheet" />
              <feDropShadow in="sheet" dx="0" dy="3" stdDeviation="4" floodColor="#000" floodOpacity="0.20" />
            </filter>
          )}
        </defs>
        <rect width="100%" height="100%" fill="#FCFCFA" filter={`url(#${fid})`} />
      </svg>

      <span className="relative block">{children}</span>
    </Tag>
  )
}
