'use client'

import { useState, useTransition } from 'react'
import { thumbUrl } from '@/lib/image-utils'
import {
  batchAnalyseUrls,
  bulkApproveCandidates,
  getIngestPreview,
  type ParsedCandidate,
} from './actions'

type Mode = 'list' | 'collection'
type Stock = 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown'

interface QueueItem extends ParsedCandidate {
  id: string
  selected: boolean
  image_url: string | null
  imageLoading: boolean
  stock?: Stock
  stockSizes?: string[]
  stockLoading?: boolean
}

export default function IngestClient() {
  const [mode, setMode] = useState<Mode>('list')
  const [input, setInput] = useState('')
  const [analysing, startAnalyse] = useTransition()
  const [approving, startApprove] = useTransition()
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null)
  const [tasteFilterApplied, setTasteFilterApplied] = useState(false)

  async function runAnalyse() {
    setError(null)
    setResult(null)
    setTasteFilterApplied(false)
    startAnalyse(async () => {
      const res = await batchAnalyseUrls(input, mode)
      if (res.error) {
        setError(res.error)
        setQueue([])
        return
      }
      setTasteFilterApplied(!!res.usedTasteFilter)
      const initialQueue: QueueItem[] = (res.candidates ?? []).map((c, i) => ({
        ...c,
        id: `${i}-${c.source_url}`,
        selected: c.ok, // auto-select successful parses
        image_url: null,
        imageLoading: c.ok,
        stockLoading: c.ok,
      }))
      setQueue(initialQueue)

      // Fetch image + stock together (one call each, best-effort, non-blocking).
      // Out-of-stock pieces are auto-deselected so they aren't added.
      initialQueue.forEach(async (item) => {
        if (!item.ok) return
        const p = await getIngestPreview(item.source_url)
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  image_url: p.image_url,
                  imageLoading: false,
                  stock: p.stock,
                  stockSizes: p.sizes,
                  stockLoading: false,
                  selected: p.stock === 'out_of_stock' ? false : q.selected,
                }
              : q,
          ),
        )
      })
    })
  }

  function toggleSelect(id: string) {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, selected: !q.selected } : q)))
  }

  function selectAll(value: boolean) {
    // Never bulk-select out-of-stock pieces.
    setQueue((prev) => prev.map((q) => ({ ...q, selected: value && q.ok && q.stock !== 'out_of_stock' })))
  }

  function discard(id: string) {
    setQueue((prev) => prev.filter((q) => q.id !== id))
  }

  function approve() {
    const payload = queue
      .filter((q) => q.selected && q.ok && q.parsed)
      .map((q) => ({
        source_url: q.source_url,
        parsed: q.parsed!,
        image_url: q.image_url,
      }))
    if (payload.length === 0) {
      setError('Select at least one candidate to approve.')
      return
    }
    setError(null)
    startApprove(async () => {
      const res = await bulkApproveCandidates(payload)
      if (res.error) {
        setError(res.error)
        return
      }
      setResult({ created: res.created ?? 0, failed: res.failed ?? 0 })
      // Remove approved items from the queue
      setQueue((prev) => prev.filter((q) => !payload.some((p) => p.source_url === q.source_url)))
    })
  }

  const selectedCount = queue.filter((q) => q.selected).length
  const okCount = queue.filter((q) => q.ok).length
  const failCount = queue.filter((q) => !q.ok).length

  return (
    <div>
      {/* Mode + input */}
      <div className="bg-white border border-[#E2E0DB] p-6 mb-8">
        <div className="flex items-center gap-2 mb-5">
          <button
            type="button"
            onClick={() => setMode('list')}
            className={`px-4 py-2 text-[10px] tracking-[0.09em] transition-all duration-300 ${
              mode === 'list'
                ? 'bg-[#0A0A0A] text-white'
                : 'border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57]'
            }`}
          >
            URL LIST
          </button>
          <button
            type="button"
            onClick={() => setMode('collection')}
            className={`px-4 py-2 text-[10px] tracking-[0.09em] transition-all duration-300 ${
              mode === 'collection'
                ? 'bg-[#0A0A0A] text-white'
                : 'border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57]'
            }`}
          >
            COLLECTION PAGE
          </button>
          <span className="ml-2 text-[9px] tracking-[0.09em] text-[#A8A8A4]">
            {mode === 'list'
              ? 'PASTE 1–30 PRODUCT URLS, ONE PER LINE'
              : 'PASTE ONE COLLECTION URL — CLAUDE CURATES 12–20 PRODUCTS, FILTERED BY YOUR TASTE PROFILE'}
          </span>
        </div>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={mode === 'list' ? 6 : 2}
          placeholder={
            mode === 'list'
              ? 'https://www.net-a-porter.com/.../1683828\nhttps://www.mytheresa.com/.../P00789012\n...'
              : 'https://www.net-a-porter.com/en-gb/shop/designer/toteme/new-in'
          }
          className="w-full border border-[#E2E0DB] bg-white px-4 py-3 text-[12px] tracking-[0.023em] text-[#4A4E57] focus:outline-none focus:border-[#0A0A0A] transition-colors duration-300 font-mono leading-relaxed"
        />

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={runAnalyse}
            disabled={analysing || !input.trim()}
            className="bg-[#0A0A0A] text-white px-6 py-2.5 text-[10px] tracking-[0.09em] hover:bg-[#333] transition-colors duration-300 disabled:opacity-50"
          >
            {analysing ? 'ANALYSING…' : 'ANALYSE'}
          </button>
          {queue.length > 0 && (
            <span className="text-[10px] tracking-[0.09em] text-[#6B6B6B]">
              QUEUE: {queue.length} · OK {okCount}
              {failCount > 0 && ` · FAILED ${failCount}`}
              {tasteFilterApplied && ' · TASTE-FILTERED'}
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 border border-[#E8B4B4] bg-[#FDECEC]">
          <p className="text-[10px] tracking-[0.09em] text-[#B83A3A]">{error.toUpperCase()}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="mb-6 p-4 border border-[#C4A882] bg-[#FAF6EE]">
          <p className="text-[10px] tracking-[0.09em] text-[#4A4E57]">
            {result.created} ITEM{result.created === 1 ? '' : 'S'} CREATED AS DRAFTS
            {result.failed > 0 && ` · ${result.failed} FAILED`}
            {' · '}
            <a href="/admin/items?status=draft" className="underline">
              REVIEW DRAFTS →
            </a>
          </p>
        </div>
      )}

      {/* Queue */}
      {queue.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#E2E0DB]">
            <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B]">REVIEW QUEUE</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => selectAll(true)}
                className="text-[10px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors"
              >
                SELECT ALL OK
              </button>
              <span className="text-[10px] text-[#E2E0DB]">·</span>
              <button
                type="button"
                onClick={() => selectAll(false)}
                className="text-[10px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors"
              >
                CLEAR
              </button>
              <button
                type="button"
                disabled={approving || selectedCount === 0}
                onClick={approve}
                className="ml-4 bg-[#0A0A0A] text-white px-6 py-2.5 text-[10px] tracking-[0.09em] hover:bg-[#333] transition-colors duration-300 disabled:opacity-50"
              >
                {approving
                  ? 'CREATING…'
                  : `APPROVE ${selectedCount} → DRAFTS`}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {queue.map((q) => (
              <div
                key={q.id}
                className={`bg-white border rounded-[10px] overflow-hidden flex flex-col transition-colors ${
                  q.ok
                    ? q.selected
                      ? 'border-[#0A0A0A] ring-1 ring-[#0A0A0A]'
                      : 'border-[#E2E0DB]'
                    : 'border-[#E8B4B4] bg-[#FDECEC]'
                }`}
              >
                {/* Image with select + discard overlays */}
                <div className="relative aspect-[3/4] bg-[#F2F2F0] overflow-hidden">
                  {q.imageLoading ? (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-[10px] tracking-[0.068em] text-[#A8A8A4]">…</span>
                    </div>
                  ) : q.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbUrl(q.image_url, 600)} alt={q.parsed?.product_name ?? ''} loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-[10px] tracking-[0.068em] text-[#A8A8A4]">NO IMG</span>
                    </div>
                  )}

                  {/* Full-cover select overlay (ok items only; out-of-stock can't be selected) */}
                  {q.ok && (
                    <button
                      type="button"
                      onClick={() => q.stock !== 'out_of_stock' && toggleSelect(q.id)}
                      disabled={q.stock === 'out_of_stock'}
                      aria-label={q.selected ? 'Deselect' : 'Select'}
                      className="absolute inset-0 z-0 disabled:cursor-not-allowed"
                    >
                      <span
                        className={`absolute top-2 left-2 w-6 h-6 rounded-full border flex items-center justify-center text-[12px] ${
                          q.stock === 'out_of_stock'
                            ? 'bg-[#F2F2F0] border-[#D8D6D1] text-transparent'
                            : q.selected
                              ? 'bg-[#0A0A0A] border-[#0A0A0A] text-white'
                              : 'bg-white/90 border-[#0A0A0A] text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                    </button>
                  )}

                  {/* Stock badge */}
                  {q.ok && q.stockLoading && (
                    <span className="absolute bottom-2 left-2 z-10 text-[8px] tracking-[0.1em] px-2 py-0.5 rounded-full bg-white/85 text-[#A8A8A4]">STOCK…</span>
                  )}
                  {q.ok && !q.stockLoading && q.stock && q.stock !== 'unknown' && (
                    <span
                      className={`absolute bottom-2 left-2 z-10 text-[8px] tracking-[0.1em] px-2 py-0.5 rounded-full ${
                        q.stock === 'out_of_stock' ? 'bg-[#B83A3A] text-white'
                          : q.stock === 'low_stock' ? 'bg-[#F3E9CF] text-[#8B5E00]'
                          : 'bg-[#EAF3EC] text-[#3D7A50]'
                      }`}
                    >
                      {q.stock === 'out_of_stock'
                        ? 'OUT OF STOCK'
                        : q.stock === 'low_stock'
                          ? (q.stockSizes?.length ? `LOW · ${q.stockSizes.join('·')}` : 'LOW STOCK')
                          : (q.stockSizes?.length ? q.stockSizes.join('·') : 'IN STOCK')}
                    </span>
                  )}

                  {/* Discard */}
                  <button
                    type="button"
                    onClick={() => discard(q.id)}
                    aria-label="Discard"
                    className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-white/85 text-[#6B6B6B] hover:bg-[#B83A3A] hover:text-white text-[13px] leading-none flex items-center justify-center transition-colors"
                  >
                    ×
                  </button>
                </div>

                {/* Info */}
                <div className="p-3 flex-1 flex flex-col">
                  {q.ok && q.parsed ? (
                    <>
                      <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-0.5 truncate">
                        {(q.parsed.brand_name ?? 'UNKNOWN BRAND').toUpperCase()}
                      </p>
                      <p className="text-[11px] tracking-[0.023em] text-[#4A4E57] mb-1.5 leading-snug line-clamp-2">
                        {(q.parsed.product_name ?? 'UNTITLED').toUpperCase()}
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap text-[9px] tracking-[0.05em] text-[#6B6B6B]">
                        {q.parsed.item_type && <span>{q.parsed.item_type.replace(/_/g, ' ').toUpperCase()}</span>}
                        {q.parsed.colour_family && <span>· {q.parsed.colour_family.toUpperCase()}</span>}
                        {q.parsed.price && (
                          <span>· {q.parsed.currency ?? ''} {q.parsed.price}</span>
                        )}
                      </div>
                      <ScoreStrip parsed={q.parsed} />
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] tracking-[0.09em] text-[#B83A3A] mb-1">FAILED TO ANALYSE</p>
                      <p className="text-[9px] tracking-[0.045em] text-[#6B6B6B] break-words">{q.error}</p>
                    </>
                  )}
                  <p className="text-[8px] tracking-[0.03em] text-[#A8A8A4] mt-2 truncate font-mono">
                    {q.source_url}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ScoreStrip({ parsed }: { parsed: NonNullable<ParsedCandidate['parsed']> }) {
  const scored: Array<[string, number | null]> = [
    ['FIT', parsed.fit],
    ['STR', parsed.structure],
    ['MAT.WT', parsed.material_weight],
    ['MAT.FORM', parsed.material_formality],
    ['SURFACE', parsed.surface],
    ['SHEEN', parsed.sheen],
    ['PATTERN', parsed.pattern],
  ]
  const present = scored.filter(([, v]) => v != null)
  if (present.length === 0) return null
  return (
    <div className="flex items-center gap-3 mt-2 flex-wrap">
      {present.map(([label, val]) => (
        <span key={label} className="text-[9px] tracking-[0.081em] text-[#A8A8A4]">
          {label} <span className="text-[#4A4E57]">{val}</span>
        </span>
      ))}
    </div>
  )
}
