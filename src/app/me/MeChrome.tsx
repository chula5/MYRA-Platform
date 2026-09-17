'use client'

// The top of every one of her pages: MYRA, the search and her rooms as icons.
// A client component so the bar can know which room she is in.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import RoomNav, { ROOMS, type RoomId } from '@/components/me/RoomNav'

export default function MeChrome({ signOut }: { signOut: React.ReactNode }) {
  const path = usePathname() ?? '/me'
  // The longest matching room wins, so /me/dressing-room/123 stays lit.
  const active: RoomId = ([...ROOMS].sort((a, b) => b.href.length - a.href.length)
    .find((r) => path === r.href || path.startsWith(`${r.href}/`))?.id) ?? 'for_you'

  return (
    <header className="sticky top-0 z-30 bg-[#F4F2EE]">
      <div className="flex items-center justify-between px-6 sm:px-10 h-14">
        <Link href="/me" className="text-[22px] tracking-[0.24em] text-[#4A4E57]">MYRA</Link>
        {signOut}
      </div>
      <RoomNav active={active} />
    </header>
  )
}
