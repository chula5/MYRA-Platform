'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateDiscoveryStatus, saveDiscoveryAsItem } from '@/app/admin/items/discover-similar'

type PendingAction = 'save' | 'dismiss' | null

export default function DiscoveryActions({
  discoveredId,
  currentStatus,
}: {
  discoveredId: string
  currentStatus: 'new' | 'saved' | 'dismissed'
}) {
  const router = useRouter()
  const [pending, setPending] = useState<PendingAction>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setPending('save')
    setError(null)
    const result = await saveDiscoveryAsItem(discoveredId)
    if (result.error) { setError(result.error); setPending(null); return }
    if (result.itemId) {
      router.push(`/admin/items/${result.itemId}/edit`)
    } else {
      setPending(null)
      router.refresh()
    }
  }

  async function handleDismiss() {
    setPending('dismiss')
    setError(null)
    const result = await updateDiscoveryStatus(discoveredId, 'dismissed')
    setPending(null)
    if (result.error) { setError(result.error); return }
    router.refresh()
  }

  if (currentStatus !== 'new') {
    return (
      <p className="text-center py-1.5 text-[9px] tracking-[0.18em] text-[#A8A8A4]">
        {currentStatus === 'saved' ? 'ADDED TO LIBRARY' : 'DISMISSED'}
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={handleSave}
        disabled={!!pending}
        className="py-1.5 text-[9px] tracking-[0.18em] bg-[#0A0A0A] text-white hover:bg-[#333] disabled:opacity-40 transition-colors"
      >
        {pending === 'save' ? 'ADDING...' : 'ADD TO LIBRARY'}
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        disabled={!!pending}
        className="py-1.5 text-[9px] tracking-[0.18em] border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A] disabled:opacity-40 transition-colors"
      >
        {pending === 'dismiss' ? 'DISMISSING...' : 'DISMISS'}
      </button>
      {error && <p className="col-span-2 text-[9px] tracking-[0.15em] text-red-500">{error}</p>}
    </div>
  )
}
