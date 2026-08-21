'use client'

import { useMemo, useState, useTransition } from 'react'
import { PICKER_COLOURS, PICKER_TYPES } from '@/components/admin/ItemPickerModal'
import { findSimilarToSkipped } from '@/lib/brand-watch-similar'
import type { WatchedBrandRow } from '@/lib/brand-watch'
import {
  addWatchedBrand, checkAllBrandsNow, checkBrandNow, fullScanBrand, keepAllForBrand,
  keepItems, loadQueuePage, removeWatchedBrand, setWatchedBrandActive,
  setWatchedBrandMinScore, skipItems, undoSkip, type QueueItemRow, type QueuePage,
} from './actions'

const CHIP = 'px-3 py-1.5 rounded-full text-[9px] tracking-[0.12em] border transition-colors'
const CHIP_ON = `${CHIP} bg-[#0A0A0A] text-white border-[#0A0A0A]`
const CHIP_OFF = `${CHIP} bg-white text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]`

function fmtPrice(price: string | null, currency: string | null): string {
  if (!price) return ''
  const sym: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' }
  return `${sym[currency ?? ''] ?? ''}${String(price).replace(/\.00$/, '')}`
}

interface Props extends QueuePage {
  watched: WatchedBrandRow[]
}

export default function BrandWatchClient(props: Props) {
  const { watched } = props
  const [pending, startTransition] = useTransition()
  const [url, setUrl] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [busyBrand, setBusyBrand] = useState<string | null>(null)
  const [gone, setGone] = useState<Set<string>>(new Set()) // optimistically hidden cards
  // After a skip: the loaded queue's near-twins of what was just skipped, so
  // they can go in one tap instead of one by one.
  const [similarPrompt, setSimilarPrompt] = useState<{ name: string; ids: string[] } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set()) // multi-select for batch keep/skip
  const [lastSkip, setLastSkip] = useState<string[]>([]) // most recent skip batch, for UNDO

  // queue state — starts from the server render, replaced when a brand is
  // selected (the learning re-trains server-side on every load)
  const [page, setPage] = useState<QueuePage>(props)
  const [fBrand, setFBrand] = useState('')
  const [showPredicted, setShowPredicted] = useState(false)

  const [fType, setFType] = useState('')
  const [fColour, setFColour] = useState('')
  const [minScore, setMinScore] = useState<number | null>(null)

  const queue = page.queue
  const typesInQueue = useMemo(() => new Set(queue.map((q) => q.item_type)), [queue])
  const coloursInQueue = useMemo(() => new Set(queue.map((q) => q.colour_family)), [queue])

  const shown = useMemo(
    () => queue.filter((q) =>
      !gone.has(q.item_id) &&
      (showPredicted || !q.predicted_skip) &&
      (!fType || q.item_type === fType) &&
      (!fColour || q.colour_family === fColour) &&
      (minScore === null || (q.discovery_score ?? -99) >= minScore)),
    [queue, gone, showPredicted, fType, fColour, minScore],
  )

  const act = (fn: () => Promise<unknown>, done?: (r: any) => void) =>
    startTransition(async () => {
      try { const r = await fn(); done?.(r) }
      catch (e) { setNotice(e instanceof Error ? e.message : String(e)) }
      finally { setBusyBrand(null) }
    })

  const selectBrand = (name: string) => {
    const next = fBrand === name ? '' : name
    setFBrand(next)
    act(() => loadQueuePage(0, next || undefined), (r: QueuePage) => { setPage(r); setGone(new Set()) })
  }

  const reloadQueue = () =>
    act(() => loadQueuePage(0, fBrand || undefined), (r: QueuePage) => { setPage(r); setGone(new Set()) })

  const decide = (ids: string[], keep: boolean) => {
    // A single-card skip looks for its near-twins still on screen — same brand
    // and kind, same model line or same colour-and-material — and offers them
    // as one skip. Suggestion only; nothing is skipped without a tap.
    if (!keep && ids.length === 1) {
      const base = queue.find((q) => q.item_id === ids[0])
      const pool = queue.filter((q) => !gone.has(q.item_id) && !ids.includes(q.item_id))
      const sims = base ? findSimilarToSkipped(base, pool) : []
      setSimilarPrompt(sims.length ? { name: base!.product_name, ids: sims.map((x) => x.item_id) } : null)
    } else {
      setSimilarPrompt(null)
    }
    setGone((g) => new Set(Array.from(g).concat(ids)))
    setSelected((s) => new Set(Array.from(s).filter((id) => !ids.includes(id))))
    if (!keep) setLastSkip(ids)
    act(() => (keep ? keepItems(ids) : skipItems(ids)),
      (r) => setNotice(`${r.updated} ${keep ? 'KEPT → ADDED TO LIBRARY AS READY' : 'SKIPPED — NEVER ENTERS THE LIBRARY'} — LEARNING UPDATES ON NEXT LOAD`))
  }

  const undoLastSkip = () => {
    const ids = lastSkip
    setLastSkip([])
    setSimilarPrompt(null)
    act(() => undoSkip(ids), (r) => {
      // bring the cards straight back into view
      setGone((g) => new Set(Array.from(g).filter((id) => !ids.includes(id))))
      setNotice(`${r.restored} SKIP${r.restored === 1 ? '' : 'S'} UNDONE — BACK IN THE QUEUE`)
    })
  }

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const addNotice = (r: any, label: string) => {
    setUrl('')
    setNotice(r.error ?? `${r.result.name}: ${r.result.scanned} SCANNED, ${r.result.queued} QUEUED ${label}${r.result.note ? ` — ${r.result.note.toUpperCase()}` : ''}`)
    if (!r.error) reloadQueue()
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
      {/* ------------------------------------------------ watchlist */}
      <aside className="lg:sticky lg:top-6 self-start">
        <p className="text-[10px] tracking-[0.12em] text-[#6B6B6B] mb-3">WATCHED BRANDS · {watched.length}</p>

        <div className="mb-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) act(() => addWatchedBrand(url, 'watch'), (r) => addNotice(r, 'FROM THE LAST 60 DAYS')) }}
            placeholder="HTTPS://BRAND.COM"
            className="w-full border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[10px] tracking-[0.08em] outline-none focus:border-[#0A0A0A] uppercase placeholder:text-[#A8A8A4]"
          />
          <div className="mt-2 flex gap-2">
            <button
              disabled={pending || !url.trim()}
              onClick={() => act(() => addWatchedBrand(url, 'watch'), (r) => addNotice(r, 'FROM THE LAST 60 DAYS'))}
              className="flex-1 bg-[#0A0A0A] text-white rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
              title="Queue only the last 60 days of on-taste pieces, then watch weekly"
            >
              WATCH
            </button>
            <button
              disabled={pending || !url.trim()}
              onClick={() => act(() => addWatchedBrand(url, 'full'), (r) => addNotice(r, 'FROM THE FULL CATALOGUE'))}
              className="flex-1 border border-[#0A0A0A] text-[#0A0A0A] rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-40"
              title="Onboard: queue every on-taste piece in the whole catalogue, then watch weekly"
            >
              FULL SCAN
            </button>
          </div>
        </div>

        <div data-lenis-prevent className="border border-[#E2E0DB] rounded-[10px] overflow-hidden max-h-[60vh] overflow-y-auto">
          {watched.length === 0 && (
            <p className="px-3 py-4 text-[9px] tracking-[0.1em] text-[#A8A8A4]">NOTHING WATCHED YET — PASTE A SHOPIFY BRAND URL ABOVE.</p>
          )}
          {watched.map((w) => {
            const inQueue = page.brandCounts[w.name] ?? 0
            const selected = fBrand === w.name
            return (
              <div key={w.watched_brand_id} className={`px-3 py-2.5 border-b border-[#EFEDE9] last:border-b-0 ${selected ? 'bg-[#FAFAF8]' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <button onClick={() => selectBrand(w.name)} className="min-w-0 text-left group" title="Show this brand's queue">
                    <span className={`block text-[10px] tracking-[0.06em] truncate group-hover:underline ${selected ? 'text-[#0A0A0A] font-bold' : w.active ? 'text-[#4A4E57]' : 'text-[#A8A8A4] line-through'}`}>
                      {w.name.toUpperCase()}
                    </span>
                    <span className="block text-[8px] tracking-[0.08em] text-[#A8A8A4]">
                      {inQueue} IN QUEUE{w.last_checked_at ? ` · CHECKED ${w.last_checked_at.slice(0, 10)}` : ' · NEVER CHECKED'}
                      {w.platform === 'browser' && ' · BROWSER'}
                      {w.scan_state?.running && <span className="text-[#C4A882]"> · SCANNING {w.scan_state.done ?? 0}/{w.scan_state.total ?? '?'}</span>}
                      {!w.scan_state?.running && (w.scan_state?.remaining ?? 0) > 0 && <span className="text-[#C4A882]"> · {w.scan_state!.remaining} PAGES LEFT — FULL SCAN TO CONTINUE</span>}
                    </span>
                  </button>
                  <span className="flex gap-1.5 flex-shrink-0">
                    <button
                      disabled={pending}
                      onClick={() => { setBusyBrand(w.watched_brand_id); act(() => checkBrandNow(w.watched_brand_id), (r) => { setNotice(r.error ?? `${r.result.name}: ${r.result.newProducts} NEW, ${r.result.queued} QUEUED, ${r.result.skippedStock} HELD FOR STOCK, ${r.result.suppressedByLearning ?? 0} SUPPRESSED BY LEARNING, ${r.result.restocked} RESTOCKED`); if (!r.error) reloadQueue() }) }}
                      className="text-[8px] tracking-[0.1em] text-[#4A4E57] border border-[#E2E0DB] rounded-full px-2.5 py-1 hover:border-[#0A0A0A] transition-colors disabled:opacity-40"
                    >
                      {busyBrand === w.watched_brand_id ? <span className="text-[#C4A882]">WORKING…</span> : 'CHECK NOW'}
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => { setBusyBrand(w.watched_brand_id); act(() => fullScanBrand(w.watched_brand_id), (r) => { setNotice(r.error ?? `${r.result.name}: ${r.result.queued} QUEUED FROM THE FULL CATALOGUE (${r.result.belowScore} BELOW MIN SCORE)${r.result.note ? ` — ${r.result.note.toUpperCase()}` : ''}`); if (!r.error) reloadQueue() }) }}
                      className="text-[8px] tracking-[0.1em] text-[#4A4E57] border border-[#E2E0DB] rounded-full px-2.5 py-1 hover:border-[#0A0A0A] transition-colors disabled:opacity-40"
                      title="Queue every on-taste piece in the whole catalogue at this brand's min score — lower the min score and run again to go deeper"
                    >
                      FULL SCAN
                    </button>
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[8px] tracking-[0.1em] text-[#A8A8A4]">
                  <label className="flex items-center gap-1">
                    MIN SCORE
                    <input
                      type="number" min={-9} max={9} defaultValue={w.min_score}
                      onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v !== w.min_score) act(() => setWatchedBrandMinScore(w.watched_brand_id, v)) }}
                      className="w-10 border border-[#E2E0DB] rounded px-1 py-0.5 text-[9px] text-[#4A4E57] outline-none focus:border-[#0A0A0A]"
                    />
                  </label>
                  <button disabled={pending} onClick={() => act(() => setWatchedBrandActive(w.watched_brand_id, !w.active))} className="hover:text-[#4A4E57] transition-colors">
                    {w.active ? 'PAUSE' : 'RESUME'}
                  </button>
                  <button
                    disabled={pending}
                    onClick={() => { if (confirm(`Stop watching ${w.name}? Seen history is deleted too.`)) act(() => removeWatchedBrand(w.watched_brand_id)) }}
                    className="hover:text-[#B3202A] transition-colors"
                  >
                    REMOVE
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {watched.length > 0 && (
          <button
            disabled={pending}
            onClick={() => act(() => checkAllBrandsNow(), (r) => { setNotice(r.results.map((x: any) => `${x.name}: ${x.error ?? `${x.queued} queued`}`).join(' · ').toUpperCase()); reloadQueue() })}
            className="mt-3 w-full border border-[#0A0A0A] rounded-full px-4 py-2 text-[9px] tracking-[0.14em] text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-40"
          >
            {pending ? 'WORKING…' : 'RUN CHECK NOW'}
          </button>
        )}
        <p className="mt-2 text-[8px] tracking-[0.1em] text-[#A8A8A4] leading-relaxed">
          RUNS AUTOMATICALLY EVERY MONDAY 07:00 UTC.
          {page.decidedCount >= 15 && <> LEARNING FROM {page.decidedCount} KEEP/SKIP DECISIONS.</>}
        </p>
      </aside>

      {/* ------------------------------------------------ queue */}
      <section>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button onClick={() => selectBrand(fBrand)} disabled={!fBrand} className={fBrand === '' ? CHIP_ON : CHIP_OFF}>ALL BRANDS</button>
          {Object.keys(page.brandCounts).sort().map((b) => (
            <button key={b} onClick={() => selectBrand(b)} className={fBrand === b ? CHIP_ON : CHIP_OFF}>
              {b.toUpperCase()} · {page.brandCounts[b]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button onClick={() => setFType('')} className={fType === '' ? CHIP_ON : CHIP_OFF}>ALL TYPES</button>
          {PICKER_TYPES.filter((t) => typesInQueue.has(t.value)).map((t) => (
            <button key={t.value} onClick={() => setFType(fType === t.value ? '' : t.value)} className={fType === t.value ? CHIP_ON : CHIP_OFF}>{t.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button onClick={() => setFColour('')} className={fColour === '' ? CHIP_ON : CHIP_OFF}>ALL COLOURS</button>
          {PICKER_COLOURS.filter((c) => coloursInQueue.has(c.value)).map((c) => (
            <button key={c.value} onClick={() => setFColour(fColour === c.value ? '' : c.value)} className={`${fColour === c.value ? CHIP_ON : CHIP_OFF} flex items-center gap-1.5`}>
              <span className="w-2.5 h-2.5 rounded-full border border-[#E2E0DB]" style={{ background: c.swatch }} />
              {c.label}
            </button>
          ))}
          <span className="mx-2 h-4 w-px bg-[#E2E0DB]" />
          {[null, 5, 7].map((s) => (
            <button key={String(s)} onClick={() => setMinScore(s)} className={minScore === s ? CHIP_ON : CHIP_OFF}>
              {s === null ? 'ALL SCORES' : `+${s} AND UP`}
            </button>
          ))}
          {page.predictedSkipTotal > 0 && (
            <>
              <span className="mx-2 h-4 w-px bg-[#E2E0DB]" />
              <button onClick={() => setShowPredicted(!showPredicted)} className={showPredicted ? CHIP_ON : CHIP_OFF} title="Pieces the keep/skip learning expects you to skip — hidden by default, never deleted">
                PREDICTED SKIPS · {page.predictedSkipTotal}
              </button>
            </>
          )}
        </div>

        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <p className="text-[10px] tracking-[0.12em] text-[#6B6B6B]">
            {shown.length} SHOWN{page.queueTotal > queue.length ? ` · ${page.queueTotal - gone.size} IN ${fBrand ? fBrand.toUpperCase() + "'S" : 'THE'} QUEUE` : ''}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Scan notices explain WHY nothing queued, so they must be readable
                in full — truncating them hid the whole point of the message. */}
            {notice && <p className="text-[9px] tracking-[0.1em] text-[#C4A882] max-w-xl leading-relaxed">{notice}</p>}
            {/* One tap clears the near-twins of what was just skipped — the whole
                point is not skipping six monogram bags one by one. */}
            {similarPrompt && (
              <button
                disabled={pending}
                onClick={() => { const ids = similarPrompt.ids; setSimilarPrompt(null); decide(ids, false) }}
                className="bg-[#C4A882] text-white rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
                title={`Skip everything on screen that closely matches ${similarPrompt.name}`}
              >
                SKIP {similarPrompt.ids.length} SIMILAR TO “{similarPrompt.name.slice(0, 22).toUpperCase()}”
              </button>
            )}
            {similarPrompt && (
              <button
                onClick={() => setSimilarPrompt(null)}
                className="border border-[#E2E0DB] text-[#6B6B6B] rounded-full px-3 py-2 text-[9px] tracking-[0.12em] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors"
              >
                NO, THEY&rsquo;RE FINE
              </button>
            )}
            {lastSkip.length > 0 && (
              <button
                disabled={pending}
                onClick={undoLastSkip}
                className="border border-[#C4A882] text-[#C4A882] rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:bg-[#C4A882] hover:text-white transition-colors disabled:opacity-40"
              >
                UNDO SKIP · {lastSkip.length}
              </button>
            )}
            {selected.size > 0 && (
              <>
                <button
                  disabled={pending}
                  onClick={() => decide(Array.from(selected), true)}
                  className="bg-[#0A0A0A] text-white rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
                >
                  KEEP SELECTED · {selected.size}
                </button>
                <button
                  disabled={pending}
                  onClick={() => decide(Array.from(selected), false)}
                  className="border border-[#0A0A0A] text-[#0A0A0A] rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-40"
                >
                  SKIP SELECTED · {selected.size}
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="border border-[#E2E0DB] text-[#6B6B6B] rounded-full px-3 py-2 text-[9px] tracking-[0.12em] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors"
                >
                  CLEAR
                </button>
                <span className="h-4 w-px bg-[#E2E0DB]" />
              </>
            )}
            <button
              disabled={pending || shown.length === 0}
              onClick={() => decide(shown.map((q) => q.item_id), true)}
              className="bg-[#0A0A0A] text-white rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
            >
              KEEP ALL SHOWN
            </button>
            {fBrand && (page.brandCounts[fBrand] ?? 0) > 0 && (
              <button
                disabled={pending}
                onClick={() => {
                  const n = page.brandCounts[fBrand] ?? 0
                  if (confirm(`Keep ALL ${n} ${fBrand} pieces in the queue — including ones not loaded on this page?`))
                    act(() => keepAllForBrand(fBrand), (r) => { setNotice(r.error?.toUpperCase() ?? `${r.updated} ${fBrand.toUpperCase()} PIECES KEPT → READY`); reloadQueue() })
                }}
                className="bg-[#C4A882] text-white rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
                title="Keep every queued draft for this brand — the whole queue, not just the loaded page"
              >
                KEEP ALL {fBrand.toUpperCase()} · {page.brandCounts[fBrand] ?? 0}
              </button>
            )}
            <button
              disabled={pending || shown.length === 0}
              onClick={() => { if (confirm(`Skip all ${shown.length} shown? They archive and never resurface.`)) decide(shown.map((q) => q.item_id), false) }}
              className="border border-[#E2E0DB] text-[#6B6B6B] rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors disabled:opacity-40"
            >
              SKIP ALL SHOWN
            </button>
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="border border-[#E2E0DB] rounded-[10px] p-10 text-center">
            <p className="text-[10px] tracking-[0.12em] text-[#A8A8A4]">
              {queue.length === 0 ? 'QUEUE IS EMPTY — NEW DROPS LAND HERE AFTER THE MONDAY CHECK.' : 'NOTHING MATCHES THESE FILTERS.'}
            </p>
          </div>
        ) : (
          <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {shown.map((q) => (
              <div key={q.item_id} className={`border rounded-[10px] overflow-hidden bg-white flex flex-col transition-shadow ${selected.has(q.item_id) ? 'border-[#0A0A0A] shadow-[0_0_0_1px_#0A0A0A]' : 'border-[#EFEDE9]'}`}>
                <a href={q.retailer_url} target="_blank" rel="noopener noreferrer" className="block aspect-[3/4] bg-[#F2F2F0] overflow-hidden relative">
                  {q.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={q.image_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                  )}
                  {q.discovery_score != null && (
                    <span className="absolute top-2 left-2 bg-white/95 border border-[#E2E0DB] rounded px-1.5 py-0.5 text-[9px] tracking-[0.08em] text-[#4A4E57]">
                      {q.discovery_score > 0 ? '+' : ''}{q.discovery_score}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelect(q.item_id) }}
                    title={selected.has(q.item_id) ? 'Deselect' : 'Select for batch keep/skip'}
                    className={`absolute bottom-2 right-2 w-6 h-6 rounded-full border flex items-center justify-center text-[11px] leading-none transition-colors ${selected.has(q.item_id) ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'bg-white/95 text-transparent border-[#A8A8A4] hover:border-[#0A0A0A]'}`}
                  >
                    ✓
                  </button>
                  {q.learned_delta !== 0 && (
                    <span
                      className={`absolute top-2 right-2 rounded px-1.5 py-0.5 text-[9px] tracking-[0.08em] border ${q.learned_delta > 0 ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'bg-white/95 text-[#B3202A] border-[#E2E0DB]'}`}
                      title={`Learned from your keep/skip decisions: ${q.learned_reasons}`}
                    >
                      {q.learned_delta > 0 ? '+' : ''}{q.learned_delta}
                    </span>
                  )}
                </a>
                <div className="p-3 flex flex-col gap-1 flex-1">
                  <p className="text-[8px] tracking-[0.14em] text-[#A8A8A4]">{(q.brand_name ?? '').toUpperCase()}</p>
                  <p className="text-[10px] tracking-[0.04em] text-[#4A4E57] leading-snug">{q.product_name.toUpperCase()}</p>
                  <p className="text-[8px] tracking-[0.1em] text-[#A8A8A4]">
                    {[q.item_type, q.colour_family, q.material_category].filter(Boolean).join(' · ').toUpperCase()}
                  </p>
                  <p className="text-[10px] tracking-[0.06em] text-[#4A4E57]">{fmtPrice(q.price, q.currency)}</p>
                  <div className="mt-auto pt-2 flex gap-2">
                    <button
                      disabled={pending}
                      onClick={() => decide([q.item_id], true)}
                      className="flex-1 bg-[#0A0A0A] text-white rounded-full py-1.5 text-[8px] tracking-[0.14em] hover:opacity-85 transition-opacity disabled:opacity-40"
                    >
                      KEEP
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => decide([q.item_id], false)}
                      className="flex-1 border border-[#E2E0DB] text-[#6B6B6B] rounded-full py-1.5 text-[8px] tracking-[0.14em] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors disabled:opacity-40"
                    >
                      SKIP
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {queue.length < page.queueTotal && (
            <div className="mt-6 text-center">
              <button
                disabled={pending}
                onClick={() => act(() => loadQueuePage(queue.length, fBrand || undefined), (r: QueuePage) => setPage((p) => ({ ...r, queue: p.queue.concat(r.queue.filter((n) => !p.queue.some((e) => e.item_id === n.item_id))) })))}
                className="border border-[#0A0A0A] rounded-full px-6 py-2 text-[9px] tracking-[0.14em] text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-40"
              >
                LOAD MORE ({page.queueTotal - queue.length} REMAINING)
              </button>
            </div>
          )}
          </>
        )}
      </section>
    </div>
  )
}
