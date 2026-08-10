'use client'

import { useMemo, useState, useTransition } from 'react'
import { uploadBrandLogo, fetchBrandLogoFromUrl, clearBrandLogo, type BrandLogoRow } from './actions'

type Filter = 'all' | 'missing' | 'has'

export default function BrandLogoManager({ initial }: { initial: BrandLogoRow[] }) {
  const [rows, setRows] = useState(initial)
  const [brandQuery, setBrandQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('missing')
  const [stockedOnly, setStockedOnly] = useState(true)
  const [busy, startTransition] = useTransition()
  const [message, setMessage] = useState<{ id: string; text: string; bad?: boolean } | null>(null)

  const visible = useMemo(() => {
    const q = brandQuery.trim().toLowerCase()
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false
      if (filter === 'missing' && r.logo_url) return false
      if (filter === 'has' && !r.logo_url) return false
      if (stockedOnly && r.item_count === 0) return false
      return true
    })
  }, [rows, brandQuery, filter, stockedOnly])

  const withLogo = rows.filter((r) => r.logo_url).length

  function apply(id: string, url: string | null) {
    setRows((prev) => prev.map((r) => (r.brand_id === id ? { ...r, logo_url: url } : r)))
  }

  function onUrl(row: BrandLogoRow, url: string) {
    if (!url.trim()) return
    startTransition(async () => {
      const res = await fetchBrandLogoFromUrl(row.brand_id, row.name, url)
      if ('error' in res && res.error) setMessage({ id: row.brand_id, text: res.error, bad: true })
      else if ('url' in res && res.url) { apply(row.brand_id, res.url); setMessage({ id: row.brand_id, text: 'SAVED' }) }
    })
  }

  function onFile(row: BrandLogoRow, file: File) {
    const fd = new FormData()
    fd.set('brand_id', row.brand_id)
    fd.set('name', row.name)
    fd.set('file', file)
    startTransition(async () => {
      const res = await uploadBrandLogo(fd)
      if ('error' in res && res.error) setMessage({ id: row.brand_id, text: res.error, bad: true })
      else if ('url' in res && res.url) { apply(row.brand_id, res.url); setMessage({ id: row.brand_id, text: 'SAVED' }) }
    })
  }

  return (
    <div>
      {/* Filters — brand search, plus whether the logo is set and whether the
          brand actually carries stock. */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          value={brandQuery}
          onChange={(e) => setBrandQuery(e.target.value)}
          placeholder="FILTER BY BRAND…"
          className="border border-[#E2E0DB] bg-white px-4 py-2.5 text-[11px] tracking-[0.054em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] w-[240px]"
        />
        {(['missing', 'has', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2.5 text-[10px] tracking-[0.12em] border transition-colors ${
              filter === f ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'text-[#4A4E57] border-[#E2E0DB] hover:border-[#0A0A0A]'
            }`}
          >
            {f === 'missing' ? 'NO LOGO' : f === 'has' ? 'HAS LOGO' : 'ALL'}
          </button>
        ))}
        <label className="flex items-center gap-2 text-[10px] tracking-[0.1em] text-[#4A4E57]">
          <input type="checkbox" checked={stockedOnly} onChange={(e) => setStockedOnly(e.target.checked)} />
          ONLY BRANDS WITH ITEMS
        </label>
        <span className="ml-auto text-[10px] tracking-[0.1em] text-[#4A4E57]">
          {withLogo}/{rows.length} HAVE LOGOS · SHOWING {visible.length}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visible.map((row) => (
          <div key={row.brand_id} className="border border-[#E2E0DB] bg-white p-4 flex gap-4">
            <div className="shrink-0 w-[92px] h-[92px] border border-[#EFEDE9] flex items-center justify-center bg-[#FAFAF8]">
              {row.logo_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={row.logo_url} alt="" className="max-h-[76px] max-w-[80px] object-contain" />
              ) : (
                <span className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">NONE</span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[13px] tracking-[0.06em] text-[#4A4E57] truncate">{row.name}</p>
                <span className="text-[9px] tracking-[0.08em] text-[#A8A8A4] shrink-0">{row.item_count} ITEMS</span>
              </div>

              <input
                placeholder="PASTE IMAGE URL, THEN ENTER"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onUrl(row, (e.target as HTMLInputElement).value)
                  }
                }}
                className="mt-2 w-full border border-[#E2E0DB] bg-[#FAFAF8] px-3 py-2 text-[10px] tracking-[0.05em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A]"
              />

              <div className="mt-2 flex items-center gap-3">
                <label className="text-[10px] tracking-[0.1em] text-[#4A4E57] border border-[#E2E0DB] px-3 py-1.5 cursor-pointer hover:border-[#0A0A0A]">
                  UPLOAD FILE
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) onFile(row, f)
                      e.target.value = ''
                    }}
                  />
                </label>
                {row.logo_url && (
                  <button
                    onClick={() =>
                      startTransition(async () => {
                        await clearBrandLogo(row.brand_id)
                        apply(row.brand_id, null)
                      })
                    }
                    className="text-[10px] tracking-[0.1em] text-[#B83A3A] hover:underline"
                  >
                    CLEAR
                  </button>
                )}
                {message?.id === row.brand_id && (
                  <span className={`text-[10px] tracking-[0.08em] ${message.bad ? 'text-[#B83A3A]' : 'text-[#3D6B4F]'}`}>
                    {message.text.toUpperCase()}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="py-16 text-center text-[11px] tracking-[0.1em] text-[#A8A8A4]">NOTHING MATCHES THOSE FILTERS</p>
      )}
      {busy && <p className="mt-4 text-[10px] tracking-[0.1em] text-[#A8A8A4]">WORKING…</p>}
    </div>
  )
}
