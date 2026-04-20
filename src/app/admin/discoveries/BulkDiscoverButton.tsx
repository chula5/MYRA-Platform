'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { discoverFromTasteProfile } from '@/app/admin/items/discover-similar'

export default function BulkDiscoverButton() {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setRunning(true)
    setMessage(null)
    setError(null)
    const result = await discoverFromTasteProfile()
    setRunning(false)
    if (result.error) { setError(result.error); return }
    setMessage(`Found ${result.discovered ?? 0} new pieces from your taste profile`)
    router.push('/admin/discoveries?status=new')
    router.refresh()
  }

  return (
    <div className="mb-6 border border-[#E2E0DB] bg-white p-5 rounded-[3px] flex items-start justify-between gap-4">
      <div>
        <p className="text-[10px] tracking-[0.20em] text-[#0A0A0A] mb-1">DISCOVER FROM MY TASTE</p>
        <p className="text-[10px] tracking-[0.12em] text-[#6B6B6B]">
          Ask AI to find pieces matching your overall aesthetic — not tied to a single item.
        </p>
        {message && (
          <p className="mt-2 text-[10px] tracking-[0.15em] text-[#3A6B3A]">{message}</p>
        )}
        {error && (
          <p className="mt-2 text-[10px] tracking-[0.15em] text-red-500">{error}</p>
        )}
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={running}
        className="shrink-0 bg-[#0A0A0A] text-white px-5 py-2.5 text-[10px] tracking-[0.20em] hover:bg-[#333] disabled:opacity-50 transition-colors"
      >
        {running ? 'SEARCHING THE WEB...' : '✦ RUN DISCOVERY →'}
      </button>
    </div>
  )
}
