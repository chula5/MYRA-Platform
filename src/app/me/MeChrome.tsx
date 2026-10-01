'use client'

// The top of every one of her pages: MYRA, the search and her rooms as icons.
// A client component so the bar can know which room she is in.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import RoomNav, { ROOMS, type RoomId } from '@/components/me/RoomNav'
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
      <header className="sm:sticky sm:top-0 z-30 myra-pearl border-b border-[rgba(43,43,43,0.18)]">
        {/* Her front door shows the rooms full width, under the search. Inside a
            room they step aside into the top right, so the room has the screen. */}
        {home ? (
          <>
            <div className="hidden sm:block">
              <div className="flex items-start justify-end gap-7 px-6 sm:px-10 pt-4">
                <YouButton />
                {signOut}
              </div>
              <Link href="/me" className="block px-6 sm:px-10 -mt-12">
                <img src="/myra-logo-black.png" alt="MYRA" className="mx-auto h-[110px] sm:h-[150px] w-auto" />
              </Link>
              <RoomNav active={active} searchPlaceholder="What are you wearing today?" />
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
            <div className="hidden sm:flex items-center gap-4 px-6 sm:px-10 py-3">
              <Link href="/me" className="shrink-0">
                <img src="/myra-logo-black.png" alt="MYRA" className="h-[46px] w-auto" />
              </Link>
              <div className="flex-1 min-w-0">
                <RoomNav active={active} compact />
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
