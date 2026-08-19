'use client'

import { useMemo, useState, useTransition } from 'react'
import { setBrandCode, type CodeDimension, type CodesBrand } from './actions'

const CHIP = 'px-3 py-1.5 rounded-full text-[9px] tracking-[0.12em] border transition-colors'
const CHIP_ON = `${CHIP} bg-[#0A0A0A] text-white border-[#0A0A0A]`
const CHIP_OFF = `${CHIP} bg-white text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]`
const INPUT = 'border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[10px] tracking-[0.06em] outline-none focus:border-[#0A0A0A] bg-white'

const COMPARE_COLOURS = ['#0A0A0A', '#C4A882', '#6D1F2C', '#3565B0']

// 1-5 → 0..1 along a track
const t = (v: number) => (Math.min(5, Math.max(1, v)) - 1) / 4

function Track({ value, ghost, compare, onClick }: {
  value: number | null
  ghost: number | null
  compare?: Array<{ v: number | null; colour: string }>
  onClick?: () => void
}) {
  return (
    <button onClick={onClick} className="relative w-full h-6 group" title={onClick ? 'Click to score' : undefined}>
      <span className="absolute left-1 right-1 top-1/2 h-px bg-[#E2E0DB]" />
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className="absolute top-1/2 -translate-y-1/2 w-[3px] h-[3px] rounded-full bg-[#D8D6D0]" style={{ left: `calc(${t(n) * 100}% * 0.92 + 4%)` }} />
      ))}
      {ghost != null && (
        <span
          className="absolute top-1/2 -translate-y-1/2 w-[9px] h-[9px] rounded-full border-[1.5px] border-[#C4A882] bg-transparent"
          style={{ left: `calc(${t(ghost) * 100}% * 0.92 + 4% - 4px)` }}
          title={`stocked-item profile: ${ghost}`}
        />
      )}
      {compare
        ? compare.map((c, i) => c.v != null && (
          <span key={i} className="absolute top-1/2 -translate-y-1/2 w-[8px] h-[8px] rounded-full" style={{ left: `calc(${t(c.v) * 100}% * 0.92 + 4% - 4px)`, background: c.colour }} />
        ))
        : value != null && (
          <span className="absolute top-1/2 -translate-y-1/2 w-[9px] h-[9px] rounded-full bg-[#0A0A0A] group-hover:ring-2 group-hover:ring-[#C4A882]" style={{ left: `calc(${t(value) * 100}% * 0.92 + 4% - 4px)` }} />
        )}
      {value == null && !compare && <span className="absolute inset-0 group-hover:bg-[#FAFAF8]" />}
    </button>
  )
}

