'use client'

// Shared swap/add item picker for the pipeline + review surfaces.
// Text search, brand dropdown, and one-tap COLOUR + ITEM TYPE filters so
// "black heels" is two taps, not a typed query.

import { useEffect, useState } from 'react'
import { thumbUrl } from '@/lib/image-utils'

export interface PickerOption {
  slot: string
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  price: string
  compat: number
  stock_status?: string | null
}

export const PICKER_COLOURS: { value: string; label: string; swatch: string }[] = [
  { value: 'black', label: 'BLACK', swatch: '#111' },
  { value: 'white', label: 'WHITE', swatch: '#fff' },
  { value: 'cream', label: 'CREAM', swatch: '#f1e9d9' },
  { value: 'grey', label: 'GREY', swatch: '#9a9a9a' },
  { value: 'navy', label: 'NAVY', swatch: '#1d2a44' },
  { value: 'brown', label: 'BROWN', swatch: '#6b4a2f' },
  { value: 'camel', label: 'CAMEL', swatch: '#c19a6b' },
  { value: 'green', label: 'GREEN', swatch: '#3d6b45' },
  { value: 'burgundy', label: 'BURGUNDY', swatch: '#6d1f2c' },
  { value: 'red', label: 'RED', swatch: '#b3202a' },
  { value: 'blue', label: 'BLUE', swatch: '#3565b0' },
  { value: 'pink', label: 'PINK', swatch: '#e6a6b5' },
]

export const PICKER_TYPES: { value: string; label: string }[] = [
  { value: 'heel', label: 'HEELS' },
  { value: 'flat', label: 'FLATS' },
  { value: 'sandal', label: 'SANDALS' },
  { value: 'mule', label: 'MULES' },
  { value: 'boot', label: 'BOOTS' },
  { value: 'sneaker', label: 'SNEAKERS' },
  { value: 'tote', label: 'TOTE' },
  { value: 'shoulder_bag', label: 'SHOULDER BAG' },
  { value: 'clutch', label: 'CLUTCH' },
  { value: 'crossbody', label: 'CROSSBODY' },
  { value: 'necklace', label: 'NECKLACE' },
  { value: 'earrings', label: 'EARRINGS' },
  { value: 'jacket', label: 'JACKET' },
  { value: 'blazer', label: 'BLAZER' },
  { value: 'coat', label: 'COAT' },
  { value: 'knitwear', label: 'KNITWEAR' },
  { value: 'skirt', label: 'SKIRT' },
  { value: 'trousers', label: 'TROUSERS' },
]

export default function ItemPickerModal({
  title,
  mode,
  anchorItemId,
  slot,
  presentSlots = [],
  excludeItemIds,
  onPick,
  onClose,
}: {
  title: string
  mode: 'swap' | 'add'
  anchorItemId: string
  slot?: string
  presentSlots?: string[]
  excludeItemIds: string[]
  onPick: (opt: PickerOption) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('')
  const [colour, setColour] = useState('')
  const [type, setType] = useState('')
  const [brands, setBrands] = useState<{ name: string; count: number }[]>([])
  const [options, setOptions] = useState<PickerOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const sp = new URLSearchParams()
    sp.set('mode', mode)
    sp.set('anchor', anchorItemId)
    sp.set('q', q)
    sp.set('exclude', excludeItemIds.join(','))
    if (slot) sp.set('slot', slot)
    if (presentSlots.length) sp.set('present', presentSlots.join(','))
    if (brand) sp.set('brand', brand)
    if (colour) sp.set('colour', colour)
    if (type) sp.set('type', type)
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/review-options?${sp.toString()}`, { cache: 'no-store' })
        const data = r.ok ? await r.json() : { options: [] }
        if (!alive) return
        setOptions(data.options ?? [])
        setBrands(data.brands ?? [])
      } catch {
        if (alive) setOptions([])
      } finally {
        if (alive) setLoading(false)
      }
    }, 220)
    return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, brand, colour, type, anchorItemId, slot, mode])

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-14 px-4" onClick={onClose}>
      <div className="bg-white border border-[#E2E0DB] rounded-[12px] w-full max-w-3xl max-h-[84vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-[#E2E0DB]">
          <p className="text-[10px] tracking-[0.16em] text-[#6B6B6B]">{title}</p>
          <button onClick={onClose} className="text-[#A8A8A4] hover:text-[#0A0A0A] text-[18px] leading-none">×</button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="SEARCH BY NAME, BRAND OR TYPE…"
            className="flex-1 border border-[#E2E0DB] rounded-[10px] px-4 py-2.5 text-[11px] tracking-[0.08em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A]"
          />
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="sm:w-[190px] border border-[#E2E0DB] rounded-[10px] px-3 py-2.5 text-[11px] tracking-[0.08em] text-[#4A4E57] bg-white focus:outline-none focus:border-[#0A0A0A]"
          >
            <option value="">ALL BRANDS</option>
            {brands.map((b) => (
              <option key={b.name} value={b.name}>{b.name.toUpperCase()} ({b.count})</option>
            ))}
          </select>
        </div>

        {/* Colour filter — "black heels" in two taps */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {PICKER_COLOURS.map((c) => (
            <button
              key={c.value}
              onClick={() => setColour(colour === c.value ? '' : c.value)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[8px] tracking-[0.08em] rounded-full border transition-colors ${
                colour === c.value ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white' : 'border-[#E2E0DB] text-[#4A4E57] hover:border-[#0A0A0A]'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full border border-[#E2E0DB]" style={{ background: c.swatch }} />
              {c.label}
            </button>
          ))}
        </div>
        {/* Item-type filter */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {PICKER_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setType(type === t.value ? '' : t.value)}
              className={`px-2.5 py-1.5 text-[8px] tracking-[0.08em] rounded-full border transition-colors ${
                type === t.value ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white' : 'border-[#E2E0DB] text-[#4A4E57] hover:border-[#0A0A0A]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-[10px] tracking-[0.16em] text-[#A8A8A4] py-8 text-center">LOADING…</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {options.map((opt) => (
              <button key={opt.item_id} onClick={() => onPick(opt)} className="group text-left">
                <div className={`aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0] ${opt.stock_status === 'out_of_stock' ? 'ring-1 ring-[#E8B4B4]' : ''}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbUrl(opt.image_url, 600)} alt="" className="w-full h-full object-cover group-hover:opacity-90" />
                </div>
                <p className="text-[8px] tracking-[0.08em] text-[#6B6B6B] mt-1 truncate">{(opt.brand_name ?? '').toUpperCase()}</p>
                <p className="text-[9px] tracking-[0.04em] text-[#4A4E57] truncate">{opt.product_name}</p>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[8px] tracking-[0.06em] text-[#4A4E57]">{opt.price}</span>
                  <span className="text-[8px] tracking-[0.06em] text-[#A8A8A4]">{(opt.compat * 100).toFixed(0)}</span>
                </div>
              </button>
            ))}
            {options.length === 0 && (
              <p className="col-span-full text-[10px] tracking-[0.14em] text-[#A8A8A4] py-6 text-center">NO MATCHES — TRY CLEARING A FILTER.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
