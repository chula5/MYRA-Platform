'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// "MYRA STYLES FOR ___" on one line, one size. The first three words stay put;
// the occasion flips in over the last one, one at a time, on a loop. The slot
// eases to each occasion's width so the whole line stays centred. Sits between
// the scatter hero and the mirror.
const OCCASIONS = ['THE WEEKEND AWAY', 'THE WEDDING', 'DATE NIGHT', 'DINNER WITH THE GIRLS']
const HOLD_MS = 2200

export default function StylesFor() {
  const [i, setI] = useState(0)
  const [widths, setWidths] = useState<number[]>([])
  const spanRefs = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % OCCASIONS.length), HOLD_MS)
    return () => clearInterval(t)
  }, [])

  // Measure every occasion so the slot can take the current one's width.
  useLayoutEffect(() => {
    const measure = () => setWidths(spanRefs.current.map((el) => el?.offsetWidth ?? 0))
    measure()
    document.fonts?.ready.then(measure)
    // Re-measure whenever an occasion's rendered size changes (fonts, resize,
    // zoom) so the slot never keeps a stale width and the line stays centred.
    const ro = new ResizeObserver(measure)
    spanRefs.current.forEach((el) => el && ro.observe(el))
    return () => ro.disconnect()
  }, [])

  const prev = (i - 1 + OCCASIONS.length) % OCCASIONS.length

  return (
    <section className="relative flex justify-center px-4 sm:px-6 pt-[14vh] pb-[4vh]">
      <p
        className="flex items-start justify-center whitespace-nowrap text-[#0A0A0A] font-semibold uppercase tracking-[0.01em] leading-[1.2] text-[clamp(15px,4.2vw,40px)] sm:text-[clamp(30px,4vw,96px)]"
        aria-live="polite"
      >
        <span className="block h-[1.2em]">MYRA STYLES FOR&nbsp;</span>
        <span
          className="relative inline-block h-[1.2em] [perspective:900px]"
          style={{
            width: widths[i] ? `${widths[i]}px` : undefined,
            transition: 'width 500ms cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          {OCCASIONS.map((o, n) => {
            const state = n === i ? 'in' : n === prev ? 'out' : 'wait'
            return (
              <span
                key={o}
                ref={(el) => { spanRefs.current[n] = el }}
                aria-hidden={state !== 'in'}
                className="absolute left-0 top-0 whitespace-nowrap [backface-visibility:hidden] motion-reduce:!transform-none"
                style={{
                  opacity: state === 'in' ? 1 : 0,
                  transform:
                    state === 'in'
                      ? 'rotateX(0deg) translateY(0)'
                      : state === 'out'
                        ? 'rotateX(80deg) translateY(-35%)'
                        : 'rotateX(-80deg) translateY(35%)',
                  transformOrigin: '50% 50%',
                  // Only animate the flips we can see; the waiting one resets silently.
                  transition: state === 'wait' ? 'none' : 'transform 650ms cubic-bezier(0.22,1,0.36,1), opacity 450ms ease',
                }}
              >
                {o}
              </span>
            )
          })}
        </span>
      </p>
    </section>
  )
}
