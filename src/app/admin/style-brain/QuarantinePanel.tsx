'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { thumbUrl } from '@/lib/image-utils'
import { retireQuarantinedItem, keepQuarantinedItem, generateCalibrationReport } from './actions'
import type { QuarantinedItem } from '@/lib/pipeline-store'

// The weekly "retire or keep?" list: items ejected 3+ times are quarantined out
// of every composer pool until you rule on them here.
export function QuarantinePanel({ items }: { items: QuarantinedItem[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [gone, setGone] = useState<Set<string>>(new Set())

  async function verdict(itemId: string, keep: boolean) {
    setBusy((b) => ({ ...b, [itemId]: true }))
    const res = keep ? await keepQuarantinedItem(itemId) : await retireQuarantinedItem(itemId)
    setBusy((b) => ({ ...b, [itemId]: false }))
    if (!('error' in res) || !res.error) setGone((g) => new Set(g).add(itemId))
    router.refresh()
  }

  const visible = items.filter((i) => !gone.has(i.item_id))
  if (!visible.length) return null

  return (
    <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[12px] p-6 mb-6">
      <p className="text-[10px] tracking-[0.099em] text-[#8A7A4E] mb-1">QUARANTINED ITEMS — RETIRE OR KEEP?</p>
      <p className="text-[9px] tracking-[0.06em] text-[#8A7A4E]/80 mb-4 max-w-[720px] leading-relaxed">
        Ejected 3+ times across contexts, so the composer has stopped proposing them. RETIRE archives
        the item; KEEP clears its record and gives it another chance.
      </p>
      <div className="space-y-2">
        {visible.map((it) => (
          <div key={it.item_id} className="flex items-center gap-3 bg-white border border-[#E2E0DB] rounded-[10px] p-2.5">
            <div className="w-10 h-13 flex-shrink-0 rounded-[6px] overflow-hidden bg-[#F2F2F0]" style={{ height: 52 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {it.image_url && <img src={thumbUrl(it.image_url, 300)} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] tracking-[0.06em] text-[#4A4E57] truncate">
                {[it.brand_name, it.product_name].filter(Boolean).join(' — ').toUpperCase()}
              </p>
              <p className="text-[8px] tracking-[0.06em] text-[#A8A8A4] truncate">
                EJECTED {it.ejections}× · {it.contexts.join(' · ').toUpperCase()}
              </p>
            </div>
            <button
              onClick={() => verdict(it.item_id, false)}
              disabled={busy[it.item_id]}
              className="px-3 py-1.5 text-[9px] tracking-[0.12em] border border-[#B83A3A] text-[#B83A3A] rounded-full hover:bg-[#B83A3A] hover:text-white transition-colors disabled:opacity-50"
            >
              RETIRE
            </button>
            <button
              onClick={() => verdict(it.item_id, true)}
              disabled={busy[it.item_id]}
              className="px-3 py-1.5 text-[9px] tracking-[0.12em] border border-[#3D7A50] text-[#3D7A50] rounded-full hover:bg-[#3D7A50] hover:text-white transition-colors disabled:opacity-50"
            >
              KEEP
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ReportButton() {
  const router = useRouter()
  const [running, start] = useTransition()
  return (
    <button
      onClick={() => start(async () => { await generateCalibrationReport(); router.refresh() })}
      disabled={running}
      className="border border-[#0A0A0A] text-[#4A4E57] px-4 py-1.5 text-[9px] tracking-[0.14em] rounded-full hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-50"
    >
      {running ? 'GENERATING…' : '↻ GENERATE NOW'}
    </button>
  )
}
