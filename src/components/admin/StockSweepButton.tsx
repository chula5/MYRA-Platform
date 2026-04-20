'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { listItemsForStockSweep, checkItemStock } from '@/app/admin/items/stock-check'

const CONCURRENCY = 4

type Tally = { in_stock: number; low_stock: number; out_of_stock: number; unknown: number; failed: number }

export default function StockSweepButton() {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [total, setTotal] = useState(0)
  const [done, setDone] = useState(0)
  const [tally, setTally] = useState<Tally | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSweep() {
    setRunning(true)
    setError(null)
    setTally(null)
    setDone(0)

    const items = await listItemsForStockSweep()
    setTotal(items.length)

    if (items.length === 0) {
      setError('No items with a retailer URL to check')
      setRunning(false)
      return
    }

    const running: Tally = { in_stock: 0, low_stock: 0, out_of_stock: 0, unknown: 0, failed: 0 }

    // Concurrency pool — process items in parallel batches of CONCURRENCY.
    const queue = [...items]
    async function worker() {
      while (queue.length > 0) {
        const next = queue.shift()
        if (!next) return
        const result = await checkItemStock(next.itemId)
        if (result.error || !result.status) {
          running.failed++
        } else {
          running[result.status]++
        }
        setDone((d) => d + 1)
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

    setTally({ ...running })
    setRunning(false)
    router.refresh()
  }

  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="border border-[#E2E0DB] bg-white p-5 rounded-[3px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] tracking-[0.20em] text-[#0A0A0A] mb-1">CHECK ALL STOCK</p>
          <p className="text-[10px] tracking-[0.12em] text-[#6B6B6B]">
            Sweeps every item with a retailer URL and flags low stock or out of stock.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSweep}
          disabled={running}
          className="shrink-0 bg-[#0A0A0A] text-white px-5 py-2.5 text-[10px] tracking-[0.20em] hover:bg-[#333] disabled:opacity-50 transition-colors"
        >
          {running ? `CHECKING ${done}/${total}...` : 'RUN STOCK CHECK →'}
        </button>
      </div>

      {running && total > 0 && (
        <div className="mt-4">
          <div className="w-full h-1 bg-[#F2F2F0] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#0A0A0A] transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {tally && !running && (
        <div className="mt-4 flex flex-wrap gap-3 text-[10px] tracking-[0.15em]">
          <span className="text-[#3A6B3A]">{tally.in_stock} IN STOCK</span>
          {tally.low_stock > 0 && <span className="text-[#8B5E00]">· {tally.low_stock} LOW</span>}
          {tally.out_of_stock > 0 && <span className="text-[#B83A3A]">· {tally.out_of_stock} OUT</span>}
          {tally.unknown > 0 && <span className="text-[#6B6B6B]">· {tally.unknown} UNKNOWN</span>}
          {tally.failed > 0 && <span className="text-[#A8A8A4]">· {tally.failed} FAILED</span>}
        </div>
      )}

      {error && !running && (
        <p className="mt-3 text-[10px] tracking-[0.15em] text-red-500">{error}</p>
      )}
    </div>
  )
}
