'use client'

// Chloe on /me as a member (HER VIEW's cookie). Inside HER VIEW's frame her
// screen is shown untouched; anywhere else this bar says whose pages these
// are and hands Chloe her own back.

import { useEffect, useState } from 'react'
import { setHerView } from '@/app/admin/private-stylist/her-view-actions'

export default function HerViewBar({ name }: { name: string }) {
  const [framed, setFramed] = useState(true)
  useEffect(() => { setFramed(window.top !== window.self) }, [])
  if (framed) return null
  return (
    <div className="sticky top-0 z-[60] flex items-center justify-between gap-4 bg-[#2B2B2B] px-6 py-2.5 text-white">
      <p className="text-[15px] tracking-[0.1em]">TESTING AS {name.toUpperCase()} — NOTHING IS SENT TO HER OR SAVED</p>
      <button
        type="button"
        onClick={async () => { await setHerView(null); window.location.href = '/admin/private-stylist' }}
        className="shrink-0 border border-white/60 px-3 py-1.5 text-[13px] tracking-[0.14em]"
      >
        STOP
      </button>
    </div>
  )
}
