'use client'

// The person on a piece: try it on her avatar. A tap asks MYRA to make the
// picture (a real shoot, about a minute, so a hover never starts one); once it
// exists the button turns dark, resting the cursor on it shows her wearing the
// piece, and a tap opens the picture. Sits under the heart wherever a piece is
// shown on its own.

import { useEffect, useRef, useState } from 'react'
import { tryOnMyPiece } from '@/app/me/avatar/try-on-actions'
import type { TryOn } from '@/lib/avatar/try-on'

const POLL_MS = 5000
const WAIT_MS = 6 * 60_000
// One answer per piece for the whole page: the same piece in two looks is one ask.
const known = new Map<string, TryOn>()

function labelFor(st: TryOn | undefined): string {
  if (!st || st.state === 'idle') return 'Try on the avatar'
  if (st.state === 'making') return 'On your avatar…'
  if (st.state === 'ready') return 'See on your avatar'
  if (st.state === 'no_avatar') return 'Make your avatar first'
  return st.message || 'That did not work — try again'
}

export default function TryOnAvatarButton({ itemId, className = '' }: { itemId: string; className?: string }) {
  const [st, setSt] = useState<TryOn | undefined>(() => known.get(itemId))
  const [hover, setHover] = useState(false)
  const [open, setOpen] = useState(false)
  const live = useRef(true)
  const running = useRef(false)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  const keep = (next: TryOn) => { known.set(itemId, next); if (live.current) setSt(next) }

  async function run(start: boolean) {
    if (running.current) return
    running.current = true
    try {
      let next = await tryOnMyPiece(itemId, start).catch((): TryOn => ({ state: 'failed', message: 'That did not work — try again' }))
      // A quiet look that finds nothing leaves the button as it was.
      if (!start && next.state !== 'ready' && next.state !== 'making') return
      keep(next)
      const until = Date.now() + WAIT_MS
      while (next.state === 'making' && Date.now() < until && live.current) {
        await new Promise((ok) => setTimeout(ok, POLL_MS))
        next = await tryOnMyPiece(itemId, false).catch((): TryOn => ({ state: 'making' }))
        if (next.state === 'idle') next = { state: 'failed', message: 'That did not work — try again' }
        keep(next)
      }
    } finally { running.current = false }
  }

  function tap(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (st?.state === 'no_avatar') { window.location.href = '/me/avatar'; return }
    if (st?.state === 'ready') { setOpen(true); return }
    if (st?.state === 'making') return
    keep({ state: 'making' })
    void run(true)
  }

  const ready = st?.state === 'ready' && !!st.image_url
  const label = labelFor(st)
  return (
    <>
      <button
        type="button"
        onClick={tap}
        onMouseEnter={() => { setHover(true); if (!st) void run(false) }}
        onMouseLeave={() => setHover(false)}
        aria-label={label}
        title={label}
        className={`w-9 h-9 rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.15)] flex items-center justify-center ${ready ? 'bg-[#141414] text-[#F7F6F3]' : 'bg-white/90 text-[#2B2B2B]'} ${st?.state === 'making' ? 'animate-pulse' : ''} ${st?.state === 'failed' ? 'text-[#9B3A3A]' : ''} ${className}`}
      >
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="5.2" r="2.7" />
          <path d="M6.5 21v-7.2c0-2.6 2.2-4.6 5.5-4.6s5.5 2 5.5 4.6V21" />
        </svg>
        {ready && hover && !open && (
          <span className="hidden md:block absolute right-full top-1/2 -translate-y-1/2 mr-3 w-[264px] rounded-2xl overflow-hidden bg-[#F7F6F3] shadow-[0_14px_44px_rgba(20,20,20,0.28)] z-50 pointer-events-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={st!.image_url!} alt="On your avatar" className="block w-full aspect-[3/4] object-contain bg-[#E4E2DD]" />
            <span className="block px-3 py-2.5 text-[12px] tracking-[0.12em] uppercase text-[#2B2B2B]/60 text-left">On your avatar</span>
          </span>
        )}
      </button>
      {ready && open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="On your avatar"
          data-lenis-prevent
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }}
          className="fixed inset-0 z-[200] bg-[#141414]/70 flex items-center justify-center p-5"
        >
          <div className="relative max-h-full w-full max-w-[460px] rounded-2xl overflow-hidden bg-[#E4E2DD]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={st!.image_url!} alt="On your avatar" className="block w-full max-h-[82vh] object-contain" />
            <button type="button" aria-label="Close" className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/90 text-[#2B2B2B] text-[20px] leading-none">×</button>
          </div>
        </div>
      )}
    </>
  )
}
