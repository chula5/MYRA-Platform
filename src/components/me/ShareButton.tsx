'use client'

// SHARING — the speech bubbles in the top corner, beside YOU, on every one of
// her pages. A small ink dot on it when a friend has asked, or has sent
// something she has not read.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { RoomIcon } from './RoomNav'
import { sharingUnread } from '@/app/me/sharing/actions'

const EVERY_MS = 45_000

export default function ShareButton({ active, showLabel = true, testMemberId, onClick }: { active?: boolean; showLabel?: boolean; testMemberId?: string; /** HER VIEW: a button that opens the room in place rather than a link. */ onClick?: () => void }) {
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    let live = true
    const look = () => void sharingUnread(testMemberId).then((r) => { if (live) setUnread(r.count) }).catch(() => {})
    look()
    const t = setInterval(look, EVERY_MS)
    // Opening the room reads it: the page says so and the dot goes at once.
    const onRead = () => setUnread(0)
    window.addEventListener('myra:sharing-read', onRead)
    return () => { live = false; clearInterval(t); window.removeEventListener('myra:sharing-read', onRead) }
  }, [testMemberId])

  const inner = (
    <>
      <span className={`relative block w-9 h-9 sm:w-[clamp(54px,2.9vw,104px)] sm:h-[clamp(54px,2.9vw,104px)] mx-auto ${active ? 'text-[#2B2B2B]' : 'text-[#55534E] group-hover:text-[#2B2B2B]'}`}>
        <RoomIcon id="sharing" />
        {unread > 0 && !active && (
          <span aria-hidden className="absolute top-0 right-0 min-w-[14px] h-[14px] sm:min-w-[18px] sm:h-[18px] rounded-full bg-[#2B2B2B] ring-2 ring-[#E6E6E9]" />
        )}
      </span>
      {showLabel && <span className={`block mt-0.5 sm:mt-1 text-[13px] sm:text-[clamp(21px,1.15vw,40px)] ${active ? 'text-[#2B2B2B]' : 'text-[#55534E] group-hover:text-[#2B2B2B]'}`}>Sharing</span>}
    </>
  )
  const label = unread ? `Sharing — ${unread} new` : 'Sharing'
  return onClick
    ? <button type="button" onClick={onClick} data-tour="sharing" aria-label={label} className="group text-center shrink-0">{inner}</button>
    : <Link href="/me/sharing" data-tour="sharing" aria-label={label} className="group text-center shrink-0">{inner}</Link>
}
