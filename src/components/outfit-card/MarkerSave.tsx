'use client'

// MARKER SAVE — saving a look rings it, the way a stylist rings a keeper on a
// run-of-show sheet. The ring is a deliberately imperfect ellipse: it
// overshoots where it closes and its radii aren't quite equal, so it reads as
// drawn rather than plotted. It strokes on over 450ms and unstrokes on unsave.
//
// The ring sits over the whole image. The control that toggles it is a plain
// text button in the card's action row — no badge, no heart, no fill.

import { useEffect, useRef, useState } from 'react'
import { toggleSaveOutfit } from '@/app/edit/save-actions'

// Drawn in a 200x300 box (the card's 2:3 image), then scaled to fit.
// Starts low-left, sweeps round, and carries past the start point.
const RING =
  'M 44 219 C 22 168, 34 100, 84 72 C 132 45, 178 74, 180 138 ' +
  'C 182 206, 142 254, 92 254 C 56 254, 32 229, 28 188 ' +
  'C 25 155, 34 128, 50 105'

export default function MarkerSave({
  outfitId,
  initialSaved = false,
  locked = false,
  className = '',
}: {
  outfitId: string
  initialSaved?: boolean
  // Signed out: the control nudges sign-in rather than saving.
  locked?: boolean
  className?: string
}) {
  const [saved, setSaved] = useState(initialSaved)
  const [busy, setBusy] = useState(false)
  const pathRef = useRef<SVGPathElement>(null)
  const [len, setLen] = useState(0)

  // Measure the path once so the dash offsets are exact rather than guessed.
  useEffect(() => {
    if (pathRef.current) setLen(pathRef.current.getTotalLength())
  }, [])

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    if (locked) {
      try { window.dispatchEvent(new CustomEvent('myra:engage')) } catch { /* ignore */ }
      return
    }
    if (busy) return
    setBusy(true)
    const optimistic = !saved
    setSaved(optimistic)
    const res = await toggleSaveOutfit(outfitId)
    if (res.error) setSaved(!optimistic)
    else if (typeof res.saved === 'boolean') setSaved(res.saved)
    setBusy(false)
  }

  return (
    <>
      {/* The annotation itself — over the image, ignoring pointer events so it
          never blocks the card's own tap targets. */}
      <svg
        viewBox="0 0 200 300"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full z-30 pointer-events-none"
        aria-hidden
      >
        <path
          ref={pathRef}
          d={RING}
          fill="none"
          stroke="#111111"
          strokeWidth="2.5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          style={{
            strokeDasharray: len || 1,
            strokeDashoffset: saved ? 0 : len || 1,
            transition: 'stroke-dashoffset 450ms ease-out',
          }}
        />
      </svg>

      <button
        onClick={toggle}
        disabled={busy}
        aria-pressed={!locked && saved}
        aria-label={locked ? 'Sign in to save' : saved ? 'Remove from saved' : 'Save look'}
        className={className}
      >
        {saved ? 'Saved' : 'Save'}
      </button>
    </>
  )
}
