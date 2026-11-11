'use client'

// MY AVATAR — the room (Chloe's sketch, 2026-11-09): her avatar in the middle, the pieces
// she has on docked at the edges of the grey stage (tops and jackets left; bottoms, scarves,
// belts and shoes right), a shelf bar, a swipe rail, ways under it, Undress / Finish.
// Swaps are instant: every piece was shot once on her avatar and kept as a layer.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { RoomView, RoomPiece } from '@/lib/avatar/wardrobe'
import { loadMyRoom, nudgeMyWardrobe, finishMyLook, retryMyLayers, deleteMyLook, shootMyWay, reshootMyPiece } from './room-actions'

const STAGE = '#E4E2DD'
const EYEBROW = 'text-[13px] tracking-[0.22em] uppercase text-[#7C838B]'
const PILL = 'rounded-full border px-4 py-2 text-[14px] tracking-[0.08em] uppercase whitespace-nowrap disabled:opacity-40'
const PILL_ON = 'bg-[#141414] text-[#F7F6F3] border-[#141414]'
const PILL_OFF = 'border-[#DCDAD4] text-[#141414] bg-transparent'

const SHELVES: { family: string; label: string; side: 'left' | 'right' }[] = [
  { family: 'top', label: 'Tops', side: 'left' },
  { family: 'bottom', label: 'Bottoms', side: 'right' },
  { family: 'dress', label: 'Dresses', side: 'right' },
  { family: 'outer', label: 'Jackets', side: 'left' },
  { family: 'scarf', label: 'Scarves', side: 'right' },
  { family: 'belt', label: 'Belts', side: 'right' },
  { family: 'shoes', label: 'Shoes', side: 'right' },
]
const sideOf = (family: string) => SHELVES.find((s) => s.family === family)?.side ?? 'right'

type On = Record<string, string>   // item_id → way_key she asked for

