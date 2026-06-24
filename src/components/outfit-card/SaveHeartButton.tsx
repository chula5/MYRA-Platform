'use client'

import { useState } from 'react'
import { toggleSaveOutfit } from '@/app/edit/save-actions'

export default function SaveHeartButton({
  outfitId,
  initialSaved = false,
  variant = 'card',
}: {
  outfitId: string
  initialSaved?: boolean
  variant?: 'card' | 'detail'
}) {
  const [saved, setSaved] = useState(initialSaved)
  const [busy, setBusy] = useState(false)

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    if (busy) return
    setBusy(true)
    const optimistic = !saved
    setSaved(optimistic)
    const res = await toggleSaveOutfit(outfitId)
    if (res.error) setSaved(!optimistic)
    else if (typeof res.saved === 'boolean') setSaved(res.saved)
    setBusy(false)
  }

  if (variant === 'detail') {
    return (
      <button
        onClick={toggle}
        disabled={busy}
        className={`glass-dark inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[11px] tracking-[0.081em] text-[#4A4E57] disabled:opacity-60 ${saved ? 'ring-1 ring-[#0A0A0A]/30' : ''}`}
      >
        <span className="text-[13px] leading-none">{saved ? '♥' : '♡'}</span>
        {saved ? 'SAVED' : 'SAVE'}
      </button>
    )
  }

  // Card overlay heart
  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-label={saved ? 'Remove from saved' : 'Save outfit'}
      className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full bg-white/90 hover:bg-white shadow-sm flex items-center justify-center transition-colors"
    >
      <span className={`text-[16px] leading-none ${saved ? 'text-[#4A4E57]' : 'text-[#6B6B6B]'}`}>
        {saved ? '♥' : '♡'}
      </span>
    </button>
  )
}
