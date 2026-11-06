'use client'

import { useState, useTransition } from 'react'
import { setSalePaused } from './actions'

export default function PauseButton({ brandId, paused }: { brandId: string; paused: boolean }) {
  const [on, setOn] = useState(paused)
  const [busy, start] = useTransition()
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => start(async () => { const r = await setSalePaused(brandId, !on); if (!r.error) setOn(!on) })}
      className={`text-[10px] tracking-[0.09em] px-3 py-1.5 border ${on ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'border-[#CFCFCB] text-[#4A4E57] hover:border-[#0A0A0A]'} disabled:opacity-50`}
    >
      {on ? 'PAUSED — RESUME' : 'PAUSE'}
    </button>
  )
}
