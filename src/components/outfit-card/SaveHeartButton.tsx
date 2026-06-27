'use client'

import { useState } from 'react'
import { toggleSaveOutfit } from '@/app/edit/save-actions'

export default function SaveHeartButton({
  outfitId,
  initialSaved = false,
  variant = 'card',
  locked = false,
}: {
  outfitId: string
  initialSaved?: boolean
  variant?: 'card' | 'detail'
  // Anonymous visitors: a greyed heart that invites sign-in instead of saving.
  locked?: boolean
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

  // Locked (signed-out) — greyed heart, hover tooltip, click nudges sign-in.
  if (locked) {
    return (
      <div className="absolute top-3 right-3 z-20 group/heart">
        <button
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            try { window.dispatchEvent(new CustomEvent('myra:engage')) } catch { /* ignore */ }
          }}
          aria-label="Sign in to save"
          className="w-9 h-9 rounded-full bg-white/90 hover:bg-white shadow-sm flex items-center justify-center cursor-pointer transition-colors"
        >
          <span className="text-[16px] leading-none text-[#6B6B6B]">♡</span>
        </button>
        <span className="pointer-events-none absolute right-0 top-full mt-1.5 whitespace-nowrap bg-[#0A0A0A] text-white text-[8px] tracking-[0.09em] px-2 py-1 rounded-md opacity-0 group-hover/heart:opacity-100 transition-opacity duration-200">
          SIGN IN TO SAVE
        </span>
      </div>
    )
  }

  if (variant === 'detail') {
    return (
      <button
        onClick={toggle}
        disabled={busy}
        className={`glass-dark inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] tracking-[0.081em] text-[#4A4E57] transition-all duration-400 disabled:opacity-40 ${saved ? 'ring-1 ring-[#0A0A0A]/30' : ''}`}
      >
        <span className="text-[12px] leading-none">{saved ? '♥' : '♡'}</span>
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
