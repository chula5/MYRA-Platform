'use client'

import { useState } from 'react'
import { thumbUrl } from '@/lib/image-utils'
import { scanBrandCollection, markCollectionCandidateSelected, type ScannableBrand, type CollectionScan, type CollectionCandidate } from './actions'
import { ingestAndComposeUrl } from '@/app/admin/ingest-compose/actions'
import OutfitComposePanel, { type ComposeAnchor, type ComposeCandidate } from '@/components/admin/OutfitComposePanel'

interface AcceptedBlock {
  key: number
  sourceUrl: string
  item?: ComposeAnchor
  candidates?: ComposeCandidate[]
  error?: string
}

export default function CollectionsClient({ brands }: { brands: ScannableBrand[] }) {
  const [scanning, setScanning] = useState<Set<string>>(new Set())
  const [scans, setScans] = useState<Record<string, CollectionScan>>({})
  const [scanAll, setScanAll] = useState<{ done: number; total: number } | null>(null)
  const [accepting, setAccepting] = useState<Set<string>>(new Set())
  const [accepted, setAccepted] = useState<AcceptedBlock[]>([])
  const [acceptedUrls, setAcceptedUrls] = useState<Set<string>>(new Set())
  const [keyCounter, setKeyCounter] = useState(1)

  async function scanBrand(name: string) {
    if (scanning.has(name)) return
    setScanning((s) => new Set(s).add(name))
    try {
      const res = await scanBrandCollection(name)
      setScans((prev) => ({ ...prev, [name]: res }))
    } finally {
      setScanning((s) => { const n = new Set(s); n.delete(name); return n })
    }
  }

  async function runScanAll() {
    if (scanAll) return
    setScanAll({ done: 0, total: brands.length })
    for (let i = 0; i < brands.length; i++) {
      await scanBrand(brands[i].name)
      setScanAll({ done: i + 1, total: brands.length })
    }
    setScanAll(null)
  }

  async function accept(cand: CollectionCandidate) {
    const url = (cand.retailer_url ?? '').trim()
    if (!url || accepting.has(url) || acceptedUrls.has(url)) return
    setAccepting((s) => new Set(s).add(url))
    const key = keyCounter
    setKeyCounter((k) => k + 1)
    try {
      const res = await ingestAndComposeUrl(url)
      // Learning mandate: mark this candidate as SELECTED (vs passed over).
      if (!res.error) void markCollectionCandidateSelected(url, (res.item as any)?.item_id ?? null)
      setAccepted((prev) => [
        ...prev,
        {
          key,
          sourceUrl: url,
          item: res.item as ComposeAnchor | undefined,
          candidates: res.candidates as ComposeCandidate[] | undefined,
          error: res.error,
        },
      ])
      setAcceptedUrls((s) => new Set(s).add(url))
    } finally {
      setAccepting((s) => { const n = new Set(s); n.delete(url); return n })
    }
  }

  const scannedBrands = brands.filter((b) => scans[b.name])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-8">
      {/* Brand rail */}
      <aside className="lg:sticky lg:top-6 self-start">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] tracking-[0.12em] text-[#6B6B6B]">YOUR BRANDS · {brands.length}</p>
          <button
            onClick={runScanAll}
            disabled={!!scanAll || brands.length === 0}
            className="bg-[#0A0A0A] text-white rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
          >
            {scanAll ? `SCANNING ${scanAll.done}/${scanAll.total}` : 'SCAN ALL'}
          </button>
        </div>
        <div data-lenis-prevent className="border border-[#E2E0DB] rounded-[10px] overflow-hidden max-h-[70vh] overflow-y-auto">
          {brands.map((b) => {
            const sc = scans[b.name]
            const isScanning = scanning.has(b.name)
            return (
              <button
                key={b.brand_id}
                onClick={() => scanBrand(b.name)}
                disabled={isScanning}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 border-b border-[#EFEDE9] last:border-b-0 text-left hover:bg-[#FAFAF8] transition-colors disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block text-[10px] tracking-[0.06em] text-[#4A4E57] truncate">{b.name.toUpperCase()}</span>
                  <span className="block text-[8px] tracking-[0.08em] text-[#A8A8A4]">{b.itemCount} ITEM{b.itemCount !== 1 ? 'S' : ''}</span>
                </span>
                <span className="text-[8px] tracking-[0.10em] flex-shrink-0">
                  {isScanning
                    ? <span className="text-[#C4A882]">SCANNING…</span>
                    : sc
                      ? (sc.candidates.length > 0
                          ? <span className="text-[#3D7A50]">{sc.candidates.length} NEW</span>
                          : <span className="text-[#A8A8A4]">NONE</span>)
                      : <span className="text-[#A8A8A4]">SCAN →</span>}
                </span>
              </button>
            )
          })}
          {brands.length === 0 && <p className="px-3 py-4 text-[9px] tracking-[0.1em] text-[#A8A8A4]">NO BRANDS WITH ITEMS YET.</p>}
        </div>
      </aside>

      {/* Results */}
      <div className="min-w-0">
        {scannedBrands.length === 0 && (
          <div className="border border-dashed border-[#E2E0DB] rounded-[12px] py-16 text-center">
            <p className="text-[11px] tracking-[0.1em] text-[#6B6B6B]">CLICK A BRAND TO CHECK FOR A NEW COLLECTION</p>
            <p className="mt-2 text-[9px] tracking-[0.06em] text-[#A8A8A4] max-w-md mx-auto leading-relaxed">
              An agent searches the web for the brand&rsquo;s newest drop. Accept the pieces you like — each is added
              to your library and instantly composed into outfit options you can refine and send live.
            </p>
          </div>
        )}

        {scannedBrands.map((b) => {
          const sc = scans[b.name]
          return (
            <section key={b.brand_id} className="mb-10">
              <div className="flex items-baseline justify-between mb-3 pb-2 border-b border-[#E2E0DB]">
                <div>
                  <p className="text-[13px] tracking-[0.06em] text-[#4A4E57]">{b.name.toUpperCase()}</p>
                  {sc.collection_name && <p className="text-[9px] tracking-[0.1em] text-[#C4A882] mt-0.5">{sc.collection_name.toUpperCase()}</p>}
                </div>
                <button onClick={() => scanBrand(b.name)} disabled={scanning.has(b.name)} className="text-[9px] tracking-[0.1em] text-[#6B6B6B] hover:text-[#0A0A0A] disabled:opacity-50">RE-SCAN ↻</button>
              </div>
              {sc.error && <p className="text-[10px] tracking-[0.1em] text-[#B83A3A] py-3">{sc.error.toUpperCase()}</p>}
              {sc.note && <p className="text-[10px] tracking-[0.04em] text-[#6B6B6B] mb-4 leading-relaxed">{sc.note}</p>}

              {sc.candidates.length === 0 && !sc.error && (
                <p className="text-[10px] tracking-[0.12em] text-[#A8A8A4] py-3">NO NEW COLLECTION PIECES FOUND.</p>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {sc.candidates.map((c, i) => {
                  const url = (c.retailer_url ?? '').trim()
                  const isAccepting = accepting.has(url)
                  const isAccepted = acceptedUrls.has(url)
                  return (
                    <div key={`${b.brand_id}-${i}`} className="border border-[#E2E0DB] rounded-[10px] overflow-hidden bg-white flex flex-col">
                      <div className="aspect-[3/4] bg-[#F2F2F0] overflow-hidden">
                        {c.image_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={thumbUrl(c.image_url, 600)} alt="" loading="lazy" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center"><span className="text-[8px] tracking-[0.1em] text-[#A8A8A4]">NO IMAGE</span></div>}
                      </div>
                      <div className="p-3 flex flex-col flex-1">
                        <p className="text-[11px] tracking-[0.03em] text-[#4A4E57] leading-snug line-clamp-2">{c.title}</p>
                        {c.price && <p className="text-[9px] tracking-[0.06em] text-[#6B6B6B] mt-1">{c.currency ?? ''} {c.price}</p>}
                        {c.why_interesting && <p className="text-[8px] tracking-[0.02em] text-[#A8A8A4] mt-1.5 leading-relaxed line-clamp-3">{c.why_interesting}</p>}
                        <div className="mt-auto pt-3 flex items-center gap-2">
                          <button
                            onClick={() => accept(c)}
                            disabled={!url || isAccepting || isAccepted}
                            className={`flex-1 py-2 text-[9px] tracking-[0.12em] rounded-full transition-opacity disabled:cursor-not-allowed ${
                              isAccepted ? 'bg-[#EAF3EC] text-[#3D7A50] border border-[#BBD9C2]' : 'bg-[#0A0A0A] text-white hover:opacity-85 disabled:opacity-40'
                            }`}
                          >
                            {isAccepted ? 'ACCEPTED ✓' : isAccepting ? 'ADDING…' : 'ACCEPT'}
                          </button>
                          {url && (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="text-[8px] tracking-[0.1em] text-[#A8A8A4] hover:text-[#4A4E57]">VIEW ↗</a>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}

        {/* Accepted → composed */}
        {accepted.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] tracking-[0.12em] text-[#6B6B6B] mb-4 pb-2 border-b border-[#E2E0DB]">ACCEPTED · OUTFIT OPTIONS</p>
            <div className="space-y-8">
              {accepted.map((block) => (
                <div key={block.key} className="border border-[#E2E0DB] bg-white rounded-[14px] overflow-hidden">
                  <div className="flex items-center gap-4 p-4 border-b border-[#E2E0DB] bg-[#FAFAF8]">
                    {block.item?.image_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={thumbUrl(block.item.image_url, 600)} alt="" className="w-16 h-20 flex-shrink-0 rounded-[8px] object-cover bg-[#F2F2F0]" />
                      : <div className="w-16 h-20 flex-shrink-0 rounded-[8px] bg-[#F2F2F0]" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] tracking-[0.18em] text-[#A8A8A4] mb-0.5">NEW ITEM{block.item?.item_type ? ` · ${block.item.item_type.replace(/_/g, ' ').toUpperCase()}` : ''}</p>
                      <p className="text-[10px] tracking-[0.10em] text-[#6B6B6B]">{(block.item?.brand_name ?? '').toUpperCase()}</p>
                      <p className="text-[13px] tracking-[0.04em] text-[#4A4E57] truncate">{(block.item?.product_name ?? block.sourceUrl).toUpperCase()}</p>
                      {block.item?.price && <p className="text-[10px] tracking-[0.06em] text-[#6B6B6B] mt-0.5">{block.item.price}</p>}
                    </div>
                  </div>
                  <div className="p-4">
                    {block.error && <p className="text-[10px] tracking-[0.12em] text-[#B83A3A] py-4 text-center">{block.error.toUpperCase()}</p>}
                    {block.item && block.candidates && block.candidates.length > 0 && (
                      <OutfitComposePanel anchor={block.item} initialCandidates={block.candidates} />
                    )}
                    {block.item && (!block.candidates || block.candidates.length === 0) && !block.error && (
                      <p className="text-[10px] tracking-[0.14em] text-[#A8A8A4] py-4 text-center">ITEM SAVED — NO BRAND-COHERENT COMBINATIONS FOUND YET.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
