'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { PICKER_COLOURS, PICKER_TYPES } from '@/components/admin/ItemPickerModal'
import { findSimilarToSkipped } from '@/lib/brand-watch-similar'
import type { WatchedBrandRow } from '@/lib/brand-watch'
import type { BrandTrust } from '@/lib/brand-watch-trust'
import type { TwinTrust } from '@/lib/brand-watch-twins'
import {
  addWatchedBrand, checkAllBrandsNow, checkBrandNow, fullScanBrand, keepAllForBrand,
  keepItems, loadQueuePage, removeWatchedBrand, setWatchedBrandActive, setWatchedBrandAutoKeep,
  setWatchedBrandAutoKeepConfidence, setWatchedBrandConfidenceBar, loadAutoAdded, undoAutoKeep,
  loadSiteRequests, decideSiteRequest, keepConfidentNowForBrand,
  setWatchedBrandAutoKeepTwins, keepTwinsNowForBrand,
  setWatchedBrandMinScore, skipItems, undoSkip, setSkipReason, type QueueFilters, type QueueItemRow, type QueuePage,
} from './actions'

const CHIP = 'px-3 py-1.5 rounded-full text-[9px] tracking-[0.12em] border transition-colors'
const CHIP_ON = `${CHIP} bg-[#0A0A0A] text-white border-[#0A0A0A]`
const CHIP_OFF = `${CHIP} bg-white text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]`

/**
 * Always lead in pounds — you shop in £, so a queue mixing $, € and kr is
 * unreadable. The native price follows in brackets when it isn't GBP, because
 * a converted figure is an estimate and the retailer charges the original.
 */
function fmtPrice(price: string | null, currency: string | null, priceGbp?: number | null): string {
  const sym: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', DKK: 'kr ', SEK: 'kr ', NOK: 'kr ', CHF: 'CHF ' }
  const native = price ? `${sym[currency ?? ''] ?? ''}${String(price).replace(/\.00$/, '')}` : ''
  if (priceGbp == null) return native
  const gbp = `£${Math.round(priceGbp)}`
  if (!native || (currency ?? 'GBP') === 'GBP') return gbp
  return `${gbp} (${native})`
}

/**
 * Chips for every value the queue actually holds, in picker order, with a
 * count. A value the picker list doesn't know still gets a chip, and the
 * selected chip stays visible even when another filter takes its count to 0 —
 * no piece in the queue is ever unreachable by filter.
 */
function chipsFor<T extends { value: string; label: string }>(
  known: readonly T[], counts: Record<string, number>, selected: string,
): { value: string; label: string; count: number; known?: T }[] {
  const out: { value: string; label: string; count: number; known?: T }[] = known
    .filter((k) => (counts[k.value] ?? 0) > 0 || k.value === selected)
    .map((k) => ({ value: k.value, label: k.label, count: counts[k.value] ?? 0, known: k }))
  const listed = new Set(known.map((k) => k.value))
  for (const value of Object.keys(counts).sort()) {
    if (!listed.has(value) && counts[value] > 0) out.push({ value, label: value.replace(/[_-]/g, ' ').toUpperCase(), count: counts[value] })
  }
  return out
}

interface Props extends QueuePage {
  watched: WatchedBrandRow[]
  trust: Record<string, BrandTrust>
  twinTrust: Record<string, TwinTrust>
  confidenceTrust?: Record<string, { trusted: boolean; summary: string; coverage: number }>
  decided?: Record<string, { kept: number; skipped: number }>
}

// A scan writes { running: true } and clears it when it finishes or fails. If
// the process dies between those two — a timeout, a dev-server restart, a
// crash inside a vision pass — the flag is left set and the card says
// "SCANNING" forever, with no way back. Anything older than half an hour is
// not running any more.
const STALE_SCAN_MS = 30 * 60 * 1000
function staleScan(state: { running?: boolean; started_at?: string } | null | undefined): boolean {
  if (!state?.running) return false
  const started = state.started_at ? Date.parse(state.started_at) : NaN
  return !Number.isFinite(started) || Date.now() - started > STALE_SCAN_MS
}

