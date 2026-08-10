'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { thumbUrl } from '@/lib/image-utils'
import {
  addPick,
  removePick,
  movePick,
  searchPickItems,
  type AdminPickRow,
  type PickCollection,
} from './actions'
import { PICKER_COLOURS, PICKER_TYPES } from '@/components/admin/ItemPickerModal'

const COLLECTION_META: Record<PickCollection, { title: string; blurb: string }> = {
  picks: {
    title: 'OUR PICKS — MAIN GRID',
    blurb: 'The pieces shown in the OUR PICKS section under New Outfits. Empty = automatic statement-first selection from the newest live looks.',
  },
  bags: {
    title: 'THE BAGS — HEADLINE BAG DESTINATION',
    blurb: 'What people see when they click the bag hanging from the OUR PICKS letters. Each bag shows the live outfits it appears in.',
  },
}

export default function PicksClient({
  initial,
  brands = [],
}: {
  initial: Record<PickCollection, AdminPickRow[]>
  brands?: { name: string; count: number }[]
}) {
  const router = useRouter()
  const [active, setActive] = useState<PickCollection>('picks')
  const [q, setQ] = useState('')
  // Standing admin convention: every item-browsing section filters by brand,
  // item type and colour.
  const [brand, setBrand] = useState('')
  const [itemType, setItemType] = useState('')
  const [colour, setColour] = useState('')
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchPickItems>>>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const rows = initial[active]
  const inCollection = new Set(rows.map((r) => r.item_id))

  useEffect(() => {
    let alive = true
    setSearching(true)
    const t = setTimeout(async () => {
      const res = await searchPickItems(q, active, { brand, itemType, colour })
      if (!alive) return
      setResults(res)
      setSearching(false)
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q, active, brand, itemType, colour])

  async function run(id: string, fn: () => Promise<{ error?: string } | { ok: true }>, okMsg?: string) {
    setBusy(id)
    const r: any = await fn()
    setBusy(null)
    setMsg(r?.error ? r.error.toUpperCase() : okMsg ?? null)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {(['picks', 'bags'] as const).map((c) => (
          <button
            key={c}
            onClick={() => { setActive(c); setQ('') }}
            className={`px-4 py-2 text-[10px] tracking-[0.14em] rounded-full border transition-colors ${
              active === c ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]'
            }`}
          >
            {c === 'picks' ? `OUR PICKS (${initial.picks.length})` : `THE BAGS (${initial.bags.length})`}
          </button>
        ))}
      </div>
      <p className="text-[9px] tracking-[0.06em] text-[#A8A8A4] max-w-2xl leading-relaxed">{COLLECTION_META[active].blurb.toUpperCase()}</p>
      {msg && (
        <p className={`text-[9px] tracking-[0.12em] ${msg.startsWith('✓') ? 'text-[#3D7A50]' : 'text-[#B83A3A]'}`}>{msg}</p>
      )}

      {/* Current collection, in display order */}
      <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-4">
        <p className="text-[10px] tracking-[0.135em] text-[#6B6B6B] mb-3">{COLLECTION_META[active].title}</p>
        {rows.length === 0 ? (
          <p className="text-[10px] tracking-[0.08em] text-[#A8A8A4] py-6 text-center">
            {active === 'picks' ? 'EMPTY — THE SECTION IS USING THE AUTOMATIC SELECTION. ADD ITEMS BELOW TO CURATE IT.' : 'EMPTY — ADD BAGS BELOW.'}
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={r.id} className="flex items-center gap-3 border border-[#F2F2F0] rounded-[10px] p-2">
                <span className="text-[10px] tracking-[0.06em] text-[#A8A8A4] w-5 text-center">{i + 1}</span>
                <div className="w-10 flex-shrink-0 rounded-[6px] overflow-hidden bg-[#F2F2F0]" style={{ height: 52 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.image_url && <img src={thumbUrl(r.image_url, 300)} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] tracking-[0.06em] text-[#4A4E57] truncate">
                    {[r.brand_name, r.product_name].filter(Boolean).join(' — ').toUpperCase()}
                  </p>
                  <p className="text-[8px] tracking-[0.08em] text-[#A8A8A4]">
                    {r.item_type.replace(/_/g, ' ').toUpperCase()}
                    {r.status !== 'live' && <span className="text-[#B83A3A]"> · {r.status.toUpperCase()} — WON&rsquo;T SHOW UNTIL LIVE</span>}
                  </p>
                </div>
                <button onClick={() => run(r.id, () => movePick(r.id, 'up'))} disabled={!!busy || i === 0} className="px-2 py-1 text-[10px] border border-[#E2E0DB] rounded text-[#6B6B6B] hover:border-[#0A0A0A] disabled:opacity-30">↑</button>
                <button onClick={() => run(r.id, () => movePick(r.id, 'down'))} disabled={!!busy || i === rows.length - 1} className="px-2 py-1 text-[10px] border border-[#E2E0DB] rounded text-[#6B6B6B] hover:border-[#0A0A0A] disabled:opacity-30">↓</button>
                <button onClick={() => run(r.id, () => removePick(r.id))} disabled={!!busy} className="px-3 py-1 text-[9px] tracking-[0.1em] border border-[#E2E0DB] rounded-full text-[#B83A3A] hover:border-[#B83A3A] disabled:opacity-50">REMOVE</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add items */}
      <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-4">
        <p className="text-[10px] tracking-[0.135em] text-[#6B6B6B] mb-3">ADD TO {active === 'picks' ? 'OUR PICKS' : 'THE BAGS'}</p>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={active === 'bags' ? 'SEARCH BAGS BY NAME… (EMPTY = ALL BAGS)' : 'SEARCH ITEMS BY NAME…'}
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
        {/* Colour + item-type filters */}
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
        <div className="flex flex-wrap gap-1.5 mb-4">
          {PICKER_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setItemType(itemType === t.value ? '' : t.value)}
              className={`px-2.5 py-1.5 text-[8px] tracking-[0.08em] rounded-full border transition-colors ${
                itemType === t.value ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white' : 'border-[#E2E0DB] text-[#4A4E57] hover:border-[#0A0A0A]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {searching ? (
          <p className="text-[10px] tracking-[0.14em] text-[#A8A8A4] py-6 text-center">SEARCHING…</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-3">
            {results.map((it) => {
              const added = inCollection.has(it.item_id)
              return (
                <div key={it.item_id} className="text-left">
                  <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0] relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {it.image_url && <img src={thumbUrl(it.image_url, 400)} alt="" className="w-full h-full object-cover" />}
                    {it.status !== 'live' && (
                      <span className="absolute top-1 left-1 bg-[#8B5E00] text-white text-[6px] tracking-[0.08em] px-1 py-0.5 rounded">{it.status.toUpperCase()}</span>
                    )}
                  </div>
                  <p className="text-[7px] tracking-[0.08em] text-[#6B6B6B] mt-1 truncate">{(it.brand_name ?? '').toUpperCase()}</p>
                  <p className="text-[8px] tracking-[0.04em] text-[#4A4E57] truncate">{it.product_name}</p>
                  <button
                    onClick={() => run(it.item_id, () => addPick(active, it.item_id), `✓ ADDED TO ${active === 'bags' ? 'THE BAGS' : 'OUR PICKS'} — SEE THE LIST ABOVE`)}
                    disabled={!!busy || added}
                    className={`mt-1 w-full py-1 text-[8px] tracking-[0.12em] rounded-full border transition-colors disabled:opacity-40 ${
                      added ? 'border-[#C9E0CF] text-[#3D7A50]' : 'border-[#0A0A0A] text-[#4A4E57] hover:bg-[#0A0A0A] hover:text-white'
                    }`}
                  >
                    {added ? '✓ ADDED' : busy === it.item_id ? '…' : '+ ADD'}
                  </button>
                </div>
              )
            })}
            {results.length === 0 && <p className="col-span-full text-[10px] tracking-[0.12em] text-[#A8A8A4] py-6 text-center">NO MATCHES.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
