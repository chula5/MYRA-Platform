'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteItem } from '@/app/admin/items/actions'

export default function DeleteItemButton({
  itemId,
  productName,
}: {
  itemId: string
  productName: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function doDelete() {
    setBusy(true)
    setError(null)
    const res = await deleteItem(itemId)
    if (res.error) {
      setBusy(false)
      setConfirming(false)
      setError(res.error)
      return
    }
    router.push('/admin/items')
    router.refresh()
  }

  return (
    <div>
      <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-4 pb-3 border-b border-[#E2E0DB]">
        DANGER ZONE
      </p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="w-full border border-[#E8B4B4] text-[#B83A3A] px-4 py-2.5 text-[10px] tracking-[0.09em] hover:bg-[#B83A3A] hover:text-white hover:border-[#B83A3A] transition-colors duration-300"
        >
          DELETE ITEM
        </button>
      ) : (
        <div className="border border-[#E8B4B4] bg-[#FDECEC] p-3 rounded-[12px]">
          <p className="text-[10px] tracking-[0.054em] text-[#B83A3A] leading-relaxed mb-3">
            Permanently delete &ldquo;{productName}&rdquo;? This also removes it from any outfits it&rsquo;s in. This can&rsquo;t be undone.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={doDelete}
              disabled={busy}
              className="flex-1 bg-[#B83A3A] text-white px-3 py-2 text-[10px] tracking-[0.081em] hover:bg-[#9c2f2f] transition-colors disabled:opacity-50"
            >
              {busy ? 'DELETING…' : 'CONFIRM DELETE'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="px-3 py-2 text-[10px] tracking-[0.081em] border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors disabled:opacity-50"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-[9px] tracking-[0.054em] text-[#B83A3A]">{error.toUpperCase()}</p>}
    </div>
  )
}