export default function BrandWatchClient(props: Props) {
  const { watched, trust, twinTrust } = props
  const confidenceTrust = props.confidenceTrust ?? {}
  // What MYRA added by itself — open it and every one can be sent back.
  const [autoAdded, setAutoAdded] = useState<any[] | null>(null)
  // Shops she asked for from the mirror, where MYRA could not read the page.
  const [requests, setRequests] = useState<any[] | null>(null)
  useEffect(() => { void loadSiteRequests().then((r) => setRequests(r.rows ?? [])) }, [])
  const decided = props.decided ?? {}
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
  // Why the last skip happened — optional, one tap; the learning weighs it.
  const [reasonFor, setReasonFor] = useState<string[]>([])

  // queue state — starts from the server render, replaced when a brand is
  // selected (the learning re-trains server-side on every load)
  const [page, setPage] = useState<QueuePage>(props)
  const [fBrand, setFBrand] = useState('')
  const [showPredicted, setShowPredicted] = useState(false)

  const [fType, setFType] = useState('')
  const [fColour, setFColour] = useState('')
  const [minScore, setMinScore] = useState<number | null>(null)

  const queue = page.queue
  // Type, colour, score and predicted-skip filters run on the SERVER over the
  // whole queue, and the chips come from its counts. Built from the loaded page
  // they vanished — SNEAKER disappeared under ALL BRANDS whenever the top 200
  // held none — and a filter could only search what happened to be loaded.
  const typeCounts = page.typeCounts ?? {}
  const colourCounts = page.colourCounts ?? {}
  const typeChips = useMemo(() => chipsFor(PICKER_TYPES, typeCounts, fType), [typeCounts, fType])
  const colourChips = useMemo(() => chipsFor(PICKER_COLOURS, colourCounts, fColour), [colourCounts, fColour])

  const shown = useMemo(() => queue.filter((q) => !gone.has(q.item_id)), [queue, gone])

  const act = (fn: () => Promise<unknown>, done?: (r: any) => void) =>
    startTransition(async () => {
      try { const r = await fn(); done?.(r) }
      catch (e) { setNotice(e instanceof Error ? e.message : String(e)) }
      finally { setBusyBrand(null) }
    })

  const filtersNow = (over: Partial<QueueFilters> = {}): QueueFilters =>
    ({ itemType: fType, colour: fColour, minScore, showPredicted, ...over })

  const load = (brand: string, filters: QueueFilters) =>
    act(() => loadQueuePage(0, brand || undefined, filters), (r: QueuePage) => { setPage(r); setGone(new Set()) })

  const selectBrand = (name: string) => {
    const next = fBrand === name ? '' : name
    setFBrand(next)
    load(next, filtersNow())
  }

  const setFilter = (over: Partial<QueueFilters>) => {
    if ('itemType' in over) setFType(over.itemType ?? '')
    if ('colour' in over) setFColour(over.colour ?? '')
    if ('minScore' in over) setMinScore(over.minScore ?? null)
    if ('showPredicted' in over) setShowPredicted(!!over.showPredicted)
    load(fBrand, filtersNow(over))
  }

  const reloadQueue = () => load(fBrand, filtersNow())

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
    if (!keep) { setLastSkip(ids); setReasonFor(ids) } else setReasonFor([])
    // Fire-and-forget, OUTSIDE the shared transition: the card is already hidden
    // optimistically, so a decision must never block the next one. Each skip/keep
    // fires its own independent request, so rapid tapping never freezes the grid.
    ;(keep ? keepItems(ids) : skipItems(ids))
      .then((r) => setNotice(`${r.updated} ${keep ? 'KEPT → ADDED TO LIBRARY AS READY' : 'SKIPPED — NEVER ENTERS THE LIBRARY'} — LEARNING UPDATES ON NEXT LOAD`))
      .catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
  }

  const undoLastSkip = () => {
    const ids = lastSkip
    setLastSkip([])
    setReasonFor([])
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
                      {w.scan_state?.running && (staleScan(w.scan_state)
                        ? <span className="text-[#B4593A]"> · SCAN STOPPED PART-WAY — RUN FULL SCAN AGAIN</span>
                        : <span className="text-[#C4A882]"> · SCANNING {w.scan_state.done ?? 0}/{w.scan_state.total ?? '?'}</span>)}
                      {!w.scan_state?.running && (w.scan_state?.remaining ?? 0) > 0 && <span className="text-[#C4A882]"> · {w.scan_state!.remaining} PAGES LEFT — FULL SCAN TO CONTINUE</span>}
                    </span>
                  </button>
                  <span className="flex gap-1.5 flex-shrink-0">
                    <button
                      disabled={pending}
                      onClick={() => { setBusyBrand(w.watched_brand_id); act(() => checkBrandNow(w.watched_brand_id), (r) => { setNotice(r.error ?? `${r.result.name}: ${r.result.newProducts} NEW, ${r.result.queued} QUEUED, ${r.result.skippedStock} HELD FOR STOCK, ${r.result.suppressedByLearning ?? 0} SUPPRESSED BY LEARNING, ${r.result.restocked} RESTOCKED${r.result.visionColours ? `, ${r.result.visionColours} COLOURS READ FROM THE IMAGES` : ''}${r.result.autoKept ? `, ${r.result.autoKept} AUTO-KEPT` : ''}${r.result.autoNote ? ` — ${r.result.autoNote}` : ''}`); if (!r.error) reloadQueue() }) }}
                      className="text-[8px] tracking-[0.1em] text-[#4A4E57] border border-[#E2E0DB] rounded-full px-2.5 py-1 hover:border-[#0A0A0A] transition-colors disabled:opacity-40"
                    >
                      {busyBrand === w.watched_brand_id ? <span className="text-[#C4A882]">WORKING…</span> : 'CHECK NOW'}
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => { setBusyBrand(w.watched_brand_id); act(() => fullScanBrand(w.watched_brand_id), (r) => { setNotice(r.error ?? `${r.result.name}: ${r.result.queued} QUEUED FROM THE FULL CATALOGUE (${r.result.belowScore} BELOW MIN SCORE)${r.result.visionColours ? `, ${r.result.visionColours} COLOURS READ FROM THE IMAGES` : ''}${r.result.note ? ` — ${r.result.note.toUpperCase()}` : ''}`); if (!r.error) reloadQueue() }) }}
                      className="text-[8px] tracking-[0.1em] text-[#4A4E57] border border-[#E2E0DB] rounded-full px-2.5 py-1 hover:border-[#0A0A0A] transition-colors disabled:opacity-40"
                      title="Queue every on-taste piece in the whole catalogue at this brand's min score — lower the min score and run again to go deeper"
                    >
                      FULL SCAN
                    </button>
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[8px] tracking-[0.1em] text-[#A8A8A4]">
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
                  {/* AUTO-KEEP TWINS — the first, narrower level: only new pieces
                      from a design line you kept yourself. Unlocks on twin trust. */}
                  <button
                    disabled={pending || (!w.auto_keep_twins && !twinTrust[w.watched_brand_id]?.trusted)}
                    onClick={() => act(() => setWatchedBrandAutoKeepTwins(w.watched_brand_id, !w.auto_keep_twins), (r) =>
                      setNotice(r.error ?? (w.auto_keep_twins
                        ? `${w.name.toUpperCase()}: AUTO-KEEP TWINS OFF`
                        : `${w.name.toUpperCase()}: AUTO-KEEP TWINS ON — FROM THE NEXT SCAN, NEW PIECES FROM DESIGNS YOU KEPT GO STRAIGHT TO THE LIBRARY`)))}
                    className={`transition-colors disabled:cursor-not-allowed ${w.auto_keep_twins ? 'text-[#3D6B45] font-bold' : twinTrust[w.watched_brand_id]?.trusted ? 'text-[#0A0A0A] underline underline-offset-2' : 'text-[#C9C7C2]'}`}
                    title={w.auto_keep_twins ? 'Switch off — twins wait for you again' : twinTrust[w.watched_brand_id]?.trusted ? 'New pieces from a design line you kept go straight to the library' : 'Unlocks when twins of your keeps have proven to be pieces you keep'}
                  >
                    {w.auto_keep_twins ? 'AUTO-KEEP TWINS ✓' : 'AUTO-KEEP TWINS'}
                  </button>
                  {/* AUTOMATE unlocks only once this brand's learning has proven
                      it keeps what you keep; it can always be switched off. */}
                  <button
                    disabled={pending || (!w.auto_keep && !trust[w.watched_brand_id]?.trusted)}
                    onClick={() => act(() => setWatchedBrandAutoKeep(w.watched_brand_id, !w.auto_keep), (r) =>
                      setNotice(r.error ?? (w.auto_keep
                        ? `${w.name.toUpperCase()}: AUTOMATE OFF — NEW PIECES WAIT IN THE QUEUE FOR YOU`
                        : `${w.name.toUpperCase()}: AUTOMATED — FROM THE NEXT SCAN, NEW PIECES IT WOULD KEEP GO STRAIGHT TO THE LIBRARY`)))}
                    className={`transition-colors disabled:cursor-not-allowed ${w.auto_keep ? 'text-[#3D6B45] font-bold' : trust[w.watched_brand_id]?.trusted ? 'text-[#0A0A0A] underline underline-offset-2' : 'text-[#C9C7C2]'}`}
                    title={w.auto_keep ? 'Switch off — new pieces wait for you again' : trust[w.watched_brand_id]?.trusted ? 'Let new pieces this brand’s learning would keep go straight to the library' : 'Unlocks when this brand’s learning has proven itself on your one-by-one decisions'}
                  >
                    {w.auto_keep ? 'AUTOMATED ✓' : 'AUTOMATE'}
                  </button>
                  <button
                    disabled={pending}
                    onClick={() => { if (confirm(`Stop watching ${w.name}? Seen history is deleted too.`)) act(() => removeWatchedBrand(w.watched_brand_id)) }}
                    className="hover:text-[#B3202A] transition-colors"
                  >
                    REMOVE
                  </button>
                </div>
                <div className={`mt-1 text-[8px] tracking-[0.1em] ${w.auto_keep_twins && !twinTrust[w.watched_brand_id]?.trusted ? 'text-[#B4593A]' : twinTrust[w.watched_brand_id]?.trusted ? 'text-[#3D6B45]' : 'text-[#A8A8A4]'}`}>
                  {w.auto_keep_twins && !twinTrust[w.watched_brand_id]?.trusted ? 'AUTO-KEEP TWINS PAUSED — ' : ''}{twinTrust[w.watched_brand_id]?.summary ?? 'TWINS: NO TWINS OF YOUR KEEPS YET'}
                </div>
                <div className={`mt-0.5 text-[8px] tracking-[0.1em] ${w.auto_keep && !trust[w.watched_brand_id]?.trusted ? 'text-[#B4593A]' : trust[w.watched_brand_id]?.trusted ? 'text-[#3D6B45]' : 'text-[#A8A8A4]'}`}>
                  {w.auto_keep && !trust[w.watched_brand_id]?.trusted ? 'AUTOMATE PAUSED — ' : 'AUTOMATE: '}{trust[w.watched_brand_id]?.summary ?? 'NO ONE-BY-ONE DECISIONS YET'}
                </div>

                {/* BY CONFIDENCE — the bar she sets, and what it measured. */}
                <div className="mt-1 flex items-center gap-2 text-[8px] tracking-[0.12em]">
                  <button
                    disabled={pending || (!w.auto_keep_confidence && !confidenceTrust[w.watched_brand_id]?.trusted)}
                    onClick={() => act(() => setWatchedBrandAutoKeepConfidence(w.watched_brand_id, !w.auto_keep_confidence), () =>
                      setNotice(`${w.name.toUpperCase()}: AUTO-ADD ${w.auto_keep_confidence ? 'OFF' : `ON ABOVE ${Math.round(Number(w.confidence_bar ?? 0.92) * 100)}%`}`))}
                    className={`transition-colors disabled:cursor-not-allowed ${w.auto_keep_confidence ? 'text-[#3D6B45] font-bold' : confidenceTrust[w.watched_brand_id]?.trusted ? 'text-[#0A0A0A] underline underline-offset-2' : 'text-[#C9C7C2]'}`}
                    title={confidenceTrust[w.watched_brand_id]?.trusted ? 'Pieces above the bar go straight to the library' : 'Unlocks when the model has proven itself at this bar on your one-by-one decisions'}
                  >
                    {w.auto_keep_confidence ? 'AUTO-ADD ✓' : 'AUTO-ADD'}
                  </button>
                  <select
                    disabled={pending}
                    value={String(Number(w.confidence_bar ?? 0.92))}
                    onChange={(e) => act(() => setWatchedBrandConfidenceBar(w.watched_brand_id, Number(e.target.value)))}
                    className="bg-transparent text-[8px] tracking-[0.12em] text-[#6B6B6B] border border-[#E2E0DB] rounded-full px-2 py-0.5"
                    title="Only keep a piece by itself above this chance you would keep it"
                  >
                    {[0.8, 0.85, 0.9, 0.92, 0.95, 0.98].map((b) => <option key={b} value={b}>{Math.round(b * 100)}%</option>)}
                  </select>
                  {decided[w.watched_brand_id] && (
                    <span className="text-[#A8A8A4]">{decided[w.watched_brand_id].kept} KEPT · {decided[w.watched_brand_id].skipped} SKIPPED</span>
                  )}
                  {confidenceTrust[w.watched_brand_id]?.trusted && inQueue > 0 && (
                    <button
                      disabled={pending}
                      onClick={() => { if (confirm(`Add every queued ${w.name} piece already above ${Math.round(Number(w.confidence_bar ?? 0.92) * 100)}%? You can undo any of them.`)) act(() => keepConfidentNowForBrand(w.watched_brand_id), (r) => { setNotice(r.error ?? `${w.name.toUpperCase()}: ${r.kept} ADDED FROM THE QUEUE — UNDO ANY IN 'WHAT MYRA ADDED BY ITSELF'`); if (!r.error) reloadQueue() }) }}
                      className="text-[#0A0A0A] underline underline-offset-2"
                      title="Automation only takes pieces found after it was switched on; this clears what is already waiting"
                    >
                      ADD THE BACKLOG
                    </button>
                  )}
                </div>
                <div className={`mt-0.5 text-[8px] tracking-[0.1em] ${w.auto_keep_confidence && !confidenceTrust[w.watched_brand_id]?.trusted ? 'text-[#B4593A]' : confidenceTrust[w.watched_brand_id]?.trusted ? 'text-[#3D6B45]' : 'text-[#A8A8A4]'}`}>
                  {w.auto_keep_confidence && !confidenceTrust[w.watched_brand_id]?.trusted ? 'AUTO-ADD PAUSED — ' : 'AUTO-ADD: '}{confidenceTrust[w.watched_brand_id]?.summary ?? 'NO ONE-BY-ONE DECISIONS YET'}
                </div>
              </div>
            )
          })}
        </div>

        {/* SHOPS SHE ASKED FOR — from the mirror, where it could not read the page. */}
        {requests && requests.length > 0 && (
          <div className="mt-4 border border-[#E2E0DB] rounded-[10px] p-2.5">
            <p className="text-[9px] tracking-[0.14em] text-[#0A0A0A] mb-1.5">SHOPS SHE ASKED FOR · {requests.length}</p>
            {requests.map((r) => (
              <div key={r.request_id} className="py-1.5 border-b border-[#F1F0ED] last:border-0">
                <p className="text-[10px] tracking-[0.06em] text-[#4A4E57]">{r.host.toUpperCase()}</p>
                <p className="text-[8px] tracking-[0.1em] text-[#A8A8A4]">
                  {r.member_name ? `${r.member_name.toUpperCase()} · ` : ''}ASKED {r.times_asked}×{r.reason === 'no_grid' ? ' · READ IT, FOUND NO GRID' : ' · CANNOT READ IT'}
                </p>
                <div className="flex gap-3 mt-1 text-[8px] tracking-[0.12em]">
                  <button
                    disabled={pending}
                    onClick={() => act(() => decideSiteRequest(r.request_id, 'watching'), (x) => {
                      setNotice(x.error ?? `${r.host.toUpperCase()}: ON THE WATCHLIST${x.result ? ` — ${x.result.queued} QUEUED` : ''}`)
                      if (!x.error) setRequests((cur) => (cur ?? []).filter((y) => y.request_id !== r.request_id))
                    })}
                    className="text-[#0A0A0A] underline underline-offset-2"
                  >
                    WATCH IT
                  </button>
                  <a href={r.url ?? `https://${r.host}`} target="_blank" rel="noreferrer" className="text-[#6B6B6B] hover:text-[#0A0A0A]">OPEN</a>
                  <button
                    disabled={pending}
                    onClick={() => act(() => decideSiteRequest(r.request_id, 'declined'), (x) => {
                      if (!x.error) setRequests((cur) => (cur ?? []).filter((y) => y.request_id !== r.request_id))
                      setNotice(x.error ?? `${r.host.toUpperCase()}: SET ASIDE`)
                    })}
                    className="text-[#A8A8A4] hover:text-[#B3202A]"
                  >
                    NOT THIS ONE
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {watched.length > 0 && (
          <button
            disabled={pending}
            onClick={() => act(async () => { const r = await loadAutoAdded(); setAutoAdded(r.rows); return r }, (r) =>
              setNotice(r.error ?? (r.rows.length ? `${r.rows.length} PIECES MYRA ADDED BY ITSELF — UNDO ANY BELOW` : 'MYRA HAS NOT ADDED ANYTHING BY ITSELF YET')))}
            className="mt-3 w-full border border-[#E2E0DB] rounded-full px-4 py-2 text-[9px] tracking-[0.14em] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors disabled:opacity-40"
          >
            WHAT MYRA ADDED BY ITSELF
          </button>
        )}

        {autoAdded && autoAdded.length > 0 && (
          <div className="mt-2 border border-[#E2E0DB] rounded-[10px] p-2 max-h-[280px] overflow-auto">
            {autoAdded.map((r) => (
              <div key={r.queue_id} className="flex items-center gap-2 py-1.5 border-b border-[#F1F0ED] last:border-0">
                {r.image_url && <img src={r.image_url} alt="" className="w-8 h-10 object-cover rounded-[3px] bg-[#F3F2F0]" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[8px] tracking-[0.12em] text-[#A8A8A4] truncate">{(r.brand_name ?? '').toUpperCase()}</p>
                  <p className="text-[9px] tracking-[0.04em] text-[#4A4E57] truncate">{r.product_name.toUpperCase()}</p>
                </div>
                <button
                  disabled={pending}
                  onClick={() => act(() => undoAutoKeep(r.queue_id), (x) => { if (!x.error) setAutoAdded((cur) => (cur ?? []).filter((y) => y.queue_id !== r.queue_id)); setNotice(x.error ?? 'SENT BACK — MYRA LEARNS IT WAS WRONG TO ADD IT') })}
                  className="text-[8px] tracking-[0.12em] text-[#B3202A] hover:underline"
                >
                  UNDO
                </button>
              </div>
            ))}
          </div>
        )}

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
          <button onClick={() => setFilter({ itemType: '' })} className={fType === '' ? CHIP_ON : CHIP_OFF}>ALL TYPES</button>
          {typeChips.map((t) => (
            <button key={t.value} onClick={() => setFilter({ itemType: fType === t.value ? '' : t.value })} className={fType === t.value ? CHIP_ON : CHIP_OFF}>{t.label} · {t.count}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button onClick={() => setFilter({ colour: '' })} className={fColour === '' ? CHIP_ON : CHIP_OFF}>ALL COLOURS</button>
          {colourChips.map((c) => (
            <button key={c.value} onClick={() => setFilter({ colour: fColour === c.value ? '' : c.value })} className={`${fColour === c.value ? CHIP_ON : CHIP_OFF} flex items-center gap-1.5`}>
              <span className="w-2.5 h-2.5 rounded-full border border-[#E2E0DB]" style={{ background: (c.known as any)?.swatch ?? 'transparent' }} />
              {c.label} · {c.count}
            </button>
          ))}
          <span className="mx-2 h-4 w-px bg-[#E2E0DB]" />
          {[null, 5, 7].map((s) => (
            <button key={String(s)} onClick={() => setFilter({ minScore: s })} className={minScore === s ? CHIP_ON : CHIP_OFF}>
              {s === null ? 'ALL SCORES' : `+${s} AND UP`}
            </button>
          ))}
          {(page.predictedSkipTotal > 0 || showPredicted) && (
            <>
              <span className="mx-2 h-4 w-px bg-[#E2E0DB]" />
              <button onClick={() => setFilter({ showPredicted: !showPredicted })} className={showPredicted ? CHIP_ON : CHIP_OFF} title="Pieces the keep/skip learning expects you to skip — hidden by default, never deleted">
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
            {reasonFor.length > 0 && (
              <span className="inline-flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] tracking-[0.12em] text-[#6B6B6B]">WHY?</span>
                {([['not_style', 'NOT THE STYLE'], ['colour', 'COLOUR'], ['type', 'TYPE OF PIECE'], ['too_young', 'TOO YOUNG'], ['price', 'PRICE']] as const).map(([id, text]) => (
                  <button
                    key={id}
                    onClick={() => {
                      const ids = reasonFor
                      setReasonFor([])
                      setSkipReason(ids, id)
                        .then((r) => setNotice(r.error ? r.error.toUpperCase() : `NOTED — ${text} · THE LEARNING WEIGHS IT ON NEXT LOAD`))
                        .catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
                    }}
                    className="border border-[#0A0A0A] text-[#0A0A0A] rounded-full px-3 py-1.5 text-[11px] tracking-[0.1em] hover:bg-[#0A0A0A] hover:text-white transition-colors"
                  >
                    {text}
                  </button>
                ))}
              </span>
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
            {(() => {
              // KEEP TWINS NOW: this brand's queued pieces from designs you kept —
              // offered only once twins of your keeps have proven reliable here.
              const sel = fBrand ? watched.find((w) => w.name.toLowerCase() === fBrand.toLowerCase()) : undefined
              const n = fBrand ? page.twinCounts?.[fBrand] ?? 0 : 0
              if (!sel || !n || !twinTrust[sel.watched_brand_id]?.trusted) return null
              return (
                <button
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Keep the ${n} ${fBrand} pieces that are twins of designs you kept? They go straight to the library as ready.`))
                      act(() => keepTwinsNowForBrand(sel.watched_brand_id), (r) => { setNotice(r.error?.toUpperCase() ?? `${r.kept} TWINS OF YOUR ${fBrand.toUpperCase()} KEEPS KEPT → READY`); reloadQueue() })
                  }}
                  className="bg-[#3D6B45] text-white rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
                  title="Every queued piece from a design line you kept yourself, and not a twin of anything you skipped"
                >
                  KEEP {n} TWINS OF YOUR KEEPS
                </button>
              )
            })()}
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
              {page.queueTotal === 0 && !fType && !fColour && minScore === null
                ? 'QUEUE IS EMPTY — NEW DROPS LAND HERE AFTER THE MONDAY CHECK.'
                : page.queueTotal - gone.size > 0 ? 'ALL LOADED PIECES DECIDED.' : 'NOTHING MATCHES THESE FILTERS.'}
            </p>
            {page.queueTotal - gone.size > 0 && (
              <button
                disabled={pending}
                onClick={reloadQueue}
                className="mt-4 border border-[#0A0A0A] rounded-full px-6 py-2 text-[9px] tracking-[0.14em] text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-40"
              >
                LOAD THE NEXT {Math.min(200, page.queueTotal - gone.size)}
              </button>
            )}
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
                  {/* Pre-launch and thin stock are queueable now — say so. */}
                  {q.stock_status === 'out_of_stock' && (
                    <span className="absolute bottom-2 left-2 bg-[#0A0A0A]/85 text-white rounded px-1.5 py-0.5 text-[8px] tracking-[0.1em]">COMING SOON</span>
                  )}
                  {q.stock_status === 'low_stock' && (
                    <span className="absolute bottom-2 left-2 bg-[#C4A882] text-white rounded px-1.5 py-0.5 text-[8px] tracking-[0.1em]">LOW STOCK</span>
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
                  {/* How sure MYRA is you would keep it — this brand's own model. */}
                  {q.confidence != null && (
                    <span
                      className={`absolute bottom-2 left-2 rounded-full px-2 py-[3px] text-[9px] tracking-[0.08em] border ${q.confidence >= 0.9 ? 'bg-[#3D6B45] text-white border-[#3D6B45]' : q.confidence >= 0.8 ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'bg-white/95 text-[#6B6B6B] border-[#E2E0DB]'}`}
                      title="How likely you are to keep this, learned from your own decisions for this brand. AUTO-ADD keeps the ones above your bar."
                    >
                      {Math.round(q.confidence * 100)}% SURE
                    </span>
                  )}
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
                  {q.twin_of && (
                    <p className="text-[8px] tracking-[0.1em] text-[#3D6B45]" title="Same design as a piece you kept — AUTO-KEEP TWINS would keep it">
                      TWIN OF YOUR KEEP: {q.twin_of.toUpperCase()}
                    </p>
                  )}
                  <p className="text-[8px] tracking-[0.1em] text-[#A8A8A4]">
                    {[q.item_type, q.colour_family, q.material_category].filter(Boolean).join(' · ').toUpperCase()}
                  </p>
                  <p className="text-[10px] tracking-[0.06em] text-[#4A4E57]">{fmtPrice(q.price, q.currency, q.price_gbp)}</p>
                  <div className="mt-auto pt-2 flex gap-2">
                    <button
                      onClick={() => decide([q.item_id], true)}
                      className="flex-1 bg-[#0A0A0A] text-white rounded-full py-1.5 text-[8px] tracking-[0.14em] hover:opacity-85 transition-opacity disabled:opacity-40"
                    >
                      KEEP
                    </button>
                    <button
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
                onClick={() => act(() => loadQueuePage(queue.length, fBrand || undefined, filtersNow()), (r: QueuePage) => setPage((p) => ({ ...r, queue: p.queue.concat(r.queue.filter((n) => !p.queue.some((e) => e.item_id === n.item_id))) })))}
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
