'use client'

// The heart on a piece: every place a piece is shown on its own, she can keep
// it. One read of what she has saved is shared by every heart on the page and
// refreshed whenever a save happens anywhere (the `myra:item-saved` event the
// wardrobe count already listens to).

import { useEffect, useState } from 'react'
import { getSavedItemIds, toggleSaveItem } from '@/app/edit/save-actions'

let savedRead: Promise<Set<string>> | null = null
function savedIds(): Promise<Set<string>> {
  if (!savedRead) savedRead = getSavedItemIds().then((ids) => new Set(ids)).catch(() => new Set<string>())
  return savedRead
}

export default function SavePieceHeart({ itemId, className = '' }: { itemId: string; className?: string }) {
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let live = true
    const read = () => { void savedIds().then((s) => { if (live) setSaved(s.has(itemId)) }) }
    read()
    const onSaved = () => { savedRead = null; read() }
    window.addEventListener('myra:item-saved', onSaved)
    return () => { live = false; window.removeEventListener('myra:item-saved', onSaved) }
  }, [itemId])

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    const was = saved
    setSaved(!was)
    const res = await toggleSaveItem(itemId).catch(() => ({ error: 'failed' }))
    if (res && 'error' in res && res.error) { setSaved(was); return }
    savedRead = null
    window.dispatchEvent(new Event('myra:item-saved'))
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={saved ? 'Remove from saved' : 'Save this piece'}
      aria-pressed={saved}
      className={`w-9 h-9 rounded-full bg-white/90 shadow-[0_2px_8px_rgba(0,0,0,0.15)] flex items-center justify-center ${className}`}
    >
      <span className={`text-[20px] leading-none ${saved ? 'text-[#C8302A]' : 'text-[#2B2B2B]'}`}>{saved ? '♥' : '♡'}</span>
    </button>
  )
}
