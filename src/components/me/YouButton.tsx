'use client'

// YOU — her own corner of the screen, kept out of the row of rooms.

import Link from 'next/link'

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export default function YouButton({ active, onClick }: { active?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <span className={`block w-[54px] h-[54px] mx-auto ${active ? 'text-[#2B2B2B]' : 'text-[#55534E] group-hover:text-[#2B2B2B]'}`}>
        <svg viewBox="0 0 64 64" className="w-full h-full" aria-hidden>
          <circle cx="32" cy="23" r="10" {...S} />
          <path d="M14 52c2-10 9.5-15 18-15s16 5 18 15" {...S} />
        </svg>
      </span>
      <span className={`block mt-1 text-[21px] ${active ? 'text-[#2B2B2B]' : 'text-[#55534E] group-hover:text-[#2B2B2B]'}`}>You</span>
    </>
  )
  const cls = 'group text-center shrink-0'
  return onClick
    ? <button type="button" data-tour="you" onClick={onClick} className={cls}>{inner}</button>
    : <Link href="/me/profile" data-tour="you" className={cls}>{inner}</Link>
}
