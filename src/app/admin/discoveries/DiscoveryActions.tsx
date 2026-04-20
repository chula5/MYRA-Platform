'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateDiscoveryStatus } from '@/app/admin/items/discover-similar'

export default function DiscoveryActions({
  discoveredId,
  currentStatus,
}: {
  discoveredId: string
  currentStatus: 'new' | 'saved' | 'dismissed'
}) {
  const router = useRouter()
  const [pending, setPending] = useState<'saved' | 'dismissed' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleUpdate(status: 'saved' | 'dismissed') {
    setPending(status)
    setError(null)
    const result = await updateDiscoveryStatus(discoveredId, status)
    setPending(null)
    if (result.error) { setError(result.error); return }
    router.refresh()
  }

  if (currentStatus !== 'new') {
    return (
      <p className="text-center py-1.5 text-[9px] tracking-[0.18em] text-[#A8A8A4]">
        {currentStatus.toUpperCase()}
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => handleUpdate('saved')}
        disabled={!!pending}
        className="py-1.5 text-[9px] tracking-[0.18em] bg-[#0A0A0A] text-white hover:bg-[#333] disabled:opacity-40 transition-colors"
      >
        {pending === 'saved' ? 'SAVING...' : 'SAVE'}
      </button>
      <button
        type="button"
        onClick={() => handleUpdate('dismissed')}
        disabled={!!pending}
        className="py-1.5 text-[9px] tracking-[0.18em] border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A] disabled:opacity-40 transition-colors"
      >
        {pending === 'dismissed' ? 'DISMISSING...' : 'DISMISS'}
      </button>
      {error && <p className="col-span-2 text-[9px] tracking-[0.15em] text-red-500">{error}</p>}
    </div>
  )
}
