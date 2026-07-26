'use client'

import { useEffect, useRef, useState } from 'react'

// A small contextual coach-mark that points at the element it sits over (via an
// arrow). Shown once per `id` (localStorage), dismissible. Position it by passing
// Tailwind position classes; pick `arrow` to match where it sits vs its anchor.
//
// Sequencing: pass `active` (controlled mode) to show tips ONE AT A TIME — the
// tip only appears when `active` is true, and calls `onResolved` when the user
// dismisses it OR when it was already seen, so the parent can advance to the
// next one. This prevents several tips stacking on top of each other.
export default function CoachTip({
  id,
  text,
  arrow = 'up',
  delayMs = 900,
  className = '',
  widthClass = 'w-[190px]',
  active,
  onResolved,
}: {
  id: string
  text: string
  arrow?: 'up' | 'down' | 'left' | 'right'
  delayMs?: number
  className?: string
  widthClass?: string
  active?: boolean
  onResolved?: () => void
}) {
  const [show, setShow] = useState(false)
  const controlled = active !== undefined
  const resolvedRef = useRef(false)
  const onResolvedRef = useRef(onResolved)
  onResolvedRef.current = onResolved
  const resolve = () => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    onResolvedRef.current?.()
  }

  useEffect(() => {
    let seen = false
    try { seen = localStorage.getItem(`myra_help_${id}`) === '1' } catch { /* ignore */ }
    if (controlled && !active) { setShow(false); return }
    if (seen) { if (controlled) resolve(); return }
    const t = setTimeout(() => setShow(true), delayMs)
    return () => clearTimeout(t)
  }, [id, delayMs, active, controlled])

  function dismiss() {
    try { localStorage.setItem(`myra_help_${id}`, '1') } catch { /* ignore */ }
    setShow(false)
    resolve()
  }

  if (!show) return null

  const arrowPos: Record<string, string> = {
    up: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2',
    down: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
    left: 'left-0 top-1/2 -translate-y-1/2 -translate-x-1/2',
    right: 'right-0 top-1/2 -translate-y-1/2 translate-x-1/2',
  }

  return (
    <div className={`absolute z-40 ${widthClass} animate-[fadeIn_0.35s_ease] pointer-events-auto ${className}`}>
      <div className="relative bg-white text-[#4A4E57] rounded-[10px] px-3 py-2.5 shadow-[0_6px_24px_rgba(0,0,0,0.2)] border border-[#EDEDED]">
        <span className={`absolute w-2.5 h-2.5 bg-white rotate-45 ${arrowPos[arrow]}`} />
        <p className="relative text-[9px] tracking-[0.05em] leading-relaxed">{text}</p>
        <button
          onClick={dismiss}
          className="relative mt-2 text-[8px] tracking-[0.14em] text-[#A8A8A4] hover:text-[#4A4E57]"
        >
          GOT IT ×
        </button>
      </div>
    </div>
  )
}
