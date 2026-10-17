'use client'

// The dress form in the corner: it wiggles while MYRA styles, says how far
// along she is, and goes still with READY when a piece she tapped is done.
// Mounted once in the member chrome, so it is there in every room; tapping
// it opens the outfits on FOR YOU (from another room, it goes there first).
//
// Stood to the right and stacked — the form over its words — so it covers as
// little of the page as it can (Chloe, 2026-10-15).

import { usePathname, useRouter } from 'next/navigation'
import Mannequin from './Mannequin'
import { STYLING_OPEN_EVENT, useStylingProgress } from './styling-progress'

export default function StylingBadge({ onOpen }: { onOpen?: () => void }) {
  const { total, finished, ready, origin } = useStylingProgress()
  const path = usePathname()
  const router = useRouter()
  const working = Math.max(0, total - finished)
  if (!working && !ready) return null

  // Back to wherever the styling began — FOR YOU or Browse — and open it there.
  const go = () => {
    if (onOpen) { onOpen(); return }
    const target = origin ?? '/me?styled=1'
    if (path === target.split('?')[0]) window.dispatchEvent(new CustomEvent(STYLING_OPEN_EVENT))
    else router.push(target)
  }

  return (
    <button
      type="button"
      onClick={go}
      aria-live="polite"
      aria-label={ready ? 'An outfit is ready — see it' : `MYRA is styling ${Math.min(finished + 1, total)} of ${total}`}
      className="fixed right-3 top-[calc(env(safe-area-inset-top,0px)+72px)] sm:right-8 sm:top-[150px] z-[60] flex flex-col items-center gap-1 rounded-[20px] bg-white/95 shadow-[0_10px_30px_-12px_rgba(43,43,43,0.6)] px-3 py-2.5 sm:px-4 sm:py-3"
    >
      <Mannequin working={!ready} className="h-9 sm:h-12" />
      <span className="text-[13px] sm:text-[15px] tracking-[0.14em] text-[#2B2B2B] leading-[1.15] text-center">
        {ready ? <>READY<br />SEE IT</> : <>STYLING<br />{Math.min(finished + 1, total)} OF {total}</>}
      </span>
    </button>
  )
}
