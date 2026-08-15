'use client'

import { useState } from 'react'
import { acceptTerms } from './actions'

export default function AcceptTermsButton({ termsId }: { termsId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true); setError(null)
          const res = await acceptTerms(termsId)
          setBusy(false)
          if (res.error) setError(res.error)
        }}
        className="bg-[#0A0A0A] text-white px-6 py-2.5 text-[10px] tracking-[0.14em] rounded-full hover:opacity-85 disabled:opacity-50"
      >
        {busy ? 'ACCEPTING…' : 'ACCEPT THESE TERMS'}
      </button>
      {error && <p className="text-[9px] tracking-[0.06em] text-[#B83A3A] mt-2">{error.toUpperCase()}</p>}
    </div>
  )
}
