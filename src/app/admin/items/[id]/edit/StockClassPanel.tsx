'use client'

import { useState } from 'react'
import { setItemStockClass, refreshItemSizes, markItemSold } from '@/app/admin/items/stock-class-actions'
import type { SizeRow } from '@/lib/size-match'

/**
 * The two facts about a piece that change how the whole system treats it.
 *
 *   STOCK CLASS  unique means quantity 1 and gone forever when it sells: its
 *                live looks RETIRE (they can't come back), its saved looks are
 *                restyled once for everyone, and it is hard-filtered by size
 *                rather than merely ranked.
 *   SIZE ROWS    what the size gate and every "in your size" alert read. Both
 *                the retailer's own label and the canonical value are kept —
 *                she sees "IT 42", we match on 10.
 */
export default function StockClassPanel({
  itemId,
  stockClass,
  status,
  soldAt,
  sizes,
}: {
  itemId: string
  stockClass: 'replenishable' | 'unique'
  status: string
  soldAt: string | null
  sizes: SizeRow[]
}) {
  const [cls, setCls] = useState(stockClass)
  const [rows, setRows] = useState(sizes)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const sold = status === 'sold'

  async function change(next: 'replenishable' | 'unique') {
    setCls(next)
    setBusy('class')
    const res = await setItemStockClass(itemId, next)
    setMessage(res.error ?? null)
    setBusy(null)
  }

  async function refresh() {
    setBusy('sizes')
    const res = await refreshItemSizes(itemId)
    if (res.error) setMessage(res.error)
    else { setRows(res.sizes ?? []); setMessage(`${res.sizes?.length ?? 0} sizes read from the retailer`) }
    setBusy(null)
  }

  return (
    <div className="border border-[#E2E0DB] bg-white p-5">
      <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-4">STOCK CLASS &amp; SIZES</p>

      <div className="flex flex-wrap gap-2 mb-2">
        {(['replenishable', 'unique'] as const).map((option) => (
          <button
            key={option}
            type="button"
            disabled={sold || busy === 'class'}
            onClick={() => change(option)}
            className={`text-[10px] tracking-[0.09em] px-4 py-2 border transition-colors disabled:opacity-40 ${
              cls === option
                ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
                : 'border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A]'
            }`}
          >
            {option === 'unique' ? 'ONE OF ONE' : 'REPLENISHABLE'}
          </button>
        ))}
      </div>
      <p className="text-[9px] tracking-[0.054em] text-[#A8A8A4] leading-relaxed mb-5">
        {cls === 'unique'
          ? 'QUANTITY 1. WHEN IT SELLS ITS LIVE LOOKS RETIRE PERMANENTLY, SAVED LOOKS ARE RESTYLED ONCE FOR EVERYONE, AND IT IS NEVER RE-CHECKED OR RESTORED.'
          : 'RESTOCKS. GOING OUT OF STOCK PAUSES ITS LOOKS AND STARTS THE 30-DAY RESTOCK WATCH.'}
      </p>

      {sold ? (
        <p className="text-[10px] tracking-[0.068em] text-[#B83A3A] mb-5">
          SOLD{soldAt ? ` ${new Date(soldAt).toLocaleDateString('en-GB')}` : ''} — THIS CANNOT BE UNDONE.
        </p>
      ) : cls === 'unique' ? (
        <button
          type="button"
          disabled={busy === 'sold'}
          onClick={async () => {
            setBusy('sold')
            const res = await markItemSold(itemId)
            setMessage(res.error ?? `${res.retired ?? 0} looks retired · ${res.rescued ?? 0} saved looks being restyled`)
            setBusy(null)
          }}
          className="text-[10px] tracking-[0.09em] text-[#B83A3A] border border-[#E2D6D6] px-4 py-2 hover:border-[#B83A3A] transition-colors mb-5 disabled:opacity-40"
        >
          {busy === 'sold' ? 'MARKING…' : 'MARK AS SOLD'}
        </button>
      ) : null}

      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4]">SIZE AVAILABILITY</p>
        <button
          type="button"
          disabled={busy === 'sizes'}
          onClick={refresh}
          className="text-[9px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors disabled:opacity-40"
        >
          {busy === 'sizes' ? 'READING…' : 'RE-READ FROM RETAILER'}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-[9px] tracking-[0.054em] text-[#A8A8A4] leading-relaxed">
          NO SIZE DATA. THE SIZE GATE TREATS THIS AS UNKNOWN — WHICH NEVER HIDES A PIECE.
        </p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.size_label} className="flex items-center gap-3 text-[10px] tracking-[0.045em]">
              <span className="w-[80px] text-[#4A4E57]">{r.size_label}</span>
              <span className="w-[120px] text-[#A8A8A4]">
                {r.canonical_value != null ? `canonical ${r.canonical_value}` : 'unresolved'}
              </span>
              <span
                className={
                  r.stock_level === 'sold_out'
                    ? 'text-[#B83A3A]'
                    : r.stock_level === 'low'
                      ? 'text-[#8B5E00]'
                      : 'text-[#3A6B3A]'
                }
              >
                {r.stock_level.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      )}

      {message && <p className="mt-3 text-[9px] tracking-[0.054em] text-[#6B6B6B]">{message}</p>}
    </div>
  )
}
