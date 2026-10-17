'use client'

// The top of every one of her pages: MYRA, the search and her rooms as icons.
// A client component so the bar can know which room she is in.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ROOMS, ROW_ROOMS, RoomIcon, RoomSearch, type RoomId } from '@/components/me/RoomNav'
import YouButton from '@/components/me/YouButton'
import MobileTabBar from '@/components/me/MobileTabBar'
import StylingBadge from '@/components/me/StylingBadge'

export default function MeChrome() {
  const path = usePathname() ?? '/me'
  // The longest matching room wins, so /me/dressing-room/123 stays lit.
  const active: RoomId = ([...ROOMS].sort((a, b) => b.href.length - a.href.length)
    .find((r) => path === r.href || path.startsWith(`${r.href}/`))?.id) ?? 'for_you'
  const home = active === 'for_you'

  // On a phone the header never holds the rooms (the tab bar at the foot
  // carries them) but it does stay put: MYRA and her profile are pinned under
  // the clock on every page, and only the page scrolls beneath them.
  return (
    <>
      {/* A desktop keeps the six rooms down the left, the way Instagram keeps
          its own: icon over word, the room she is in drawn in ink. The phone
          carries the same six in the tab bar at the foot instead. */}
      <nav aria-label="Your rooms" data-tour="rooms" className="hidden sm:flex fixed inset-y-0 left-0 z-40 w-[250px] flex-col items-center justify-center gap-[clamp(10px,2.4vh,32px)] border-r border-[rgba(43,43,43,0.14)] bg-[rgba(230,230,233,0.9)] backdrop-blur-md">
        {ROW_ROOMS.map((room) => {
          const on = room.id === active
          return (
            <Link key={room.id} href={room.href} prefetch aria-label={room.label} aria-current={on ? 'page' : undefined} className={`flex w-full flex-col items-center gap-2 py-1 transition-colors ${on ? 'text-[#2B2B2B]' : 'text-[#8C8A85] hover:text-[#2B2B2B]'}`}>
              {/* Big, but sized to the screen's height so all the rooms still fit
                  on a short window — set inline so the build cannot drop it. */}
              <span className="block" style={{ width: 'clamp(64px, 10.5vh, 112px)', height: 'clamp(64px, 10.5vh, 112px)' }}><RoomIcon id={room.id} /></span>
              <span className="text-[23px] xl:text-[26px] tracking-[0.1em] uppercase">{room.short}</span>
            </Link>
          )
        })}
      </nav>
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 myra-pearl border-b border-[rgba(43,43,43,0.18)]">
        {/* Her front door keeps the search under the logo. Inside a room the
            same pill sits in the bar beside MYRA — the rooms themselves now
            stand down the left, so they never take the room's width. */}
        {home ? (
          <>
            {/* Desktop: the MYRA mark sits on the same line as her profile.
                The rooms are down the left side and the search lives in the
                BROWSE room, so the front door is just the mark and her. */}
            <div className="hidden sm:block pl-[290px] pr-10">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6 pt-4 pb-4">
                <span />
                <Link href="/me" className="shrink-0">
                  <img src="/myra-logo-black.png" alt="MYRA" className="h-12 w-auto" />
                </Link>
                <div className="flex items-center justify-end">
                  <YouButton />
                </div>
              </div>
            </div>
            {/* Phone: the rooms live only in the tab bar, avoiding a duplicate
                row above the content. Her profile is always in the corner. */}
            <div className="sm:hidden">
              <div className="flex items-center justify-between px-5 pt-3">
                <Link href="/me" aria-label="MYRA — For You">
                  <img src="/myra-logo-black.png" alt="MYRA" className="h-8 w-auto" />
                </Link>
                <YouButton active={active === 'profile'} showLabel={false} />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="hidden sm:flex items-center gap-4 pl-[290px] pr-10 py-3">
              <Link href="/me" className="shrink-0">
                <img src="/myra-logo-black.png" alt="MYRA" className="h-10 w-auto" />
              </Link>
              <div className="flex-1 min-w-0 flex justify-end">
                {/* BROWSE has its own search in the middle of the room — a second pill in the bar was one too many. */}
                {active !== 'browse' && <RoomSearch variant="header" />}
              </div>
              <YouButton active={active === 'profile'} />
            </div>
            {/* Phone inside a room: the way home and her profile. The rooms
                themselves are always available in the tab bar. */}
            <div className="sm:hidden flex items-center justify-between px-5 py-3">
              <Link href="/me" aria-label="MYRA — For You">
                <img src="/myra-logo-black.png" alt="MYRA" className="h-8 w-auto" />
              </Link>
              <YouButton active={active === 'profile'} showLabel={false} />
            </div>
          </>
        )}
      </header>
      <MobileTabBar active={active} />
      {/* The dress form that says what MYRA is styling: it follows her from room to room. */}
      <StylingBadge />
    </>
  )
}
