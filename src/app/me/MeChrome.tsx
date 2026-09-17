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
    <header className="sticky top-0 z-30 myra-pearl border-b border-[rgba(43,43,43,0.18)]">
      <div className="flex items-center gap-8 px-6 sm:px-10 py-3">
        <Link href="/me" className="text-[24px] tracking-[0.24em] text-[#4A4E57] shrink-0">MYRA</Link>
        <div className="flex-1 min-w-0">
          <RoomNav active={active} compact />
        </div>
        <div className="shrink-0">{signOut}</div>
      </div>
    </header>
  )
}
