'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { PICKER_COLOURS, PICKER_TYPES } from '@/components/admin/ItemPickerModal'
import { findSimilarToSkipped } from '@/lib/brand-watch-similar'
import { useRouter } from 'next/navigation'
import { DEFAULT_CONFIDENCE } from '@/lib/brand-watch-confidence'
import type { WatchedBrandRow } from '@/lib/brand-watch'
import type { BrandTrust } from '@/lib/brand-watch-trust'
import type { TwinTrust } from '@/lib/brand-watch-twins'
import {
  addWatchedBrandInBackground, checkAllBrandsNowInBackground, checkBrandNowInBackground, fullScanBrandInBackground,
  keepAllForBrandInBackground, keepConfidentNowInBackground, keepShownInBackground, loadBrandJobs,
  keepItems, loadQueuePage, removeWatchedBrand, setWatchedBrandActive, setWatchedBrandAutoKeep, setWatchedBrandScanUrl, startMirrorScan,
  setWatchedBrandAutoKeepConfidence, setWatchedBrandConfidenceBar, loadAutoAdded, undoAutoKeep,
  setWatchedBrandAutoKeepAll,
  loadSiteRequests, decideSiteRequest,
  setWatchedBrandAutoKeepTwins, keepTwinsNowForBrand,
  setWatchedBrandMinScore, skipItems, undoSkip, setSkipReason, type QueueFilters, type QueueItemRow, type QueuePage, type QueueSort,
  type BrandJobState,
} from './actions'
import { bulkLine, bulkLineVisible, type BulkJob } from '@/lib/brand-watch-jobs'

const CHIP = 'px-3 py-1.5 rounded-full text-[9px] tracking-[0.12em] border transition-colors'
const CHIP_ON = `${CHIP} bg-[#0A0A0A] text-white border-[#0A0A0A]`
const CHIP_OFF = `${CHIP} bg-white text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]`

/**
 * An automation switch. Never greyed: a brand may be switched on before the gate
 * is earned, and the card says which levels are running unproven. Bold green
 * when on, plain when off and unproven, underlined when the gate was earned.
 */
