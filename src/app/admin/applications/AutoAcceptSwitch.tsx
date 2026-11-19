'use client'

// AUTO-ACCEPT — Chloe's switch: when on, a sign-up from the landing page
// becomes a member and gets her invitation email at once (up to 25 a day).
import { useState, useTransition } from 'react'
import { setAutoAccept } from './actions'

export default function AutoAcceptSwitch({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const flip = () => start(async () => {
    setErr(null)
    const next = !on
    const r = await setAutoAccept(next)
    if (r.error) setErr(r.error); else setOn(next)
  })
  return (
    <div className="flex flex-wrap items-center gap-3 mt-4">
      <button type="button" onClick={flip} disabled={pending} aria-pressed={on}
        className={`rounded-full px-5 py-2 text-[11px] tracking-[0.12em] transition-colors ${on ? 'bg-[#2B2B2B] text-white' : 'bg-white text-[#4A4E57] ring-1 ring-[#C9CCD0] hover:ring-[#4A4E57]'}`}>
        {pending ? '…' : on ? 'AUTO-ACCEPT IS ON' : 'AUTO-ACCEPT IS OFF'}
      </button>
      <span className="text-[11px] tracking-[0.054em] text-[#7C838B]">
        {on
          ? 'Every sign-up becomes a member with her brands in and is emailed her invitation at once (up to 25 a day; past that they wait here).'
          : 'Sign-ups wait here for ACCEPT.'}
      </span>
      {err && <span className="text-[11px] tracking-[0.054em] text-[#B83A3A]">{err}</span>}
    </div>
  )
}
