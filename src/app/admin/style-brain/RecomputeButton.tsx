'use client'

import { useState } from 'react'
import { recomputeAction } from './actions'

export default function RecomputeButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={async () => {
          setBusy(true); setMsg(null)
          const res = await recomputeAction()
          setBusy(false)
          setMsg(res.error ? res.error : `Rebuilt from ${res.count} decisions`)
        }}
        disabled={busy}
        className="border border-[#0A0A0A] text-[#4A4E57] px-5 py-2 text-[10px] tracking-[0.14em] rounded-full hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-50"
      >
        {busy ? 'REBUILDING…' : 'REBUILD FROM LOG'}
      </button>
      {msg && <span className="text-[9px] tracking-[0.08em] text-[#A8A8A4]">{msg.toUpperCase()}</span>}
    </div>
  )
}
