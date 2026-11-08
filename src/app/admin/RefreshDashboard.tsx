'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { refreshDashboard } from './dashboard-actions'

/**
 * "DATA AS OF 17:42 · REFRESH". The numbers on the dashboard are remembered
 * for five minutes so the page opens at once; this reads them again now.
 */
export default function RefreshDashboard({ loadedAt, missing }: { loadedAt: string; missing: string[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const time = new Date(loadedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-[9px] tracking-[0.14em] text-[#A8A8A4]">
        DATA AS OF {time}{missing.length ? '' : ' · REMEMBERED FOR 5 MINUTES'}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null)
          start(async () => {
            try { await refreshDashboard(); router.refresh() } catch (e) { setError(e instanceof Error ? e.message : 'could not refresh') }
          })
        }}
        className="text-[9px] tracking-[0.14em] text-[#4A4E57] hover:text-[#0A0A0A] disabled:text-[#C9C7C2] transition-colors duration-300"
      >
        {pending ? 'REFRESHING…' : 'REFRESH →'}
      </button>
      {error && <span className="text-[9px] tracking-[0.09em] text-[#B83A3A]">{error.toUpperCase()}</span>}
    </div>
  )
}
