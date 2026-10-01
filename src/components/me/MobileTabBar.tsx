'use client'

// THE TAB BAR — on a phone the rooms live at the foot of the screen, where
// her thumb already is. Icons only, the same line art as the bar up top; the
// room she is in is ink, the rest are silver. The header scrolls away with
// the page; this does not.
//
// No data-tour attributes here on purpose: the tour finds its buttons with
// querySelector, first match wins, and the first match must stay the bar it
// can actually light up.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ROOMS, RoomIcon, type RoomId } from './RoomNav'

export default function MobileTabBar({ active }: { active: RoomId }) {
  // Route data can take a moment to arrive on a phone. Keep the tab feedback
  // local so the indicator moves at touch-down, rather than after navigation.
  const [selected, setSelected] = useState(active)
  useEffect(() => setSelected(active), [active])

  return (
    <nav
      aria-label="Your rooms"
      className="fixed bottom-0 inset-x-0 z-40 sm:hidden bg-[rgba(230,230,233,0.92)] backdrop-blur-md border-t border-[rgba(43,43,43,0.18)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-7">
        {ROOMS.map((r) => {
          const on = r.id === selected
          return (
            <Link
              key={r.id}
              href={r.href}
              prefetch
              onClick={() => setSelected(r.id)}
              aria-label={r.label}
              aria-current={on ? 'page' : undefined}
              className="flex flex-col items-center pt-2 pb-1.5"
            >
              <span className={`block w-10 h-10 transition-colors ${on ? 'text-[#2B2B2B]' : 'text-[#8C8A85]'}`}>
                <RoomIcon id={r.id} />
              </span>
              <span className={`mt-1 h-px w-6 transition-colors ${on ? 'bg-[#2B2B2B]' : 'bg-transparent'}`} />
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
