'use client'

import { useEffect, useState } from 'react'
import { searchItemInventory } from '@/app/admin/projects/actions'

export interface InventoryPickerItem {
  item_id: string
  product_name: string
  image_url: string | null
  item_type: string
  brand_name: string | null
}

interface InventoryPickerProps {
  // Optional: only show items matching these types (e.g. ['shirt','blouse']).
  // When omitted, all items are searchable.
  itemTypes?: string[]
  // Label for the expand toggle.
  label?: string
  // Called with the chosen item_id. Parent performs the actual add.
  onSelect: (item: InventoryPickerItem) => Promise<void> | void
  // Disables the picker entirely (e.g. outfit not saved yet).
  disabledReason?: string | null
}

export default function InventoryPicker({
  itemTypes,
  label = 'OR PICK FROM INVENTORY',
  onSelect,
  disabledReason,
}: InventoryPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<InventoryPickerItem[]>([])
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(async () => {
      setLoading(true)
      setError(null)
      const res = await searchItemInventory(query)
      setLoading(false)
      if (res.error) { setError(res.error); return }
      const all = res.data ?? []
      setResults(itemTypes && itemTypes.length ? all.filter((r) => itemTypes.includes(r.item_type)) : all)
    }, 200)
    return () => clearTimeout(t)
  }, [open, query, itemTypes?.join(',')])

  if (disabledReason) {
    return (
      <p className="text-[9px] tracking-[0.15em] text-[#A8A8A4] mt-2">{disabledReason}</p>
    )
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left text-[9px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors py-1 border-t border-[#E2E0DB] pt-3"
      >
        {open ? `▾ ${label}` : `▸ ${label}`}
      </button>

      {open && (
        <div className="mt-2">
          <input
            type="text"
            placeholder="SEARCH BY NAME..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full border border-[#E2E0DB] bg-white px-3 py-1.5 text-[10px] tracking-[0.10em] text-[#0A0A0A] focus:outline-none focus:border-[#0A0A0A] transition-colors"
          />

          {loading ? (
            <p className="mt-2 text-[9px] tracking-[0.15em] text-[#A8A8A4]">LOADING...</p>
          ) : results.length === 0 ? (
            <p className="mt-2 text-[9px] tracking-[0.15em] text-[#A8A8A4]">
              NO MATCHING ITEMS.
            </p>
          ) : (
            <ul className="mt-2 max-h-56 overflow-y-auto divide-y divide-[#E2E0DB] border border-[#E2E0DB] bg-white">
              {results.map((r) => (
                <li key={r.item_id} className="flex items-center gap-2 p-2">
                  {r.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image_url} alt={r.product_name} className="w-8 h-10 object-cover border border-[#E2E0DB] shrink-0" />
                  ) : (
                    <div className="w-8 h-10 bg-[#F2F2F0] border border-[#E2E0DB] shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] tracking-[0.15em] text-[#A8A8A4] truncate">
                      {r.brand_name?.toUpperCase() ?? '—'}
                    </p>
                    <p className="text-[10px] tracking-[0.10em] text-[#0A0A0A] truncate">
                      {r.product_name}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setAddingId(r.item_id)
                      setError(null)
                      try {
                        await onSelect(r)
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Add failed')
                      }
                      setAddingId(null)
                    }}
                    disabled={addingId !== null}
                    className="shrink-0 border border-[#0A0A0A] text-[#0A0A0A] px-2 py-1 text-[9px] tracking-[0.15em] hover:bg-[#0A0A0A] hover:text-white disabled:opacity-40 transition-colors"
                  >
                    {addingId === r.item_id ? 'ADDING...' : 'ADD'}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="mt-2 text-[9px] tracking-[0.12em] text-red-500">{error}</p>
          )}
        </div>
      )}
    </div>
  )
}