const toggle = (on: boolean | undefined | null, trusted: boolean): string =>
  `transition-colors ${on ? 'text-[#3D6B45] font-bold' : trusted ? 'text-[#0A0A0A] underline underline-offset-2' : 'text-[#6B6B6B]'}`

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
  const { trust, twinTrust } = props
  const router = useRouter()
  const confidenceTrust = props.confidenceTrust ?? {}

  // A switch she flips shows here the moment the write lands. The per-brand
  // actions no longer re-render the page server-side for a one-column write, so
  // the card would otherwise keep showing the old state until the next load.
  const [tweaks, setTweaks] = useState<Record<string, Partial<WatchedBrandRow>>>({})
  const watched = useMemo(
    () => props.watched.map((w) => (tweaks[w.watched_brand_id] ? { ...w, ...tweaks[w.watched_brand_id] } : w)),
    [props.watched, tweaks],
  )
  const tweak = (id: string, over: Partial<WatchedBrandRow>) =>
    setTweaks((t) => ({ ...t, [id]: { ...(t[id] ?? {}), ...over } }))
  // What MYRA added by itself — open it and every one can be sent back.
  const [autoAdded, setAutoAdded] = useState<any[] | null>(null)
  // Every scan runs on its own now; this says so, and the page follows it.
  const started = (r: any) => {
    setNotice(r?.error ?? `${(r?.name ?? 'IT').toUpperCase()}: SCANNING IN THE BACKGROUND — CARRY ON, THE PAGE FOLLOWS IT`)
    if (!r?.error) router.refresh()
  }

  // Shops she asked for from the mirror, where MYRA could not read the page.
  const [requests, setRequests] = useState<any[] | null>(null)
  useEffect(() => { void loadSiteRequests().then((r) => setRequests(r.rows ?? [])) }, [])

  // While a scan is running the page follows it, so she can carry on keeping
  // and skipping while a catalogue is read. A flag left behind by a scan that
  // died is not a running scan — it used to keep the page refreshing forever,
  // greying every button and throwing the grid back to ALL BRANDS. The reload
  // goes through a ref so it always sees the brand and filters she has now,
  // and it runs outside the shared transition so nothing is disabled by it.
  const scanning = watched.some((w) => (w.scan_state as any)?.running && !staleScan(w.scan_state as any))
  const quietReload = useRef<() => void>(() => undefined)
  useEffect(() => {
    if (!scanning) return
    const t = setInterval(() => { router.refresh(); quietReload.current() }, 20_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning])
  const decided = props.decided ?? {}
  // Per-action busy keys, NOT one shared flag. A single `pending` disabled every
  // control on the page at once, so choosing a brand or flipping one switch
  // stopped her touching anything else — and setting up four brands meant four
  // waits in a row. Each control now greys only itself, and the page is hers
  // throughout.
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const busyWith = (key: string) => busy.has(key)
  // The grid render stays a transition: 200 cards arriving at once should be
  // interruptible. Everything else is urgent and non-blocking.
  const [, startTransition] = useTransition()
  const [queueLoading, setQueueLoading] = useState(false)
  const [url, setUrl] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
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
  const brandRef = useRef(fBrand)
  brandRef.current = fBrand
  const [showPredicted, setShowPredicted] = useState(false)

  const [fType, setFType] = useState('')
  const [fColour, setFColour] = useState('')
  const [minScore, setMinScore] = useState<number | null>(null)
  const [fSort, setFSort] = useState<QueueSort>('rank')
  // Autumn/current-season only for now. Outgoing summer is not reviewable.
  const fSeason: 'in' = 'in'

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
  // The watchlist row behind the selected brand chip — the brand-scoped buttons
  // need its id, because that is what a background job is keyed on.
  const selectedBrand = fBrand ? watched.find((w) => w.name.toLowerCase() === fBrand.toLowerCase()) : undefined

  // One control's work, marked under its own key so nothing else on the page
  // waits for it. Deliberately not a transition: an await inside startTransition
  // holds the transition open for the whole round trip.
  const act = (key: string, fn: () => Promise<any>, done?: (r: any) => void) => {
    setBusy((s) => new Set(s).add(key))
    void (async () => {
      try { const r = await fn(); done?.(r) }
      catch (e) { setNotice(e instanceof Error ? e.message : String(e)) }
      finally { setBusy((s) => { const n = new Set(s); n.delete(key); return n }) }
    })()
  }

  const filtersNow = (over: Partial<QueueFilters> = {}): QueueFilters =>
    ({ itemType: fType, colour: fColour, minScore, showPredicted, sort: fSort, season: fSeason, ...over })

  // A queue load never blocks the page and never overwrites a newer one: rapid
  // brand clicks are the normal case, and the last one she tapped must win.
  const loadSeq = useRef(0)
  const load = (brand: string, filters: QueueFilters) => {
    const seq = ++loadSeq.current
    setQueueLoading(true)
    void (async () => {
      try {
        const r = await loadQueuePage(0, brand || undefined, filters)
        if (seq !== loadSeq.current) return
        startTransition(() => { setPage(r); setGone(new Set()) })
      } catch (e) {
        if (seq === loadSeq.current) setNotice(e instanceof Error ? e.message : String(e))
      } finally {
        if (seq === loadSeq.current) setQueueLoading(false)
      }
    })()
  }

  // The brand highlights on the tap, not on the response.
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
    if ('sort' in over) setFSort(over.sort ?? 'rank')
    load(fBrand, filtersNow(over))
  }

  const reloadQueue = () => load(fBrand, filtersNow())
  quietReload.current = () => {
    const brand = fBrand
    void loadQueuePage(0, brand || undefined, filtersNow())
      .then((r) => { if (brandRef.current === brand) { setPage(r); setGone(new Set()) } })
      .catch(() => undefined)
  }

  // ---- background jobs -----------------------------------------------------
  // A keep or a backlog clear runs server-side and reports on its own brand's
  // card. Poll only while something is running, and pull the queue again when
  // one finishes — a keep changes what is in it.
  const [jobs, setJobs] = useState<Record<string, BrandJobState>>({})
  const prevJobs = useRef<Record<string, BrandJobState>>({})
  const anyJob = useMemo(
    () => Object.values(jobs).some((j) => (j.bulk && !j.bulk.ended_at) || j.scan),
    [jobs],
  )
  // A job she just started shows at once, and gets the poll going before the
  // server has written anything.
  const expectJob = (id: string, job: BulkJob) =>
    setJobs((j) => ({ ...j, [id]: { ...(j[id] ?? {}), bulk: job } }))
  const clearJob = (id: string) =>
    setJobs((j) => {
      const n = { ...j }
      delete n[id]
      return n
    })
  // One read on mount, so a job started before she reloaded still shows and the
  // poll below knows to keep going.
  useEffect(() => { void loadBrandJobs().then(setJobs).catch(() => undefined) }, [])
  useEffect(() => {
    if (!anyJob) return
    let cancelled = false
    const tick = async () => {
      try {
        const next = await loadBrandJobs()
        if (cancelled) return
        // Reload the queue the once, when a keep finishes.
        const justEnded = Object.entries(next).some(([id, j]) => {
          const ended = j.bulk?.ended_at
          return !!ended && ended !== prevJobs.current[id]?.bulk?.ended_at && Date.now() - Date.parse(ended) < 120_000
        })
        prevJobs.current = next
        setJobs(next)
        if (justEnded) quietReload.current()
      } catch { /* progress is a nicety; the page works without it */ }
    }
    const t = setInterval(tick, 4_000)
    void tick()
    return () => { cancelled = true; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyJob])

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
      .then((r: any) => {
        const oos: string[] = r.outOfStock ?? []
        const low: string[] = r.lowStock ?? []
        const untyped: string[] = r.untyped ?? []
        const stock = oos.length
          ? ` · ${oos.length === 1 ? oos[0].toUpperCase() : `${oos.length} PIECES`} SOLD OUT RIGHT NOW — KEPT ON THE RESTOCK WATCH, NOT IN OUTFITS UNTIL IT IS BACK`
          : low.length ? ` · ${low.length === 1 ? low[0].toUpperCase() : `${low.length} PIECES`} LOW IN STOCK` : ''
        // A piece MYRA cannot name stays in the queue, so this must not say it
        // was added. It said "0 KEPT → ADDED TO LIBRARY AS READY" while the
        // card came back on the next load, which reads as a broken button.
        const left = untyped.length
          ? `${untyped.length === 1 ? untyped[0].toUpperCase() : `${untyped.length} PIECES`} STAYED IN THE QUEUE — NOTHING IN THE NAME SAYS WHAT KIND OF PIECE IT IS, AND MYRA WILL NOT FILE A GUESS`
          : ''
        if (keep && r.updated === 0 && left) { setNotice(left); return }
        setNotice(`${r.updated} ${keep ? 'KEPT → ADDED TO LIBRARY AS READY' : 'SKIPPED — NEVER ENTERS THE LIBRARY'}${keep ? stock : ''}${left ? ` · ${left}` : ''} — LEARNING UPDATES ON NEXT LOAD`)
      })
      .catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
  }

  const undoLastSkip = () => {
    const ids = lastSkip
    setLastSkip([])
    setReasonFor([])
    setSimilarPrompt(null)
    act('undolast', () => undoSkip(ids), (r) => {
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
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) act('add', () => addWatchedBrandInBackground(url, 'watch'), started) }}
            placeholder="HTTPS://BRAND.COM"
            className="w-full border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[10px] tracking-[0.08em] outline-none focus:border-[#0A0A0A] uppercase placeholder:text-[#A8A8A4]"
          />
          <div className="mt-2 flex gap-2">
            <button
              disabled={busyWith('add') || !url.trim()}
              onClick={() => act('add', () => addWatchedBrandInBackground(url, 'watch'), started)}
              className="flex-1 bg-[#0A0A0A] text-white rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
              title="Queue only the last 60 days of on-taste pieces, then watch weekly"
            >
              WATCH
            </button>
            <button
              disabled={busyWith('add') || !url.trim()}
              onClick={() => act('add', () => addWatchedBrandInBackground(url, 'full'), started)}
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
            const id = w.watched_brand_id
            const inQueue = page.brandCounts[w.name] ?? 0
            const selected = fBrand === w.name
            // A job reports on its own brand's card, so a brand she is not
            // looking at still says what it is doing.
            const job = jobs[id]
            const line = bulkLineVisible(job?.bulk) ? bulkLine(job?.bulk) : null
            // A switch that is on without the proof the gate wanted. Shown as one
            // short line rather than three paragraphs per brand.
            const unproven: string[] = []
            if (w.auto_keep && !trust[id]?.trusted) unproven.push(`AUTOMATE ${trust[id]?.summary ?? ''}`.trim())
            if (w.auto_keep_twins && !twinTrust[id]?.trusted) unproven.push(`TWINS ${twinTrust[id]?.summary ?? ''}`.trim())
            if (w.auto_keep_confidence && !confidenceTrust[id]?.trusted) unproven.push(`AUTO-ADD ${confidenceTrust[id]?.summary ?? ''}`.trim())
            return (
              <div key={id} className={`px-3 py-2.5 border-b border-[#EFEDE9] last:border-b-0 ${selected ? 'bg-[#FAFAF8]' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <button onClick={() => selectBrand(w.name)} className="min-w-0 text-left group" title="Show this brand's queue">
                    <span className={`block text-[10px] tracking-[0.06em] truncate group-hover:underline ${selected ? 'text-[#0A0A0A] font-bold' : w.active ? 'text-[#4A4E57]' : 'text-[#A8A8A4] line-through'}`}>
                      {w.name.toUpperCase()}
                    </span>
                    <span className="block text-[8px] tracking-[0.08em] text-[#A8A8A4]">
                      {inQueue} IN QUEUE{w.last_checked_at ? ` · CHECKED ${w.last_checked_at.slice(0, 10)}` : ' · NEVER CHECKED'}
                      {w.platform === 'browser' && ' · BROWSER'}
                      {w.platform === 'mirror' && ' · MIRROR'}
                      {w.scan_state?.running && w.scan_state.mode === 'mirror' && (staleScan(w.scan_state)
                        ? <span className="text-[#B4593A]"> · CHROME SCAN STOPPED — IS THE MIRROR ON FOR THIS SITE?</span>
                        : <span className="text-[#C4A882]"> · SCANNING IN CHROME · PAGE {w.scan_state.done ?? 1} · {w.scan_state.seen ?? 0} SEEN · {w.scan_state.queued ?? 0} QUEUED</span>)}
                      {!w.scan_state?.running && w.scan_state?.mode === 'mirror' && w.scan_state.finished_at && (
                        <span className="text-[#3D6B45]"> · LAST CHROME SCAN {w.scan_state.seen ?? 0} SEEN · {w.scan_state.queued ?? 0} QUEUED</span>)}
                      {w.scan_state?.running && w.scan_state.mode !== 'mirror' && (staleScan(w.scan_state)
                        ? <span className="text-[#B4593A]"> · SCAN STOPPED PART-WAY — RUN FULL SCAN AGAIN</span>
                        : <span className="text-[#C4A882]"> · SCANNING {job?.scan?.done ?? w.scan_state.done ?? 0}/{job?.scan?.total ?? w.scan_state.total ?? '?'}</span>)}
                      {!w.scan_state?.running && (w.scan_state?.remaining ?? 0) > 0 && <span className="text-[#C4A882]"> · {w.scan_state!.remaining} PAGES LEFT — FULL SCAN TO CONTINUE</span>}
                    </span>
                    {line && (
                      <span
                        className={`block text-[8px] tracking-[0.08em] ${line.tone === 'working' ? 'text-[#C4A882]' : line.tone === 'done' ? 'text-[#3D6B45]' : 'text-[#B4593A]'}`}
                        title="This runs in the background — carry on with other brands"
                      >
                        {line.text}
                      </span>
                    )}
                  </button>
                  <span className="flex gap-1.5 flex-shrink-0">
                    {w.platform === 'mirror' ? (
                      <button
                        disabled={busyWith(`scan:${id}`) || !w.scan_url}
                        title={w.scan_url ? 'Opens the new-in page in a new tab; the Mirror scrolls and pages through it and queues what it reads' : 'Set the new-in page below first'}
                        onClick={() => act(`scan:${id}`, () => startMirrorScan(id), (r) => {
                          if (r?.error) { setNotice(r.error.toUpperCase()); return }
                          if (r?.url) window.open(r.url, '_blank', 'noopener')
                          setNotice(`${w.name.toUpperCase()}: SCANNING IN CHROME — KEEP THAT TAB OPEN; THE CARD FOLLOWS IT`)
                        })}
                        className="text-[8px] tracking-[0.1em] text-[#F7F6F3] bg-[#141414] rounded-full px-2.5 py-1 disabled:opacity-40"
                      >
                        {busyWith(`scan:${id}`) ? 'OPENING…' : 'SCAN IN CHROME'}
                      </button>
                    ) : (<>
                    <button
                      disabled={busyWith(`scan:${id}`)}
                      onClick={() => act(`scan:${id}`, () => checkBrandNowInBackground(id), started)}
                      className="text-[8px] tracking-[0.1em] text-[#4A4E57] border border-[#E2E0DB] rounded-full px-2.5 py-1 hover:border-[#0A0A0A] transition-colors disabled:opacity-40"
                    >
                      {busyWith(`scan:${id}`) ? <span className="text-[#C4A882]">WORKING…</span> : 'CHECK NOW'}
                    </button>
                    <button
                      disabled={busyWith(`scan:${id}`)}
                      onClick={() => act(`scan:${id}`, () => fullScanBrandInBackground(id), started)}
                      className="text-[8px] tracking-[0.1em] text-[#4A4E57] border border-[#E2E0DB] rounded-full px-2.5 py-1 hover:border-[#0A0A0A] transition-colors disabled:opacity-40"
                      title="Queue every on-taste piece in the whole catalogue at this brand's min score — lower the min score and run again to go deeper"
                    >
                      FULL SCAN
                    </button>
                    </>)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[8px] tracking-[0.1em] text-[#A8A8A4]">
                  <label className="flex items-center gap-1">
                    MIN SCORE
                    <input
                      type="number" min={-9} max={9} defaultValue={w.min_score}
                      onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v !== w.min_score) act(`minscore:${id}`, () => setWatchedBrandMinScore(id, v), (r) => { tweak(id, { min_score: v }); if (r?.rescanning) setNotice(`${w.name.toUpperCase()}: MIN SCORE LOWERED TO ${v} — FULL SCAN RUNNING IN THE BACKGROUND, THE PAGE FOLLOWS IT`) }) }}
                      className="w-10 border border-[#E2E0DB] rounded px-1 py-0.5 text-[9px] text-[#4A4E57] outline-none focus:border-[#0A0A0A]"
                    />
                  </label>
                  {w.platform === 'mirror' && (
                    <label className="flex items-center gap-1 min-w-0">
                      NEW-IN PAGE
                      <input
                        type="url" defaultValue={w.scan_url ?? ''} placeholder="https://brand.com/new-in"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (w.scan_url ?? '')) act(`scanurl:${id}`, () => setWatchedBrandScanUrl(id, v), (r) => { if (r?.error) setNotice(r.error.toUpperCase()); else tweak(id, { scan_url: r?.scan_url ?? null }) }) }}
                        className="w-56 border border-[#E2E0DB] rounded px-1 py-0.5 text-[9px] text-[#4A4E57] outline-none focus:border-[#0A0A0A]"
                      />
                    </label>
                  )}
                  <button
                    disabled={busyWith(`active:${id}`)}
                    onClick={() => act(`active:${id}`, () => setWatchedBrandActive(id, !w.active), (r) => { if (!r?.error) tweak(id, { active: !w.active }) })}
                    className="hover:text-[#4A4E57] transition-colors disabled:opacity-40"
                  >
                    {w.active ? 'PAUSE' : 'RESUME'}
                  </button>
                  <button
                    disabled={busyWith(`remove:${id}`)}
                    onClick={() => { if (confirm(`Stop watching ${w.name}? Seen history is deleted too.`)) act(`remove:${id}`, () => removeWatchedBrand(id), () => router.refresh()) }}
                    className="hover:text-[#B3202A] transition-colors disabled:opacity-40"
                  >
                    REMOVE
                  </button>
                </div>

                {/* The four levels of automation, as plain switches. They are
                    never greyed out: a brand can be switched on before the gate
                    has been earned, and the line underneath says so. The
                    measurement itself is on each button's tooltip. */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[8px] tracking-[0.1em]">
                  <button
                    disabled={busyWith(`twins:${id}`)}
                    onClick={() => act(`twins:${id}`, () => setWatchedBrandAutoKeepTwins(id, !w.auto_keep_twins, !twinTrust[id]?.trusted), (r) => {
                      if (r?.error) { setNotice(r.error); return }
                      tweak(id, { auto_keep_twins: !w.auto_keep_twins })
                    })}
                    className={toggle(w.auto_keep_twins, !!twinTrust[id]?.trusted)}
                    title={`Twins of designs you kept${twinTrust[id]?.summary ? ` — ${twinTrust[id]!.summary}` : ''}`}
                  >
                    {w.auto_keep_twins ? 'TWINS ✓' : 'TWINS'}
                  </button>
                  <button
                    disabled={busyWith(`auto:${id}`)}
                    onClick={() => act(`auto:${id}`, () => setWatchedBrandAutoKeep(id, !w.auto_keep, !trust[id]?.trusted), (r) => {
                      if (r?.error) { setNotice(r.error); return }
                      tweak(id, { auto_keep: !w.auto_keep })
                    })}
                    className={toggle(w.auto_keep, !!trust[id]?.trusted)}
                    title={`What this brand's learning would keep${trust[id]?.summary ? ` — ${trust[id]!.summary}` : ''}`}
                  >
                    {w.auto_keep ? 'AUTOMATE ✓' : 'AUTOMATE'}
                  </button>
                  <button
                    disabled={busyWith(`conf:${id}`)}
                    onClick={() => act(`conf:${id}`, () => setWatchedBrandAutoKeepConfidence(id, !w.auto_keep_confidence, !confidenceTrust[id]?.trusted), (r) => {
                      if (r?.error) { setNotice(r.error); return }
                      tweak(id, { auto_keep_confidence: !w.auto_keep_confidence })
                    })}
                    className={toggle(w.auto_keep_confidence, !!confidenceTrust[id]?.trusted)}
                    title={`Pieces above your bar${confidenceTrust[id]?.summary ? ` — ${confidenceTrust[id]!.summary}` : ''}`}
                  >
                    {w.auto_keep_confidence ? 'AUTO-ADD ✓' : 'AUTO-ADD'}
                  </button>
                  {/* KEEP EVERYTHING — no model, no bar: every new piece this
                      brand queues, in season. For a brand whose taste needs no
                      predicting. Outgoing summer stock is still left alone. */}
                  <button
                    disabled={busyWith(`all:${id}`)}
                    onClick={() => act(`all:${id}`, () => setWatchedBrandAutoKeepAll(id, !w.auto_keep_all), (r) => {
                      if (r?.error) { setNotice(r.error); return }
                      tweak(id, { auto_keep_all: !w.auto_keep_all })
                    })}
                    className={toggle(!!w.auto_keep_all, true)}
                    title="Add every new piece this brand queues, in season. No bar, no model — outgoing summer stock is still left in the queue."
                  >
                    {w.auto_keep_all ? 'EVERYTHING ✓' : 'EVERYTHING'}
                  </button>
                  <select
                    disabled={busyWith(`bar:${id}`)}
                    value={String(Number(w.confidence_bar ?? DEFAULT_CONFIDENCE))}
                    onChange={(e) => act(`bar:${id}`, () => setWatchedBrandConfidenceBar(id, Number(e.target.value)), (r) => { if (!r?.error) tweak(id, { confidence_bar: Number(e.target.value) }) })}
                    className="bg-transparent text-[8px] tracking-[0.12em] text-[#6B6B6B] border border-[#E2E0DB] rounded-full px-2 py-0.5 disabled:opacity-40"
                    title="AUTO-ADD only takes a piece by itself above this chance you would keep it"
                  >
                    {[0.75, 0.8, 0.85, 0.9, 0.95].map((b) => <option key={b} value={b}>{Math.round(b * 100)}%</option>)}
                  </select>
                </div>

                {/* One short line, and only when a switch is running without the
                    proof the gate wanted. The old card carried three paragraphs
                    of measurement under every brand; it is on the tooltips now. */}
                {(unproven.length > 0 || w.auto_keep_all) && (
                  <div className="mt-1 text-[8px] tracking-[0.1em] text-[#B4593A] leading-relaxed">
                    {w.auto_keep_all && <div>EVERYTHING: EVERY NEW PIECE IN SEASON IS ADDED, NO BAR</div>}
                    {unproven.length > 0 && <div>ON WITHOUT PROOF: {unproven.join(' · ')}</div>}
                  </div>
                )}

                <div className="mt-1 flex flex-wrap items-center gap-2 text-[8px] tracking-[0.12em]">
                  {decided[id] && (
                    <span className="text-[#A8A8A4]">{decided[id].kept} KEPT · {decided[id].skipped} SKIPPED</span>
                  )}
                  {inQueue > 0 && (confidenceTrust[id]?.trusted || w.auto_keep_all || w.auto_keep_manual) && (
                    <button
                      disabled={busyWith(`backlog:${id}`)}
                      onClick={() => { if (confirm(`Add every queued ${w.name} piece already above ${Math.round(Number(w.confidence_bar ?? DEFAULT_CONFIDENCE) * 100)}%? You can undo any of them.`)) act(`backlog:${id}`, () => keepConfidentNowInBackground(id), (r) => {
                        if (r?.error) { setNotice(r.error); return }
                        // Show it on this brand's card straight away, then poll.
                        expectJob(id, { kind: 'keep-confident', label: r.label ?? 'ADDING THE BACKLOG', done: 0, total: 0, started_at: new Date().toISOString() })
                        setNotice(`${w.name.toUpperCase()}: ${r.label ?? 'ADDING THE BACKLOG'} — IN THE BACKGROUND, CARRY ON WITH ANOTHER BRAND`)
                      }) }}
                      className="text-[#0A0A0A] underline underline-offset-2 disabled:opacity-40"
                      title="Automation only takes pieces found after it was switched on; this clears what is already waiting"
                    >
                      ADD THE BACKLOG
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* SHOPS ASKED FOR — from the Mirror. MYRA judges each one (brand-onboarding-rules):
            watched, turned away, or set aside here for Chloe with the numbers. What it
            decided alone in the last fortnight is listed too, so nothing happens unseen. */}
        {requests && requests.length > 0 && (
          <div className="mt-4 border border-[#E2E0DB] rounded-[10px] p-2.5">
            <p className="text-[9px] tracking-[0.14em] text-[#0A0A0A] mb-1.5">SHOPS ASKED FOR · {requests.length}</p>
            {requests.map((r) => {
              const a = r.assessment
              const numbers = a ? ` · ${a.onTaste} OF ${a.fashion} ON TASTE · ${a.total} PRODUCTS${a.medianPriceGbp != null ? ` · MEDIAN £${Math.round(a.medianPriceGbp)}` : ''}` : ''
              const line =
                r.status === 'assessing' ? { text: 'MYRA IS READING THE SHOP…', tone: 'text-[#C4A882]' }
                : r.status === 'watching' ? { text: `MYRA ADDED IT · ${(r.verdict_note ?? '').toUpperCase()}${numbers}`, tone: 'text-[#3D6B45]' }
                : r.status === 'declined' ? { text: `MYRA SAID NO · ${(r.verdict_note ?? '').toUpperCase()}${numbers}`, tone: 'text-[#B4593A]' }
                : r.verdict === 'review' ? { text: `FOR YOU · ${(r.verdict_note ?? '').toUpperCase()}${numbers}`, tone: 'text-[#0A0A0A]' }
                : r.verdict === 'unreadable' ? { text: `CANNOT READ IT · ${(r.verdict_note ?? '').toUpperCase()}`, tone: 'text-[#B4593A]' }
                : { text: r.reason === 'no_grid' ? 'READ IT, FOUND NO GRID' : r.reason === 'add' ? 'ASKED TO ADD IT' : 'CANNOT READ IT', tone: 'text-[#A8A8A4]' }
              const settled = r.status === 'watching'
              return (
                <div key={r.request_id} className="py-1.5 border-b border-[#F1F0ED] last:border-0">
                  <p className="text-[10px] tracking-[0.06em] text-[#4A4E57]">{r.host.toUpperCase()}</p>
                  <p className="text-[8px] tracking-[0.1em] text-[#A8A8A4]">
                    {r.member_name ? `${r.member_name.toUpperCase()} · ` : ''}ASKED {r.times_asked}×
                  </p>
                  <p className={`text-[8px] tracking-[0.1em] ${line.tone}`}>{line.text}</p>
                  <div className="flex gap-3 mt-1 text-[8px] tracking-[0.12em]">
                    {!settled && (
                      <button
                        disabled={busyWith(`req:${r.request_id}`) || r.status === 'assessing'}
                        onClick={() => act(`req:${r.request_id}`, () => decideSiteRequest(r.request_id, 'watching'), (x) => {
                          setNotice(x.error ?? `${r.host.toUpperCase()}: ON THE WATCHLIST — FULL SCAN RUNNING IN THE BACKGROUND`)
                          if (!x.error) { setRequests((cur) => (cur ?? []).filter((y) => y.request_id !== r.request_id)); router.refresh() }
                        })}
                        className="text-[#0A0A0A] underline underline-offset-2 disabled:opacity-40"
                      >
                        {r.status === 'declined' || r.verdict === 'review' ? 'WATCH ANYWAY' : 'WATCH IT'}
                      </button>
                    )}
                    <a href={r.url ?? `https://${r.host}`} target="_blank" rel="noreferrer" className="text-[#6B6B6B] hover:text-[#0A0A0A]">OPEN</a>
                    {!settled && r.status !== 'declined' && (
                      <button
                        disabled={busyWith(`req:${r.request_id}`) || r.status === 'assessing'}
                        onClick={() => act(`req:${r.request_id}`, () => decideSiteRequest(r.request_id, 'declined'), (x) => {
                          setNotice(x.error ?? `${r.host.toUpperCase()}: SET ASIDE`)
                          if (!x.error) setRequests((cur) => (cur ?? []).filter((y) => y.request_id !== r.request_id))
                        })}
                        className="text-[#6B6B6B] hover:text-[#0A0A0A] disabled:opacity-40"
                      >
                        SET ASIDE
                      </button>
                    )}
                    {settled && <span className="text-[#A8A8A4]">ON THE WATCHLIST</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {watched.length > 0 && (
          <button
            disabled={busyWith('autoadded')}
            onClick={() => act('autoadded', async () => { const r = await loadAutoAdded(); setAutoAdded(r.rows); return r }, (r) =>
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
                  disabled={busyWith(`undo:${r.queue_id}`)}
                  onClick={() => act(`undo:${r.queue_id}`, () => undoAutoKeep(r.queue_id), (x) => { if (!x.error) setAutoAdded((cur) => (cur ?? []).filter((y) => y.queue_id !== r.queue_id)); setNotice(x.error ?? 'SENT BACK — MYRA LEARNS IT WAS WRONG TO ADD IT') })}
                  className="text-[8px] tracking-[0.12em] text-[#B3202A] hover:underline disabled:opacity-40"
                >
                  UNDO
                </button>
              </div>
            ))}
          </div>
        )}

        {watched.length > 0 && (
          <button
            disabled={busyWith('checkall')}
            onClick={() => act('checkall', () => checkAllBrandsNowInBackground(), () => setNotice('SCANNING EVERY BRAND IN THE BACKGROUND — THE PAGE KEEPS ITSELF UP TO DATE'))}
            className="mt-3 w-full border border-[#0A0A0A] rounded-full px-4 py-2 text-[9px] tracking-[0.14em] text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-40"
          >
            {busyWith('checkall') ? 'WORKING…' : 'RUN CHECK NOW'}
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
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-[8px] tracking-[0.14em] text-[#A8A8A4] mr-1">SEASON</span>
            <button className={CHIP_ON} title="Current autumn/winter stock, plus future dated collections and pre-orders">
              AUTUMN / WINTER
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mb-4 items-center">
            <span className="text-[8px] tracking-[0.14em] text-[#A8A8A4] mr-1">SORT</span>
            {([['rank', "MYRA'S ORDER"], ['sure_desc', 'MOST SURE FIRST'], ['sure_asc', 'LEAST SURE FIRST']] as [QueueSort, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setFilter({ sort: v })} className={fSort === v ? CHIP_ON : CHIP_OFF}>{label}</button>
            ))}
          </div>

        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <p className="text-[10px] tracking-[0.12em] text-[#6B6B6B]">
            {shown.length} SHOWN{page.queueTotal > queue.length ? ` · ${page.queueTotal - gone.size} IN ${fBrand ? fBrand.toUpperCase() + "'S" : 'THE'} QUEUE` : ''}
            {/* The load says it is working without disabling anything — she can
                tap another brand or a switch while it is in flight. */}
            {queueLoading && <span className="text-[#C4A882]"> · LOADING…</span>}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Scan notices explain WHY nothing queued, so they must be readable
                in full — truncating them hid the whole point of the message. */}
            {notice && <p className="text-[9px] tracking-[0.1em] text-[#C4A882] max-w-xl leading-relaxed">{notice}</p>}
            {/* One tap clears the near-twins of what was just skipped — the whole
                point is not skipping six monogram bags one by one. */}
            {similarPrompt && (
              <button
                disabled={busyWith('skipsim')}
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
                disabled={busyWith('undolast')}
                onClick={undoLastSkip}
                className="border border-[#C4A882] text-[#C4A882] rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:bg-[#C4A882] hover:text-white transition-colors disabled:opacity-40"
              >
                UNDO SKIP · {lastSkip.length}
              </button>
            )}
            {selected.size > 0 && (
              <>
                <button
                  onClick={() => decide(Array.from(selected), true)}
                  className="bg-[#0A0A0A] text-white rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
                >
                  KEEP SELECTED · {selected.size}
                </button>
                <button
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
              disabled={busyWith('keepshown') || shown.length === 0}
              onClick={() => {
                const ids = shown.map((q) => q.item_id)
                if (!confirm(`Keep all ${ids.length} shown? They run in the background, so you can carry on with another brand.`)) return
                act('keepshown', () => keepShownInBackground(ids), (r) => {
                  if (r?.error) { setNotice(String(r.error).toUpperCase()); return }
                  // Hide them now; the job reports on each brand's card, and the
                  // queue reloads itself when the last one finishes.
                  setGone((g) => new Set(Array.from(g).concat(ids)))
                  setSelected(new Set())
                  setNotice(`${ids.length} PIECES KEEPING IN THE BACKGROUND ACROSS ${r.brands} BRAND${r.brands === 1 ? '' : 'S'} — CARRY ON, THE QUEUE UPDATES ITSELF`)
                })
              }}
              className="bg-[#0A0A0A] text-white rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
            >
              {busyWith('keepshown') ? 'STARTING…' : 'KEEP ALL SHOWN'}
            </button>
            {(() => {
              // KEEP TWINS NOW: this brand's queued pieces from designs you kept —
              // offered only once twins of your keeps have proven reliable here.
              const sel = selectedBrand
              const n = fBrand ? page.twinCounts?.[fBrand] ?? 0 : 0
              if (!sel || !n || !twinTrust[sel.watched_brand_id]?.trusted) return null
              return (
                <button
                  disabled={busyWith(`twinsnow:${sel.watched_brand_id}`)}
                  onClick={() => {
                    if (confirm(`Keep the ${n} ${fBrand} pieces that are twins of designs you kept? They go straight to the library as ready.`))
                      act(`twinsnow:${sel.watched_brand_id}`, () => keepTwinsNowForBrand(sel.watched_brand_id), (r) => { setNotice(r.error?.toUpperCase() ?? `${r.kept} TWINS OF YOUR ${fBrand.toUpperCase()} KEEPS KEPT → READY`); reloadQueue() })
                  }}
                  className="bg-[#3D6B45] text-white rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
                  title="Every queued piece from a design line you kept yourself, and not a twin of anything you skipped"
                >
                  KEEP {n} TWINS OF YOUR KEEPS
                </button>
              )
            })()}
            {selectedBrand && (page.brandCounts[fBrand] ?? 0) > 0 && (
              <button
                disabled={busyWith(`keepall:${selectedBrand.watched_brand_id}`)}
                onClick={() => {
                  const sel = selectedBrand
                  const n = page.brandCounts[fBrand] ?? 0
                  if (!confirm(`Keep ALL ${n} ${fBrand} pieces in the queue — including ones not loaded on this page? It runs in the background.`)) return
                  act(`keepall:${sel.watched_brand_id}`, () => keepAllForBrandInBackground(sel.watched_brand_id, { includeOutOfSeason: fSeason !== 'in' }), (r) => {
                    if (r?.error) { setNotice(String(r.error).toUpperCase()); return }
                    // Show it on the card at once, then let the poll take over.
                    expectJob(sel.watched_brand_id, { kind: 'keep-all', label: r.label ?? `KEEPING ALL ${fBrand.toUpperCase()} PIECES`, done: 0, total: n, started_at: new Date().toISOString() })
                    setNotice(`${r.label ?? fBrand.toUpperCase()} — RUNNING IN THE BACKGROUND, CARRY ON WITH ANOTHER BRAND`)
                  })
                }}
                className="bg-[#C4A882] text-white rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
                title="Keep every queued draft for this brand — the whole queue, not just the loaded page. Runs in the background."
              >
                {busyWith(`keepall:${selectedBrand.watched_brand_id}`) ? 'STARTING…' : `KEEP ALL ${fBrand.toUpperCase()} · ${page.brandCounts[fBrand] ?? 0}`}
              </button>
            )}
            <button
              disabled={busyWith('skipall') || shown.length === 0}
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
                disabled={queueLoading}
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
                  {/* Stock as of the last scan; KEEP checks the shop live. Sits above
                      the confidence pill, which used to cover it. */}
                  {q.stock_status === 'out_of_stock' && (
                    <span className="absolute bottom-10 left-2 bg-[#0A0A0A]/85 text-white rounded px-1.5 py-0.5 text-[8px] tracking-[0.1em]">NOT IN STOCK</span>
                  )}
                  {q.stock_status === 'low_stock' && (
                    <span className="absolute bottom-10 left-2 bg-[#C4A882] text-white rounded px-1.5 py-0.5 text-[8px] tracking-[0.1em]">LOW STOCK</span>
                  )}
                  {q.season && q.season !== 'all' && (
                    <span className={`absolute top-2 left-1/2 -translate-x-1/2 rounded px-1.5 py-0.5 text-[8px] tracking-[0.1em] ${q.season === 'aw' ? 'bg-white/95 border border-[#E2E0DB] text-[#4A4E57]' : 'bg-[#B4593A] text-white'}`}>
                      {q.season_code ?? (q.season === 'aw' ? 'A/W' : 'S/S')}
                    </span>
                  )}
                  {/* New-in pieces lead the queue when they are otherwise current
                      or future stock. Old summer stock is never queued. */}
                  {q.new_in && (
                    <span className="absolute top-2 right-2 bg-[#0A0A0A] text-white rounded px-1.5 py-0.5 text-[8px] tracking-[0.1em]" title="In the shop's new-in section">
                      NEW IN
                    </span>
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
                disabled={busyWith('more')}
                onClick={() => act('more', () => loadQueuePage(queue.length, fBrand || undefined, filtersNow()), (r: QueuePage) => setPage((p) => ({ ...r, queue: p.queue.concat(r.queue.filter((n) => !p.queue.some((e) => e.item_id === n.item_id))) })))}
                className="border border-[#0A0A0A] rounded-full px-6 py-2 text-[9px] tracking-[0.14em] text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-40"
              >
                {busyWith('more') ? 'LOADING…' : `LOAD MORE (${page.queueTotal - queue.length} REMAINING)`}
              </button>
            </div>
          )}
          </>
        )}
      </section>
    </div>
  )
}