function Slider({ dim, value, ghost, onCommit }: {
  dim: CodeDimension
  value: number | null
  ghost: number | null
  onCommit: (v: number) => void
}) {
  const [v, setV] = useState(value ?? 3)
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[9px] tracking-[0.16em] text-[#4A4E57]">{dim.label}</p>
        <p className="text-[10px] tracking-[0.08em] text-[#0A0A0A]">{v.toFixed(1)}{ghost != null && <span className="text-[#C4A882]"> · buy {ghost}</span>}</p>
      </div>
      <input
        type="range" min={1} max={5} step={0.1} value={v}
        onChange={(e) => setV(parseFloat(e.target.value))}
        onPointerUp={() => onCommit(v)}
        onKeyUp={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') onCommit(v) }}
        className="w-full accent-[#0A0A0A]"
      />
      <div className="flex justify-between text-[7.5px] tracking-[0.04em] text-[#A8A8A4] normal-case">
        <span className="max-w-[45%]">{dim.anchors['1']}</span>
        <span className="max-w-[45%] text-right">{dim.anchors['5']}</span>
      </div>
    </div>
  )
}

export default function CodesClient({ dims, brands: initialBrands }: { dims: CodeDimension[]; brands: CodesBrand[] }) {
  const [pending, start] = useTransition()
  const [mode, setMode] = useState<'matrix' | 'bulk' | 'compare'>('matrix')
  const [brands, setBrands] = useState(initialBrands)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [cell, setCell] = useState<{ brandId: string; dim: string } | null>(null)
  const [bulkIdx, setBulkIdx] = useState(0)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [sortDisagreement, setSortDisagreement] = useState(false)

  const save = (brandId: string, dim: string, value: number) => {
    // optimistic — authored data, saved immediately, never recomputed over
    setBrands((bs) => bs.map((b) => {
      if (b.brand_id !== brandId) return b
      const codes = { ...b.codes, [dim]: value }
      return { ...b, codes, complete: dims.every((d) => codes[d.dimension_key] != null) }
    }))
    start(async () => {
      const r = await setBrandCode(brandId, dim, value)
      setNotice(r.error ?? `${brands.find((b) => b.brand_id === brandId)?.name.toUpperCase()} · ${dim.replace(/_/g, ' ').toUpperCase()} → ${value.toFixed(1)} (SAVED)`)
    })
  }

  const shown = useMemo(
    () => brands.filter((b) => !search || b.name.toLowerCase().includes(search.toLowerCase())),
    [brands, search],
  )
  const incompleteCount = brands.filter((b) => !b.complete).length
  const bulkBrand = shown[Math.min(bulkIdx, shown.length - 1)]
  const compared = compareIds.map((id) => brands.find((b) => b.brand_id === id)).filter(Boolean) as CodesBrand[]

  const compareRows = useMemo(() => {
    const rows = dims.map((d) => {
      const vals = compared.map((b) => b.codes[d.dimension_key]).filter((v) => v != null)
      const spread = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : 0
      return { d, spread }
    })
    return sortDisagreement ? [...rows].sort((a, b) => b.spread - a.spread) : rows
  }, [dims, compared, sortDisagreement])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {(['matrix', 'bulk', 'compare'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={mode === m ? CHIP_ON : CHIP_OFF}>
            {m === 'matrix' ? 'MATRIX' : m === 'bulk' ? 'BULK ENTRY' : 'COMPARE'}
          </button>
        ))}
        <input value={search} onChange={(e) => { setSearch(e.target.value); setBulkIdx(0) }} placeholder="FILTER BRANDS" className={`${INPUT} w-44 uppercase placeholder:text-[#A8A8A4]`} />
        <span className="text-[9px] tracking-[0.14em] text-[#A8A8A4]">
          {brands.length - incompleteCount}/{brands.length} FULLY CODED
        </span>
        {notice && <span className="text-[9px] tracking-[0.1em] text-[#C4A882] max-w-md truncate">{notice}</span>}
        {pending && <span className="text-[9px] tracking-[0.14em] text-[#A8A8A4]">SAVING…</span>}
      </div>

      {/* ═════════ MATRIX ═════════ */}
      {mode === 'matrix' && (
        <div className="border border-[#E2E0DB] rounded-[10px] bg-white overflow-x-auto" data-lenis-prevent>
          <table className="border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white z-10 text-left px-3 py-2 min-w-[210px] border-b border-[#EFEDE9]" />
                {shown.map((b) => (
                  <th key={b.brand_id} className="px-1 py-2 min-w-[92px] max-w-[92px] border-b border-l border-[#EFEDE9] align-bottom">
                    <p className="text-[8px] tracking-[0.08em] text-[#4A4E57] leading-tight break-words">{b.name.toUpperCase()}</p>
                    {!b.complete && <p className="text-[6.5px] tracking-[0.1em] text-[#B3202A] mt-0.5">CODES INCOMPLETE</p>}
                    {b.status === 'reference' && <p className="text-[6.5px] tracking-[0.1em] text-[#C4A882] mt-0.5">REFERENCE</p>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dims.map((d) => (
                <tr key={d.dimension_key} className="border-b border-[#EFEDE9] last:border-b-0">
                  <td className="sticky left-0 bg-white z-10 px-3 py-1.5 align-top">
                    <p className="text-[8.5px] tracking-[0.14em] text-[#4A4E57]">{d.label}</p>
                    <p className="text-[7px] tracking-[0.02em] text-[#A8A8A4] normal-case leading-tight">
                      1 {d.anchors['1']} → 5 {d.anchors['5']}
                    </p>
                  </td>
                  {shown.map((b) => (
                    <td key={b.brand_id} className="px-1 border-l border-[#EFEDE9]">
                      {cell?.brandId === b.brand_id && cell.dim === d.dimension_key ? (
                        <div className="w-[200px] p-2 bg-[#FAFAF8] border border-[#0A0A0A] rounded-[8px] relative z-20">
                          <Slider
                            dim={d}
                            value={b.codes[d.dimension_key] ?? null}
                            ghost={b.ghosts[d.dimension_key] ?? null}
                            onCommit={(v) => { save(b.brand_id, d.dimension_key, v); setCell(null) }}
                          />
                          <button className="text-[7px] tracking-[0.14em] text-[#A8A8A4]" onClick={() => setCell(null)}>CLOSE</button>
                        </div>
                      ) : (
                        <Track
                          value={b.codes[d.dimension_key] ?? null}
                          ghost={b.ghosts[d.dimension_key] ?? null}
                          onClick={() => setCell({ brandId: b.brand_id, dim: d.dimension_key })}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═════════ BULK ENTRY ═════════ */}
      {mode === 'bulk' && bulkBrand && (
        <div className="max-w-xl">
          <div className="flex items-center justify-between mb-3">
            <button className={CHIP_OFF} onClick={() => setBulkIdx((i) => Math.max(0, i - 1))}>← PREV</button>
            <div className="text-center">
              <p className="text-[13px] tracking-[0.1em] text-[#0A0A0A]">{bulkBrand.name.toUpperCase()}</p>
              <p className="text-[8px] tracking-[0.12em] text-[#A8A8A4]">
                {bulkIdx + 1}/{shown.length} · {bulkBrand.complete ? 'FULLY CODED' : 'CODES INCOMPLETE'} · {bulkBrand.itemCount} ITEMS
              </p>
            </div>
            <button className={CHIP_OFF} onClick={() => setBulkIdx((i) => Math.min(shown.length - 1, i + 1))}>NEXT →</button>
          </div>
          <div className="flex gap-2 mb-3">
            <button
              className={CHIP_OFF}
              onClick={() => {
                const next = shown.findIndex((b, i) => i > bulkIdx && !b.complete)
                setBulkIdx(next >= 0 ? next : shown.findIndex((b) => !b.complete))
              }}
            >
              JUMP TO NEXT INCOMPLETE
            </button>
          </div>
          <div className="border border-[#E2E0DB] rounded-[10px] bg-white p-4">
            {dims.map((d) => (
              <Slider
                key={`${bulkBrand.brand_id}:${d.dimension_key}`}
                dim={d}
                value={bulkBrand.codes[d.dimension_key] ?? null}
                ghost={bulkBrand.ghosts[d.dimension_key] ?? null}
                onCommit={(v) => save(bulkBrand.brand_id, d.dimension_key, v)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ═════════ COMPARE ═════════ */}
      {mode === 'compare' && (
        <div className="max-w-3xl">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {shown.slice(0, 60).map((b) => {
              const idx = compareIds.indexOf(b.brand_id)
              return (
                <button
                  key={b.brand_id}
                  onClick={() => setCompareIds((ids) => idx >= 0 ? ids.filter((x) => x !== b.brand_id) : ids.length < 4 ? [...ids, b.brand_id] : ids)}
                  className={idx >= 0 ? CHIP_ON : CHIP_OFF}
                  style={idx >= 0 ? { background: COMPARE_COLOURS[idx], borderColor: COMPARE_COLOURS[idx] } : undefined}
                >
                  {b.name.toUpperCase()}
                </button>
              )
            })}
          </div>
          {compared.length >= 2 ? (
            <>
              <div className="flex items-center gap-3 mb-2">
                <button onClick={() => setSortDisagreement(!sortDisagreement)} className={sortDisagreement ? CHIP_ON : CHIP_OFF}>SORT ROWS BY DISAGREEMENT</button>
                <span className="flex gap-3">
                  {compared.map((b, i) => (
                    <span key={b.brand_id} className="flex items-center gap-1 text-[8px] tracking-[0.1em] text-[#4A4E57]">
                      <span className="w-2 h-2 rounded-full" style={{ background: COMPARE_COLOURS[i] }} />{b.name.toUpperCase()}
                    </span>
                  ))}
                </span>
              </div>
              <div className="border border-[#E2E0DB] rounded-[10px] bg-white p-4">
                {compareRows.map(({ d, spread }) => (
                  <div key={d.dimension_key} className="py-1.5 border-b border-[#EFEDE9] last:border-b-0">
                    <div className="flex justify-between">
                      <p className="text-[8.5px] tracking-[0.14em] text-[#4A4E57]">{d.label}</p>
                      <p className="text-[7.5px] tracking-[0.08em] text-[#A8A8A4]">SPREAD {spread.toFixed(1)}</p>
                    </div>
                    <Track
                      value={null}
                      ghost={null}
                      compare={compared.map((b, i) => ({ v: b.codes[d.dimension_key] ?? null, colour: COMPARE_COLOURS[i] }))}
                    />
                    <div className="flex justify-between text-[7px] text-[#A8A8A4] normal-case">
                      <span>{d.anchors['1']}</span><span>{d.anchors['5']}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4]">PICK 2-4 BRANDS TO OVERLAY.</p>
          )}
        </div>
      )}
    </div>
  )
}