export default function RoomClient({ initial, startItem = null, onDelete }: { initial: RoomView; startItem?: string | null; onDelete?: () => void }) {
  const [view, setView] = useState(initial)
  // Opened from a wardrobe tile (/me/avatar?item=…): that piece is on from the first frame, in its default way.
  const startPiece = startItem ? initial.pieces.find((p) => p.item_id === startItem) ?? null : null
  const [on, setOn] = useState<On>(() => {
    if (!startPiece) return {}
    const ways = initial.ways.filter((w) => w.item_types.includes(startPiece.item_type))
    const def = ways.find((w) => w.is_default) ?? ways[0]
    return { [startPiece.item_id]: def?.way_key ?? '' }
  })
  const [chosen, setChosen] = useState<Set<string>>(new Set())   // pieces whose way she picked herself
  const [shelf, setShelf] = useState<string>(() => startPiece?.family ?? SHELVES.find((s) => initial.pieces.some((p) => p.family === s.family))?.family ?? 'top')
  const [finishing, setFinishing] = useState<string | null>(null)   // look_id being rendered
  const [showFinish, setShowFinish] = useState<string | null>(null) // finish_url on show
  const [error, setError] = useState<string | null>(null)
  const [requested, setRequested] = useState<Set<string>>(new Set())   // item|way she asked to be shot now
  const [pending, start] = useTransition()
  const nudged = useRef(false)

  const refresh = useCallback(async () => { const v = await loadMyRoom(); if (!('error' in v)) setView(v) }, [])

  // first visit: new wardrobe pieces join the queue and a drain starts
  useEffect(() => {
    if (nudged.current) return
    nudged.current = true
    nudgeMyWardrobe().then(() => refresh()).catch(() => undefined)
  }, [refresh])

  // while MYRA is shooting pieces or rendering a look, ask again every few seconds
  const busy = view.progress.ready + view.progress.failed < view.progress.total || !!finishing || requested.size > 0 || view.looks.some((l) => l.finish_status === 'queued' || l.finish_status === 'rendering')
  // one poll at a time: a new server-action call would abort the one still in flight
  useEffect(() => {
    if (!busy) return
    let alive = true
    let t: ReturnType<typeof setTimeout> | null = null
    const tick = async () => { try { await refresh() } catch { /* next tick */ } if (alive) t = setTimeout(tick, 4000) }
    t = setTimeout(tick, 4000)
    return () => { alive = false; if (t) clearTimeout(t) }
  }, [busy, refresh])

  // a look she asked for has finished
  useEffect(() => {
    if (!finishing) return
    const look = view.looks.find((l) => l.look_id === finishing)
    if (look?.finish_status === 'done' && look.finish_url) { setShowFinish(look.finish_url); setFinishing(null) }
    if (look?.finish_status === 'failed') { setError('MYRA could not render that look. Try again in a moment.'); setFinishing(null) }
  }, [view.looks, finishing])

  const pieces = useMemo(() => new Map(view.pieces.map((p) => [p.item_id, p])), [view.pieces])
  const waysByKey = useMemo(() => new Map(view.ways.map((w) => [w.way_key, w])), [view.ways])
  const waysFor = useCallback((p: RoomPiece) => view.ways.filter((w) => w.item_types.includes(p.item_type)), [view.ways])
  const readyLayer = (p: RoomPiece, way: string) => p.layers.find((l) => l.way_key === way && l.status === 'ready' && l.layer_url) ?? null
  const anyReady = (p: RoomPiece) => p.layers.some((l) => l.status === 'ready' && l.layer_url)
  const allFailed = (p: RoomPiece) => p.layers.length > 0 && p.layers.every((l) => l.status === 'failed')

  const bottomOn = Object.keys(on).some((id) => pieces.get(id)?.family === 'bottom')
  const waistPieceOn = Object.entries(on).some(([, way]) => waysByKey.get(way)?.cinches === 'outer')

  /** The way a piece actually shows in: her choice, else MYRA's rule, else whatever is ready. */
  const effectiveWay = useCallback((p: RoomPiece, asked: string): string | null => {
    let want = asked
    if (p.family === 'top' && !chosen.has(p.item_id)) want = bottomOn && readyLayer(p, 'top.tucked') ? 'top.tucked' : 'top.untucked'
    if (p.family === 'outer') want = waistPieceOn && readyLayer(p, 'outer.cinched') ? 'outer.cinched' : 'outer.worn'
    if (readyLayer(p, want)) return want
    const fallback = p.layers.find((l) => l.status === 'ready' && l.layer_url)
    return fallback?.way_key ?? null
  }, [bottomOn, waistPieceOn, chosen])

  const worn = useMemo(() => Object.entries(on).flatMap(([id, asked]) => {
    const p = pieces.get(id)
    if (!p) return []
    const way = effectiveWay(p, asked)
    if (!way) return [{ piece: p, way: asked, layer: null as null | RoomPiece['layers'][number], z: 0 }]
    return [{ piece: p, way, layer: readyLayer(p, way), z: waysByKey.get(way)?.z ?? 5 }]
  }), [on, pieces, effectiveWay, waysByKey])

  const outerClip = worn.find((w) => w.piece.family === 'outer' && w.layer?.clip_url)?.layer?.clip_url ?? null

  const putOn = (p: RoomPiece) => {
    setError(null)
    setOn((cur) => {
      if (cur[p.item_id]) { const n = { ...cur }; delete n[p.item_id]; return n }
      const n: On = {}
      for (const [id, way] of Object.entries(cur)) {
        const q = pieces.get(id)
        if (!q) continue
        const clash =
          (p.family === q.family) ||
          (p.family === 'dress' && (q.family === 'top' || q.family === 'bottom')) ||
          ((p.family === 'top' || p.family === 'bottom') && q.family === 'dress')
        if (!clash) n[id] = way
      }
      const ways = waysFor(p)
      const def = ways.find((w) => w.is_default) ?? ways[0]
      n[p.item_id] = def?.way_key ?? ''
      return n
    })
    setChosen((c) => { const n = new Set(c); n.delete(p.item_id); return n })
  }
  const takeOff = (id: string) => setOn((cur) => { const n = { ...cur }; delete n[id]; return n })
  const pickWay = (p: RoomPiece, way: string) => {
    setOn((cur) => ({ ...cur, [p.item_id]: way }))
    setChosen((c) => new Set(c).add(p.item_id))
    if (!readyLayer(p, way)) {
      // not shot yet: ask for it now; the stage switches to it the moment it lands
      const key = `${p.item_id}|${way}`
      setRequested((r) => new Set(r).add(key))
      shootMyWay(p.item_id, way).then((res) => { if (res.error) { setError(res.error); setRequested((r) => { const n = new Set(r); n.delete(key); return n }) } }).catch(() => undefined)
    }
  }
  // a requested way that has landed is no longer outstanding
  useEffect(() => {
    if (!requested.size) return
    const still = new Set<string>()
    for (const key of Array.from(requested)) {
      const [id, way] = key.split('|'); const p = pieces.get(id)
      if (!p) continue
      if (way === '*') { if (p.layers.some((l) => l.status !== 'ready' && l.status !== 'failed')) still.add(key); continue }
      if (!readyLayer(p, way)) still.add(key)
    }
    if (still.size !== requested.size) setRequested(still)
  }, [view.pieces, requested, pieces])
  const wear = (items: { item_id: string; way_key: string }[]) => {
    const n: On = {}
    for (const it of items) if (pieces.has(it.item_id)) n[it.item_id] = it.way_key
    setOn(n); setChosen(new Set(items.map((i) => i.item_id))); setShowFinish(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const finish = () => start(async () => {
    setError(null)
    const items = worn.filter((w) => w.layer).map((w) => ({ item_id: w.piece.item_id, way_key: w.way }))
    if (!items.length) { setError('Put something on first'); return }
    const r = await finishMyLook(items)
    if (r.error || !r.lookId) { setError(r.error ?? 'Could not start'); return }
    setFinishing(r.lookId)
    await refresh()
  })

  const shelfPieces = view.pieces.filter((p) => p.family === shelf)
  const shelves = SHELVES.filter((s) => view.pieces.some((p) => p.family === s.family))
  const wayPiece = shelfPieces.find((p) => on[p.item_id] && waysFor(p).length > 1) ?? null
  const shownPiece = shelfPieces.find((p) => on[p.item_id] && anyReady(p)) ?? null
  const reshoot = (p: RoomPiece) => {
    const key = `${p.item_id}|*`
    setRequested((r) => new Set(r).add(key))
    reshootMyPiece(p.item_id).then((res) => { if (res.error) setError(res.error) }).catch(() => undefined)
  }
  const docked = (side: 'left' | 'right') => worn.filter((w) => sideOf(w.piece.family) === side)
  const shooting = view.progress.total - view.progress.ready - view.progress.failed

  return (
    <div className="space-y-5 pb-20">
      {/* progress: a quiet line, not a bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-[#7C838B]">
        {shooting > 0 ? (
          <span className="inline-flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-[#141414] animate-pulse" />MYRA is shooting your pieces · {view.progress.ready} of {view.progress.total} ready</span>
        ) : view.progress.total > 0 ? (
          <span>{view.progress.ready} layers ready · every swap is instant</span>
        ) : (
          <span>Nothing in your wardrobe yet that the avatar can wear.</span>
        )}
        {view.progress.failed > 0 && (
          <button type="button" className="underline underline-offset-4" onClick={() => start(async () => { await retryMyLayers(); await refresh() })}>{view.progress.failed} didn&apos;t come out · try again</button>
        )}
      </div>
      {error && <p className="text-[16px] text-[#B83A3A]">{error}</p>}

      <div className="lg:grid lg:grid-cols-[minmax(0,auto)_minmax(0,1fr)] lg:items-start lg:gap-8 space-y-5 lg:space-y-0">
      {/* the stage */}
      <div className="flex justify-center lg:justify-start">
        <div className="relative w-full max-w-[min(100%,calc((100dvh-260px)*2/3))] lg:w-[calc((100dvh-180px)*2/3)] lg:max-w-[560px]">
          <div className="relative overflow-hidden rounded-[18px]" style={{ background: STAGE, aspectRatio: '2 / 3' }}>
            <img src={view.avatar.base_url} alt="Your avatar" className="absolute inset-0 h-full w-full" draggable={false} />
            {worn.filter((w) => w.layer).sort((a, b) => a.z - b.z).map((w) => {
              const under = outerClip && (w.piece.family === 'top' || w.piece.family === 'scarf') && w.z < 8
              return (
                <img
                  key={`${w.piece.item_id}-${w.way}`}
                  src={w.layer!.layer_url!}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full transition-opacity duration-150"
                  style={{ zIndex: w.z, ...(under ? { WebkitMaskImage: `url(${outerClip})`, maskImage: `url(${outerClip})`, WebkitMaskSize: '100% 100%', maskSize: '100% 100%' } : {}) }}
                />
              )
            })}
            <Dock side="left" items={docked('left')} waysByKey={waysByKey} takeOff={takeOff} />
            <Dock side="right" items={docked('right')} waysByKey={waysByKey} takeOff={takeOff} />
            {worn.length === 0 && (
              <p className="absolute left-1/2 top-3 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/80 px-3 py-1.5 text-[13px] text-[#141414]">Pick a shelf below, then tap a piece</p>
            )}
            {worn.some((w) => !w.layer) && (
              <p className="absolute left-1/2 top-3 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/80 px-3 py-1.5 text-[13px] text-[#141414]">Still shooting that one · it appears when ready</p>
            )}
            {(showFinish || finishing) && (
              <div className="absolute inset-0 z-30 grid grid-rows-[auto_1fr] bg-[#F7F6F3]">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[13px] tracking-[0.2em] uppercase">{finishing ? 'Finishing' : 'Finished'}</span>
                  <button type="button" onClick={() => { setShowFinish(null); setFinishing(null) }} className="text-[22px] leading-none" aria-label="Close">×</button>
                </div>
                {showFinish ? (
                  <img src={showFinish} alt="Your finished look" className="h-full w-full object-contain" style={{ background: STAGE }} />
                ) : (
                  <div className="grid place-items-center text-[16px] text-[#7C838B]"><span className="inline-flex items-center gap-3"><span className="inline-block h-2 w-2 rounded-full bg-[#141414] animate-pulse" />About a minute</span></div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-5 min-w-0">
      {/* shelves */}
      <div data-lenis-prevent className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none]" role="tablist" aria-label="Shelves">
        {shelves.map((s) => (
          <button key={s.family} type="button" role="tab" aria-selected={shelf === s.family} onClick={() => setShelf(s.family)} className={`${PILL} ${shelf === s.family ? PILL_ON : PILL_OFF}`}>{s.label}</button>
        ))}
      </div>

      {/* the rail */}
      <div data-lenis-prevent className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory [scrollbar-width:none]">
        {shelfPieces.map((p) => {
          const isOn = !!on[p.item_id]
          const ready = anyReady(p)
          const failed = allFailed(p)
          return (
            <button key={p.item_id} type="button" aria-pressed={isOn} onClick={() => putOn(p)} className={`relative flex-none w-[112px] sm:w-[128px] snap-start rounded-[14px] border p-2 text-left ${isOn ? 'border-[#141414] shadow-[inset_0_0_0_1px_#141414]' : 'border-[#DCDAD4]'}`}>
              <div className="relative h-[120px] sm:h-[140px] overflow-hidden rounded-[9px] bg-white">
                {p.image_url && <img src={p.image_url} alt="" className={`h-full w-full object-contain ${ready ? '' : 'opacity-50'}`} />}
                {!ready && <span className="absolute inset-x-0 bottom-0 bg-[#141414]/80 py-1 text-center text-[11px] tracking-[0.12em] uppercase text-white">{failed ? 'Didn’t come out' : 'Shooting'}</span>}
                {isOn && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[#141414] text-[12px] text-white">✓</span>}
              </div>
              <p className="mt-2 line-clamp-2 text-[13px] leading-[1.25] text-[#141414]">{p.name}</p>
              {p.brand && <p className="mt-0.5 truncate text-[11px] tracking-[0.1em] uppercase text-[#7C838B]">{p.brand}</p>}
            </button>
          )
        })}
        {!shelfPieces.length && <p className="py-4 text-[15px] text-[#7C838B]">Nothing on this shelf yet.</p>}
      </div>

      {/* ways for the piece on show, and a second go when a shot came out wrong */}
      <div className="flex min-h-[36px] flex-wrap items-center gap-2">
        {wayPiece && (
          <>
            <span className={EYEBROW}>Ways</span>
            {waysFor(wayPiece).map((w) => {
              const ready = !!readyLayer(wayPiece, w.way_key)
              const asked = on[wayPiece.item_id] === w.way_key
              const cur = ready && effectiveWay(wayPiece, on[wayPiece.item_id]) === w.way_key
              const waiting = !ready && (asked || requested.has(`${wayPiece.item_id}|${w.way_key}`))
              return (
                <button key={w.way_key} type="button" aria-pressed={cur} title={ready ? undefined : 'Not shot yet · tap to shoot it now'} onClick={() => pickWay(wayPiece, w.way_key)} className={`${PILL} !px-3 !py-1.5 !text-[12px] ${cur ? PILL_ON : PILL_OFF} ${ready || waiting ? '' : 'border-dashed text-[#7C838B]'}`}>
                  {w.label}{waiting ? ' · shooting' : ''}
                </button>
              )
            })}
          </>
        )}
        {shownPiece && (
          <button type="button" onClick={() => reshoot(shownPiece)} disabled={requested.has(`${shownPiece.item_id}|*`)} className="ml-auto text-[13px] tracking-[0.1em] uppercase text-[#7C838B] underline underline-offset-4 disabled:no-underline disabled:opacity-60">
            {requested.has(`${shownPiece.item_id}|*`) ? 'Shooting again' : 'Shoot again'}
          </button>
        )}
      </div>

      {/* the bar */}
      <div className="flex gap-3">
        <button type="button" onClick={() => { setOn({}); setChosen(new Set()); setShowFinish(null) }} className={`${PILL} flex-1 border-[#141414] py-3`}>Undress</button>
        <button type="button" onClick={finish} disabled={!!finishing || !worn.some((w) => w.layer)} className={`${PILL} ${PILL_ON} flex-1 py-3`}>Finish the look</button>
      </div>
      </div>
      </div>

      {/* her finished looks */}
      {view.looks.some((l) => l.finish_url) && (
        <section className="space-y-3 pt-4">
          <p className={EYEBROW}>Your looks</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {view.looks.filter((l) => l.finish_url).map((l) => (
              <article key={l.look_id} className="overflow-hidden rounded-[16px] border border-[#DCDAD4] bg-white">
                <img src={l.finish_url!} alt="" className="w-full object-cover" style={{ aspectRatio: '2 / 3', background: STAGE }} />
                <div className="space-y-2 p-3">
                  <p className="text-[13px] text-[#7C838B]">{l.items.length} pieces · {new Date(l.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => wear(l.items)} className={`${PILL} ${PILL_ON} flex-1 !px-3 !py-2 !text-[12px]`}>Wear it</button>
                    <button type="button" onClick={() => start(async () => { await deleteMyLook(l.look_id); await refresh() })} className={`${PILL} ${PILL_OFF} !px-3 !py-2 !text-[12px]`} aria-label="Delete look">×</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {onDelete && (
        <p className="pt-6 text-[14px] text-[#7C838B]">
          <button type="button" className="underline underline-offset-4" onClick={onDelete}>Delete my avatar</button> · removes the avatar and every picture made from it.
        </p>
      )}
    </div>
  )
}

function Dock({ side, items, waysByKey, takeOff }: {
  side: 'left' | 'right'
  items: { piece: RoomPiece; way: string; layer: RoomPiece['layers'][number] | null }[]
  waysByKey: Map<string, { label: string }>
  takeOff: (id: string) => void
}) {
  return (
    <div className={`absolute top-10 bottom-3 z-20 flex flex-col gap-6 ${side === 'left' ? 'left-2' : 'right-2'}`}>
      {items.map((w) => (
        <div key={w.piece.item_id} className="relative h-[76px] w-[62px] rounded-[12px] bg-white shadow-[0_6px_18px_rgba(0,0,0,0.18)]">
          {w.piece.image_url && <img src={w.piece.image_url} alt={w.piece.name} className="h-full w-full rounded-[12px] object-contain" />}
          <button type="button" onClick={() => takeOff(w.piece.item_id)} aria-label={`Take off ${w.piece.name}`} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[#141414] text-[12px] leading-none text-white">×</button>
          <span className="absolute -bottom-4 left-[-6px] right-[-6px] whitespace-nowrap text-center text-[10px] tracking-[0.1em] uppercase text-[#141414]">{w.layer ? waysByKey.get(w.way)?.label ?? '' : 'shooting'}</span>
        </div>
      ))}
    </div>
  )
}
