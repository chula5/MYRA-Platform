'use client'

// "+ PICKS ▾" on every item-library card: push an item straight into a curated
// front-end collection (Our Picks grid / The Bags) without leaving the library.

import { useState } from 'react'
import { addPick, type PickCollection } from '@/app/admin/picks/actions'

const COLLECTIONS: { key: PickCollection; label: string }[] = [
  { key: 'picks', label: 'OUR PICKS' },
  { key: 'bags', label: 'THE BAGS' },
]

export default function AddToPicksButton({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<string | null>(null)

  async function add(e: React.MouseEvent, collection: PickCollection) {
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
    setState('…')
    const res = await addPick(collection, itemId)
    setState(res.error ? (res.error === 'Already in this collection' ? 'ALREADY IN' : '✕') : '✓ ADDED')
    setTimeout(() => setState(null), 2000)
  }

  return (
    <span className="relative inline-block" onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o) }}
        className="text-[8px] tracking-[0.08em] border border-[#E2E0DB] text-[#6B6B6B] px-2 py-0.5 rounded-full hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors"
      >
        {state ?? '+ PICKS ▾'}
      </button>
      {open && (
        <span className="absolute right-0 top-full mt-1 z-20 bg-white border border-[#E2E0DB] rounded-[8px] shadow-lg py-1 min-w-[110px]">
          {COLLECTIONS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={(e) => add(e, c.key)}
              className="block w-full text-left px-3 py-1.5 text-[8px] tracking-[0.1em] text-[#4A4E57] hover:bg-[#F7F7F5]"
            >
              {c.label}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}
