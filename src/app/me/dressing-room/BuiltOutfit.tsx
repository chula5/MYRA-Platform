'use client'

// One outfit MYRA built around a piece of hers, laid out piece by piece so she
// can change any of it. ⇄ Swap opens the same ranking and gates the studio
// uses (her size, her avoids, what goes with the rest), with search and brand /
// type / colour filters. Undo steps back one change. Nothing is saved or learned
// here; it is her playing with the outfit.

import { useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import { PICKER_COLOURS, PICKER_TYPES } from '@/components/admin/ItemPickerModal'
import type { LookItem } from '@/lib/pilot-stylist'
import type { AskSwapOption } from '@/app/admin/private-stylist/actions'
import { swapInMyOutfit } from './actions'

const T = 'text-[19px] xl:text-[22px] 2xl:text-[26px]'
const chip = (on: boolean) =>
  `rounded-full px-4 py-2 ${T} transition-colors ${on ? 'bg-[#2B2B2B] text-white' : 'bg-white text-[#55534E] shadow-[0_6px_14px_-10px_rgba(43,43,43,0.6)]'}`

export default function BuiltOutfit({
  items: initial, heroId, why, testMemberId, onChange,
}: {
  items: LookItem[]
  heroId: string
  why: string
  testMemberId?: string
  onChange?: (items: LookItem[]) => void
}) {
  const [items, setItems] = useState<LookItem[]>(initial)
  const [undo, setUndo] = useState<LookItem[][]>([])
  const [swapAt, setSwapAt] = useState<number | null>(null)
  const [options, setOptions] = useState<AskSwapOption[]>([])
  const [brands, setBrands] = useState<{ name: string; count: number }[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('')
  const [type, setType] = useState('')
  const [colour, setColour] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load(at: number, f: { q?: string; brand?: string; itemType?: string; colour?: string }) {
    setLoading(true); setErr(null)
    let r: Awaited<ReturnType<typeof swapInMyOutfit>>
    try { r = await swapInMyOutfit(items, at, f, testMemberId) } catch { r = { error: 'Could not load pieces. Try again.' } }
    setLoading(false)
    if (r.error) { setErr(r.error); setOptions([]); return }
    setOptions(r.options ?? []); setBrands(r.brands ?? []); setTypes(r.types ?? [])
  }
  function open(at: number) {
    if (swapAt === at) { setSwapAt(null); return }
    setSwapAt(at); setQ(''); setBrand(''); setType(''); setColour('')
    void load(at, {})
  }
  const refilter = (next: { q?: string; brand?: string; itemType?: string; colour?: string }) => {
    const f = { q, brand, itemType: type, colour, ...next }
    if (swapAt != null) void load(swapAt, f)
  }
  function use(o: AskSwapOption) {
    if (swapAt == null) return
    const next = items.map((it, i) => (i === swapAt ? o.lookItem : it))
    setUndo((u) => [...u, items]); setItems(next); setSwapAt(null); onChange?.(next)
  }
  function back() {
    const prev = undo[undo.length - 1]
    if (!prev) return
    setUndo(undo.slice(0, -1)); setItems(prev); setSwapAt(null); onChange?.(prev)
  }

  return (
    <div className="bg-white rounded-[16px] overflow-hidden shadow-[0_1px_8px_rgba(43,43,43,0.06)]">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-[#EDEBE7]">
        {items.map((it, i) => {
          const isHero = it.item_id === heroId
          return (
            <div key={`${it.item_id ?? it.product_name}-${i}`} className={`bg-white flex flex-col ${swapAt === i ? 'ring-2 ring-inset ring-[#2B2B2B]' : ''}`}>
              <div className="relative aspect-[3/4] overflow-hidden">
                {it.image_url && <FallbackImage src={it.image_url} thumbWidth={400} alt={it.product_name} className="absolute inset-0 w-full h-full object-contain" />}
              </div>
              <div className="px-3 py-2.5 space-y-1">
                <p className={`${T} text-[#6E6B65] leading-tight truncate`}>{it.owned ? 'Yours' : it.brand}</p>
                <p className={`${T} text-[#2B2B2B] leading-tight line-clamp-2`}>{it.product_name}</p>
                {!isHero && (
                  <button type="button" onClick={() => open(i)} className={`${T} underline underline-offset-4 text-[#2B2B2B]`}>
                    {swapAt === i ? 'Close' : '⇄ Swap'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        {why && <p className={`${T} text-[#4A4E57] leading-snug flex-1 min-w-[240px]`}>{why}</p>}
        {undo.length > 0 && <button type="button" onClick={back} className={`${T} underline underline-offset-4 text-[#2B2B2B]`}>↶ Undo</button>}
      </div>

      {swapAt != null && (
        <div className="border-t border-[#EDEBE7] px-4 py-4 space-y-3 bg-[#FAF9F7]">
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); refilter({ q: e.target.value }) }}
            placeholder="Search pieces, brands, colours"
            className={`w-full rounded-full bg-white px-5 py-3 ${T} text-[#2B2B2B] outline-none shadow-[0_6px_14px_-10px_rgba(43,43,43,0.6)]`}
          />
          <div className="flex flex-wrap gap-2">
            <select value={brand} onChange={(e) => { setBrand(e.target.value); refilter({ brand: e.target.value }) }}
              className={`rounded-full bg-white px-4 py-2 ${T} text-[#2B2B2B] shadow-[0_6px_14px_-10px_rgba(43,43,43,0.6)]`}>
              <option value="">Any brand</option>
              {brands.map((b) => <option key={b.name} value={b.name}>{b.name} ({b.count})</option>)}
            </select>
            {PICKER_TYPES.filter((t) => types.includes(t.value)).map((t) => (
              <button key={t.value} type="button" onClick={() => { const v = type === t.value ? '' : t.value; setType(v); refilter({ itemType: v }) }} className={chip(type === t.value)}>
                {t.label.charAt(0) + t.label.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {PICKER_COLOURS.map((c) => (
              <button key={c.value} type="button" aria-label={c.label} title={c.label}
                onClick={() => { const v = colour === c.value ? '' : c.value; setColour(v); refilter({ colour: v }) }}
                className={`w-9 h-9 rounded-full border ${colour === c.value ? 'ring-2 ring-offset-2 ring-[#2B2B2B]' : ''}`}
                style={{ background: c.swatch, borderColor: '#D8D6D1' }} />
            ))}
          </div>
          {err && <p className={`${T} text-[#9B3A3A]`}>{err}</p>}
          {loading ? (
            <p className={`${T} text-[#6E6B65]`}>Finding pieces that go…</p>
          ) : !options.length ? (
            <p className={`${T} text-[#6E6B65]`}>Nothing matches. Clear a filter.</p>
          ) : (
            <div className="grid grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-3 max-h-[70vh] overflow-y-auto" data-lenis-prevent>
              {options.map((o) => (
                <button key={o.item_id} type="button" onClick={() => use(o)} className="text-left bg-white rounded-[12px] overflow-hidden hover:ring-2 hover:ring-[#2B2B2B]">
                  <div className="relative aspect-[3/4]">
                    {o.image_url && <FallbackImage src={o.image_url} thumbWidth={300} alt={o.product_name} className="absolute inset-0 w-full h-full object-contain" />}
                  </div>
                  <div className="px-2 py-2">
                    <p className="text-[16px] xl:text-[18px] text-[#6E6B65] truncate">{o.brand_name}</p>
                    <p className="text-[16px] xl:text-[18px] text-[#2B2B2B] line-clamp-2 leading-tight">{o.product_name}</p>
                    {o.price_gbp != null && <p className="text-[16px] xl:text-[18px] text-[#2B2B2B]">£{Math.round(o.price_gbp)}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
