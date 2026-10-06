'use client'

// WHAT SHE SEES THE MOMENT SHE TAPS A ROOM. Before this existed a tap did
// nothing visible until the server had finished the whole page — on a phone
// that was seconds of a dead screen, and the natural response (tap it again)
// restarted the wait. Now the page changes at the tap.
//
// FOR YOU keeps its curtain: the screen becomes only the mirror, the same
// mirror the page itself holds up until her first looks are ready, so one
// wiggle runs straight into the next. Every other room draws a small mirror
// in the page with the tab bar still live under her thumb.

import { usePathname } from 'next/navigation'
import MirrorCurtain from './MirrorCurtain'

export default function RoomLoading() {
  const path = usePathname() ?? '/me'
  if (path === '/me') return <MirrorCurtain />
  return (
    <div className="flex min-h-[60vh] items-center justify-center" aria-busy="true" aria-label="Loading">
      <img src="/myra-mirror-transparent.png" alt="" className="myra-curtain-mirror h-36 w-auto opacity-80" />
    </div>
  )
}
