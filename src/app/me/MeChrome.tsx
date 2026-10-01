'use client'

// The top of every one of her pages: MYRA, the search and her rooms as icons.
// A client component so the bar can know which room she is in.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ROOMS, ROW_ROOMS, RoomIcon, RoomSearch, type RoomId } from '@/components/me/RoomNav'
import YouButton from '@/components/me/YouButton'
import MobileTabBar from '@/components/me/MobileTabBar'

export default function MeChrome({ signOut }: { signOut: React.ReactNode }) {
  const path = usePathname() ?? '/me'
  // The longest matching room wins, so /me/dressing-room/123 stays lit.
  const active: RoomId = ([...ROOMS].sort((a, b) => b.href.length - a.href.length)
    .find((r) => path === r.href || path.startsWith(`${r.href}/`))?.id) ?? 'for_you'
  const home = active === 'for_you'

  // On a phone the header is not sticky and never holds the rooms: it scrolls
  // away with the page, and the tab bar at the foot carries the rooms instead.
  return (
    <>
      {/* A desktop keeps the six rooms down the left, the way Instagram keeps
          its own: icon over word, the room she is in drawn in ink. The phone
          carries the same six in the tab bar at the foot instead. */}
      <nav aria-label="Your rooms" data-tour="rooms" className="hidden sm:flex fixed inset-y-0 left-0 z-40 w-[112px] flex-col items-center justify-center gap-6 border-r border-[rgba(43,43,43,0.14)] bg-[rgba(230,230,233,0.9)] backdrop-blur-md">
        {ROW_ROOMS.map((room) => {
          const on = room.id === active
          return (
            <Link key={room.id} href={room.href} prefetch aria-label={room.label} aria-current={on ? 'page' : undefined} className={`flex w-full flex-col items-center gap-2 py-1.5 transition-colors ${on ? 'text-[#2B2B2B]' : 'text-[#8C8A85] hover:text-[#2B2B2B]'}`}>
              <span className="block h-10 w-10"><RoomIcon id={room.id} /></span>
              <span className="text-[12px] tracking-[0.08em] uppercase">{room.short}</span>
            </Link>
          )
        })}
      </nav>
      <header className="sm:sticky sm:top-0 z-30 myra-pearl border-b border-[rgba(43,43,43,0.18)]">
        {/* Her front door keeps the search under the logo. Inside a room the
            same pill sits in the bar beside MYRA — the rooms themselves now
            stand down the left, so they never take the room's width. */}
        {home ? (
          <>
            {/* Desktop: the logo and the search, with her profile in the
                corner. The rooms are down the left side, so the page starts
                clear of them. */}
            <div className="hidden sm:block pl-[152px] pr-10">
              <div className="flex items-start justify-end gap-7 pt-4">
                <YouButton />
                {signOut}
              </div>
              <Link href="/me" className="block mt-1">
                <img src="/myra-logo-black.png" alt="MYRA" className="mx-auto h-16 w-auto" />
              </Link>
              <div className="pt-4 pb-5">
                <RoomSearch placeholder="What are you wearing today?" />
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
            <div className="hidden sm:flex items-center gap-4 pl-[152px] pr-10 py-3">
              <Link href="/me" className="shrink-0">
                <img src="/myra-logo-black.png" alt="MYRA" className="h-10 w-auto" />
              </Link>
              <div className="flex-1 min-w-0 flex justify-end">
                <RoomSearch variant="header" />
              </div>
              <YouButton active={active === 'profile'} />
              <div className="shrink-0">{signOut}</div>
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
    </>
  )
}
