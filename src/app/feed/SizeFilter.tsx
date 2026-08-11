'use client'

import { useEffect, useRef, useState } from 'react'
import { CLOTHING_SIZES, clothingLabel } from '@/lib/sizing'

/**
 * Clothing size picker. Each row shows every system's equivalent
 * (UK · US · EU · AU · alpha) so the shopper recognises their size in whichever
 * one they know. Value is the canonical UK number; null = all sizes.
 */
export default function SizeFilter({
  value,
  onChange,
  compact = false,
}: {
  value: number | null
  onChange: (uk: number | null) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = value != null ? CLOTHING_SIZES.find((r) => r.uk === value) : null

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const trigger = compact
    ? `text-[14px] tracking-[0.1em] px-6 py-3 rounded-full border transition-colors ${
        current ? 'border-[#0A0A0A] text-[#4A4E57]' : 'border-[#E2E0DB] text-[#4A4E57] hover:border-[#0A0A0A] hover:text-[#4A4E57]'
      }`
    // Matches the COLOUR / ITEM TYPE / BRAND buttons beside it exactly:
    // plain text on the grey ground, no box.
    : `myra-field py-2 bg-transparent transition-opacity duration-300 ${
        current ? '' : 'opacity-45 hover:opacity-100'
      }`

  return (
    <div ref={ref} className="relative inline-block">
      <button onClick={() => setOpen((o) => !o)} className={trigger}>
        {current ? `SIZE · UK ${current.uk}` : 'SIZE'} {open ? '▲' : '▾'}
      </button>
      {open && (
        <div data-lenis-prevent className="absolute z-30 mt-2 right-0 w-[248px] border border-[#E2E0DB] bg-white rounded-[12px] p-2 shadow-[0_6px_24px_rgba(0,0,0,0.08)] max-h-[340px] overflow-y-auto">
          <button
            onClick={() => { onChange(null); setOpen(false) }}
            className={`w-full text-left px-3 py-2 text-[10px] tracking-[0.08em] rounded-[8px] hover:bg-[#F2F2F2] ${value == null ? 'text-[#4A4E57]' : 'text-[#4A4E57]'}`}
          >
            ALL SIZES
          </button>
          <div className="my-1 border-t border-[#EFEDE9]" />
          {CLOTHING_SIZES.map((r) => (
            <button
              key={r.uk}
              onClick={() => { onChange(r.uk); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-[10px] tracking-[0.04em] rounded-[8px] hover:bg-[#F2F2F2] ${value === r.uk ? 'text-[#4A4E57] bg-[#F2F2F2]' : 'text-[#4A4E57]'}`}
            >
              {clothingLabel(r)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
