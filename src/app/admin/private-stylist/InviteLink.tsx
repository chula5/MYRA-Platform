'use client'

// COPY HER INVITE LINK — one button; the link is made fresh each time.

import { useState } from 'react'
import { createMemberInvite } from './invite-actions'

export default function InviteLink({ memberId, name }: { memberId: string; name: string }) {
  const [state, setState] = useState<{ url?: string; note?: string; busy?: boolean }>({})
  const first = name.split(' ')[0]

  async function make() {
    setState({ busy: true })
    const r = await createMemberInvite(memberId, window.location.origin)
    if (!r.url) { setState({ note: r.error ?? 'Could not make the link' }); return }
    let copied = false
    try { await navigator.clipboard.writeText(r.url); copied = true } catch { /* shown below instead */ }
    setState({ url: r.url, note: `${copied ? 'Copied. ' : ''}Send this to ${first} — she makes her own login, connects her accounts and gets the tour. Works for ${r.days} days, once.` })
  }

  return (
    <div className="px-1 pb-4 space-y-2">
      <div className="flex flex-wrap gap-3">
        <button onClick={make} disabled={state.busy} className="text-[13px] tracking-[0.14em] px-4 py-2.5 border border-[#2B2B2B] text-[#2B2B2B] disabled:opacity-40">
          {state.busy ? 'MAKING…' : `COPY ${first.toUpperCase()}'S INVITE LINK`}
        </button>
        {/* See it as she will: create login → connect accounts → the tour. Nothing is created. */}
        <button onClick={() => window.open(`/welcome/preview?as=${memberId}`, '_blank', 'noopener')} className="text-[13px] tracking-[0.14em] px-4 py-2.5 bg-[#2B2B2B] text-white">
          ONBOARDING WALK-THROUGH
        </button>
      </div>
      {state.note && <p className="text-[13px] tracking-[0.06em] text-[#4A4E57]">{state.note}</p>}
      {state.url && <input readOnly value={state.url} onFocus={(e) => e.currentTarget.select()} className="w-full max-w-3xl text-[13px] px-3 py-2 border border-[#C3BFB8] bg-white text-[#2B2B2B]" />}
    </div>
  )
}
