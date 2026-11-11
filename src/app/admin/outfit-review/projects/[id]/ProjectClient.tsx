'use client'

// ONE PROJECT — the looks MYRA composed for a brief, kept for picking.
//
// Looks are grouped by anchor (or by way, for THREE WAYS). A project built in
// the style of a look shows the picture and how MYRA read it on top, and each
// anchor says whether it is CLOSEST TO THE PICTURE or IN THIS STYLE. Each look is the
// Review card: anchor + additions with prices and stock, coherence and
// confidence, the statement and echo. SWAP, ADD and REMOVE on every piece
// with UNDO, as every outfit-creating view has; PICK makes the draft outfit
// and queues its Higgsfield shoot (the drain runs it, the card shows the shot
// when it lands); SKIP teaches the Style Brain and can be undone.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { thumbUrl } from '@/lib/image-utils'
import { PICKER_COLOURS, PICKER_TYPES } from '@/components/admin/ItemPickerModal'
import type { ReviewItem } from '@/app/admin/outfit-review/actions'
import type { ReviewProject, ReviewProjectLook, ProjectAnchor } from '@/lib/review-projects'

const SLOT_LABEL: Record<string, string> = {
  outerwear: 'OUTERWEAR', top: 'TOP', bottom: 'BOTTOM', dress: 'DRESS',
  shoe: 'SHOES', bag: 'BAG', jewellery: 'JEWELLERY', accessory: 'ACCESSORY',
}
const CHIP = 'px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full border transition-colors disabled:opacity-50'
const CHIP_ON = 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
const CHIP_OFF = 'text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]'

type Filter = 'pending' | 'picked' | 'skipped' | 'all'
type SwapTarget = { look: ReviewProjectLook; itemIdx: number; slot: string; mode: 'swap' | 'add' }

async function fetchOptions(params: { mode: 'swap' | 'add'; anchor: string; slot?: string; present?: string[]; exclude: string[]; q: string; brand?: string; colour?: string; itemType?: string }) {
  const sp = new URLSearchParams()
  sp.set('mode', params.mode); sp.set('anchor', params.anchor); sp.set('q', params.q); sp.set('exclude', params.exclude.join(','))
  if (params.slot) sp.set('slot', params.slot)
  if (params.present) sp.set('present', params.present.join(','))
  if (params.brand) sp.set('brand', params.brand)
  if (params.colour) sp.set('colour', params.colour)
  if (params.itemType) sp.set('type', params.itemType)
  try {
    const r = await fetch(`/api/admin/review-options?${sp.toString()}`, { cache: 'no-store' })
    if (!r.ok) return { options: [] as ReviewItem[], brands: [] as { name: string; count: number }[] }
    return (await r.json()) as { options: ReviewItem[]; brands?: { name: string; count: number }[] }
  } catch { return { options: [] as ReviewItem[], brands: [] } }
}

function StockTag({ item }: { item: { stock_status?: string | null; stock_sizes?: string[] | null } }) {
  const sizes = item.stock_sizes ?? []
  const out = item.stock_status === 'out_of_stock'
  const low = item.stock_status === 'low_stock'
  const text = sizes.length ? sizes.join('·') : out ? 'OUT OF STOCK' : low ? 'LOW STOCK' : item.stock_status === 'in_stock' ? 'IN STOCK' : ''
  if (!text) return null
  return <p className={`text-[7px] tracking-[0.06em] truncate ${out ? 'text-[#B83A3A]' : low ? 'text-[#7C838B]' : 'text-[#3D7A50]'}`}>{text}</p>
}

function statusLine(p: ReviewProject): string {
  switch (p.status) {
    case 'queued': return 'QUEUED — STARTS IN A MOMENT'
    case 'running': return p.anchors_total === 0 ? (p.kind === 'inspiration' ? 'FINDING PIECES IN THIS STYLE…' : p.anchor_item_id ? 'STYLING YOUR PIECE…' : 'READING THE BRIEF AND THE LIBRARY…') : `STYLING ANCHOR ${Math.min(p.anchors_tried + 1, p.anchors_total)} OF ${p.anchors_total}`
    case 'paused': return `PAUSED AT ${p.anchors_tried} OF ${p.anchors_total || p.target_anchors}`
    case 'failed': return (p.error ?? 'FAILED').toUpperCase()
    default: return p.error ? p.error.toUpperCase() : `DONE · ${p.anchors_total} ANCHOR${p.anchors_total === 1 ? '' : 'S'}`
  }
}

export default function ProjectClient({ initialProject, initialLooks }: { initialProject: ReviewProject; initialLooks: ReviewProjectLook[] }) {
  const [project, setProject] = useState(initialProject)
  const [looks, setLooks] = useState(initialLooks)
  const [filter, setFilter] = useState<Filter>('pending')
  const [busy, setBusy] = useState<Record<string, string>>({}) // look_id → what is happening
  const [history, setHistory] = useState<Record<string, ReviewItem[][]>>({}) // undo stacks
  const [error, setError] = useState<string | null>(null)
  // Swap / add picker
  const [swap, setSwap] = useState<SwapTarget | null>(null)
  const [opts, setOpts] = useState<ReviewItem[]>([])
  const [optBrands, setOptBrands] = useState<{ name: string; count: number }[]>([])
  const [q, setQ] = useState(''); const [brand, setBrand] = useState(''); const [colour, setColour] = useState(''); const [type, setType] = useState('')
  const [optsLoading, setOptsLoading] = useState(false)
  const pollRef = useRef(0)
  const optReqRef = useRef(0)   // only the latest search's answer is shown
  const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/review-projects/${project.project_id}`, { cache: 'no-store' })
      const j = await r.json()
      if (j.project) { setProject(j.project); setLooks(j.looks ?? []) }
    } catch { /* next poll */ }
  }, [project.project_id])

  const live = project.status === 'queued' || project.status === 'running' || looks.some((l) => l.shoot_status === 'queued' || l.shoot_status === 'running')
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => { pollRef.current++; void refresh() }, 3_000)
    return () => clearInterval(t)
  }, [live, refresh])

  async function post(body: Record<string, unknown>): Promise<any> {
    const r = await fetch(`/api/admin/review-projects/${project.project_id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return r.json()
  }
  function patchLook(next: ReviewProjectLook) { setLooks((ls) => ls.map((l) => (l.look_id === next.look_id ? next : l))) }

  async function lookAction(look: ReviewProjectLook, action: 'pick' | 'skip' | 'restore' | 'reshoot') {
    setBusy((b) => ({ ...b, [look.look_id]: action }))
    setError(null)
    const j = await post({ action, lookId: look.look_id })
    setBusy((b) => { const n = { ...b }; delete n[look.look_id]; return n })
    if (j?.error) { setError(j.error); return }
    if (j?.look) patchLook(j.look)
    else void refresh()
  }

  async function saveItems(look: ReviewProjectLook, items: ReviewItem[], remember = true) {
    if (remember) setHistory((h) => ({ ...h, [look.look_id]: [...(h[look.look_id] ?? []), look.items] }))
    patchLook({ ...look, items })
    const j = await post({ action: 'edit', lookId: look.look_id, items })
    if (j?.error) { setError(j.error); patchLook(look); return }
    if (j?.look) patchLook(j.look)
  }
  function undo(look: ReviewProjectLook) {
    const stack = history[look.look_id] ?? []
    if (!stack.length) return
    const prev = stack[stack.length - 1]
    setHistory((h) => ({ ...h, [look.look_id]: stack.slice(0, -1) }))
    void saveItems(look, prev, false)
  }
  function remove(look: ReviewProjectLook, idx: number) {
    const items = look.items.filter((_, i) => i !== idx)
    if (items.length === 0) { setError('A look needs at least one piece beside the anchor'); return }
    void saveItems(look, items)
  }

  async function openPicker(target: SwapTarget) {
    setSwap(target); setQ(''); setBrand(''); setColour(''); setType(''); setOptsLoading(true)
    const res = await runOptions(target, '', '', '', '')
    setOpts(res.options); setOptBrands(res.brands ?? []); setOptsLoading(false)
  }
  function runOptions(target: SwapTarget, q: string, brand: string, colour: string, itemType: string) {
    const exclude = [target.look.anchor_item_id, ...target.look.items.map((i) => i.item_id)]
    return target.mode === 'add'
      ? fetchOptions({ mode: 'add', anchor: target.look.anchor_item_id, present: target.look.items.map((i) => i.slot), exclude, q, brand, colour, itemType })
      : fetchOptions({ mode: 'swap', anchor: target.look.anchor_item_id, slot: target.slot, exclude, q, brand, colour, itemType })
  }
  async function research(next: { q?: string; brand?: string; colour?: string; type?: string }) {
    if (!swap) return
    const nq = next.q ?? q, nb = next.brand ?? brand, nc = next.colour ?? colour, nt = next.type ?? type
    setQ(nq); setBrand(nb); setColour(nc); setType(nt); setOptsLoading(true)
    const go = async () => {
      const id = ++optReqRef.current
      const res = await runOptions(swap, nq, nb, nc, nt)
      if (id !== optReqRef.current) return // a newer search has taken over
      setOpts(res.options); setOptBrands(res.brands ?? []); setOptsLoading(false)
    }
    // Typing waits for a pause (250ms); a chip answers at once.
    if (typingRef.current) clearTimeout(typingRef.current)
    if (next.q !== undefined) typingRef.current = setTimeout(() => { void go() }, 250)
    else void go()
  }
  function choose(opt: ReviewItem) {
    if (!swap) return
    const items = swap.mode === 'add' ? [...swap.look.items, opt] : swap.look.items.map((it, i) => (i === swap.itemIdx ? opt : it))
    setSwap(null)
    void saveItems(swap.look, items)
  }

  const counts = { pending: 0, picked: 0, skipped: 0 }
  for (const l of looks) counts[l.decision]++
  const shown = looks.filter((l) => filter === 'all' || l.decision === filter)

  // Groups: by anchor (looks kind), by way then anchor (three ways reads better per anchor too) — one group per anchor.
  const groups: { key: string; anchor: ProjectAnchor; looks: ReviewProjectLook[] }[] = []
  for (const l of shown) {
    let g = groups.find((x) => x.key === l.anchor_item_id)
    if (!g) { g = { key: l.anchor_item_id, anchor: l.anchor, looks: [] }; groups.push(g) }
    g.looks.push(l)
  }
  const draftHref = (l: ReviewProjectLook) => (project.admin_project_id && l.outfit_id ? `/admin/projects/${project.admin_project_id}/outfits/${l.outfit_id}/edit` : null)

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/outfit-review" className="text-[9px] tracking-[0.18em] text-[#A8A8A4] hover:text-[#0A0A0A]">← OUTFIT REVIEW</Link>
        <div className="flex flex-wrap items-end justify-between gap-4 mt-2">
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-1">PROJECT · {project.kind === 'inspiration' ? 'OUTFITS IN THE STYLE OF A LOOK' : project.kind === 'three_ways' ? 'THREE WAYS TO WEAR IT' : 'LOOKS'}</p>
            <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">{project.title.toUpperCase()}</h1>
            {project.brief && <p className="text-[10px] tracking-[0.08em] text-[#A8A8A4] mt-1">“{project.brief.toUpperCase()}”</p>}
            {project.notes.map((n, i) => <p key={i} className="text-[8px] tracking-[0.08em] text-[#7C838B] mt-1">▲ {n.toUpperCase()}</p>)}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {(project.status === 'queued' || project.status === 'running') && (
              <button onClick={async () => { await post({ action: 'pause' }); void refresh() }} className={`${CHIP} ${CHIP_OFF}`}>PAUSE</button>
            )}
            {(project.status === 'paused' || project.status === 'failed') && (
              <button onClick={async () => { await post({ action: 'resume' }); void refresh() }} className={`${CHIP} ${CHIP_ON}`}>RESUME</button>
            )}
            {project.admin_project_id && (
              <Link href={`/admin/projects/${project.admin_project_id}`} className={`${CHIP} ${CHIP_OFF}`}>OPEN OUTFIT PROJECT →</Link>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          {live && <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-6 w-auto" />}
          <p className={`text-[10px] tracking-[0.14em] ${project.status === 'failed' ? 'text-[#B83A3A]' : 'text-[#4A4E57]'}`}>
            {statusLine(project)} <span className="text-[#A8A8A4]">· {looks.length} LOOK{looks.length === 1 ? '' : 'S'}</span>
          </p>
          {project.status === 'running' && project.anchors_total > 0 && (
            <div className="flex-1 max-w-[240px] h-[2px] bg-[#F2F2F0] rounded-full overflow-hidden">
              <div className="h-full bg-[#0A0A0A] transition-all" style={{ width: `${Math.round((project.anchors_tried / project.anchors_total) * 100)}%` }} />
            </div>
          )}
        </div>
        {error && <p className="mt-2 text-[9px] tracking-[0.12em] text-[#B83A3A]">{error.toUpperCase()}</p>}
      </div>

      {project.inspiration && (
        <div className="flex gap-5 border border-[#E2E0DB] bg-[#FAFAF8] rounded-[14px] p-4">
          <a href={project.inspiration.image_url} target="_blank" rel="noreferrer" className="w-[150px] flex-shrink-0 rounded-[10px] overflow-hidden bg-[#F2F2F0] self-start" title="Open the picture">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbUrl(project.inspiration.image_url, 600)} alt="The look this project is in the style of" className="w-full h-auto block" />
          </a>
          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-[9px] tracking-[0.18em] text-[#A8A8A4] mb-1">THE LOOK{project.inspiration.palette ? ` · ${project.inspiration.palette.toUpperCase()} PALETTE` : ''}</p>
              <p className="text-[12px] tracking-[0.03em] leading-relaxed text-[#4A4E57]">{project.inspiration.summary}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {project.inspiration.pieces.map((p, i) => (
                <span key={i} className="px-2.5 py-1 text-[9px] tracking-[0.08em] rounded-full border border-[#E2E0DB] bg-white text-[#4A4E57]">
                  {[p.colour, p.cloth, ...p.detail.slice(0, 2), p.length, p.type].filter(Boolean).join(' ').toUpperCase()}
                </span>
              ))}
            </div>
            <div className="space-y-1">
              <p className="text-[9px] tracking-[0.08em] text-[#7C838B]"><span className="tracking-[0.16em] text-[#4A4E57]">CLOSEST TO THE PICTURE</span> · {project.inspiration.close_ask.toUpperCase()}</p>
              <p className="text-[9px] tracking-[0.08em] text-[#7C838B]"><span className="tracking-[0.16em] text-[#4A4E57]">IN THIS STYLE</span> · {project.inspiration.style_ask.toUpperCase()}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(['pending', 'picked', 'skipped', 'all'] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`${CHIP} ${filter === f ? CHIP_ON : CHIP_OFF}`}>
            {f === 'pending' ? 'TO REVIEW' : f.toUpperCase()} <span className="opacity-50">{f === 'all' ? looks.length : counts[f]}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="text-[11px] tracking-[0.1em] text-[#A8A8A4] py-16 text-center">
          {live && looks.length === 0 ? 'MYRA IS COMPOSING — THE FIRST LOOKS LAND IN A MOMENT.' : filter === 'pending' && looks.length ? 'EVERY LOOK HERE HAS BEEN PICKED OR SKIPPED.' : 'NO LOOKS YET.'}
        </p>
      )}

      <div className="space-y-10">
        {groups.map((g, gi) => (
          <div key={g.key} className="border border-[#E2E0DB] bg-white rounded-[14px] overflow-hidden">
            <div className="flex items-center gap-4 p-4 border-b border-[#E2E0DB] bg-[#FAFAF8]">
              <div className="w-16 h-20 flex-shrink-0 rounded-[8px] overflow-hidden bg-[#F2F2F0]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbUrl(g.anchor.image_url, 600)} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] tracking-[0.18em] text-[#A8A8A4] mb-0.5">ANCHOR {String(gi + 1).padStart(2, '0')} · {g.anchor.item_type.replace(/_/g, ' ').toUpperCase()}{project.kind === 'inspiration' && g.looks[0]?.way_label ? <span className="text-[#4A4E57]"> · {g.looks[0].way_label}</span> : null}</p>
                <p className="text-[10px] tracking-[0.10em] text-[#6B6B6B]">{(g.anchor.brand_name ?? '').toUpperCase()}</p>
                <p className="text-[13px] tracking-[0.04em] text-[#4A4E57] truncate">{g.anchor.product_name.toUpperCase()}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {g.anchor.price && <p className="text-[10px] tracking-[0.06em] text-[#6B6B6B]">{g.anchor.price}</p>}
                  <StockTag item={g.anchor} />
                </div>
              </div>
              <p className="text-[9px] tracking-[0.14em] text-[#A8A8A4] flex-shrink-0">{g.looks.length} LOOK{g.looks.length === 1 ? '' : 'S'}</p>
            </div>

            <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {g.looks.map((l, idx) => {
                const b = busy[l.look_id]
                const editable = l.decision === 'pending'
                const canUndo = (history[l.look_id]?.length ?? 0) > 0
                const href = draftHref(l)
                return (
                  <div key={l.look_id} className={`border border-[#E2E0DB] rounded-[10px] p-3 ${l.decision === 'skipped' ? 'opacity-50' : ''}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-[9px] tracking-[0.16em] text-[#6B6B6B] truncate">{l.way_label && project.kind !== 'inspiration' ? `WAY · ${l.way_label}` : `POTENTIAL OUTFIT ${String(idx + 1).padStart(2, '0')}`}</p>
                        {l.lane === 'fast' && <span className="bg-[#3D7A50] text-white text-[7px] tracking-[0.12em] px-1.5 py-0.5 rounded flex-shrink-0">FAST LANE</span>}
                      </div>
                      <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4] flex-shrink-0">
                        {l.score != null && <>COHERENCE {(l.score * 100).toFixed(0)}</>}
                        {l.confidence != null && <> · CONFIDENCE {(l.confidence * 100).toFixed(0)}</>}
                      </p>
                    </div>
                    {(l.statement || l.echoes.length > 0) && (
                      <p className="mb-1.5 text-[8px] tracking-[0.06em] text-[#A8A8A4] leading-relaxed">
                        {l.statement && <span className="text-[#4A4E57]">STATEMENT: {l.statement.toUpperCase()}</span>}
                        {l.statement && l.echoes.length > 0 && ' · '}
                        {l.echoes.length > 0 && <span>ECHO: {l.echoes[0].toUpperCase()}</span>}
                      </p>
                    )}
                    {l.reasons.length > 0 && (
                      <ul className="mb-2 space-y-0.5">
                        {l.reasons.slice(0, 3).map((r, ri) => <li key={ri} className="text-[8px] tracking-[0.06em] text-[#7C838B] leading-relaxed">▲ {r.toUpperCase()}</li>)}
                      </ul>
                    )}

                    <div className="grid grid-cols-4 gap-1.5 mb-3">
                      <div className="relative">
                        <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={thumbUrl(l.anchor.image_url, 600)} alt="" className="w-full h-full object-cover" />
                        </div>
                        <span className="absolute top-1 left-1 bg-[#0A0A0A] text-white text-[7px] tracking-[0.10em] px-1 py-0.5 rounded">ANCHOR</span>
                        {l.anchor.price && <p className="text-[7px] tracking-[0.04em] text-[#4A4E57] mt-0.5">{l.anchor.price}</p>}
                      </div>
                      {l.items.map((item, itemIdx) => (
                        <div key={`${item.item_id}-${itemIdx}`} className="relative group">
                          <div className={`aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0] ${item.stock_status === 'out_of_stock' ? 'ring-1 ring-[#E8B4B4]' : ''}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={thumbUrl(item.image_url, 600)} alt="" className="w-full h-full object-cover" />
                            {editable && (
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/45 flex flex-col items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => openPicker({ look: l, itemIdx, slot: item.slot, mode: 'swap' })} className="bg-white text-[#0A0A0A] text-[8px] tracking-[0.12em] px-2 py-1 rounded">SWAP</button>
                                <button onClick={() => remove(l, itemIdx)} className="bg-white/90 text-[#B83A3A] text-[8px] tracking-[0.12em] px-2 py-1 rounded">REMOVE</button>
                              </div>
                            )}
                          </div>
                          <p className="text-[7px] tracking-[0.10em] text-[#A8A8A4] mt-0.5 truncate">{SLOT_LABEL[item.slot] ?? item.slot}</p>
                          <p className="text-[7px] tracking-[0.06em] text-[#6B6B6B] truncate">{(item.brand_name ?? '').toUpperCase()}</p>
                          {item.price && <p className="text-[7px] tracking-[0.04em] text-[#4A4E57]">{item.price}</p>}
                          <StockTag item={item} />
                        </div>
                      ))}
                      {editable && (
                        <button onClick={() => openPicker({ look: l, itemIdx: -1, slot: '', mode: 'add' })} className="aspect-[3/4] rounded-[6px] border border-dashed border-[#C9C7C2] flex flex-col items-center justify-center text-[#A8A8A4] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors">
                          <span className="text-[18px] leading-none">+</span>
                          <span className="text-[7px] tracking-[0.12em] mt-1">ADD ITEM</span>
                        </button>
                      )}
                    </div>

                    {l.decision === 'picked' ? (
                      <div>
                        <div className="flex items-center gap-3">
                          {l.shoot_url ? (
                            <a href={l.shoot_url} target="_blank" rel="noreferrer" className="w-14 h-[74px] flex-shrink-0 rounded-[6px] overflow-hidden bg-[#F2F2F0] border border-[#E2E0DB]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={thumbUrl(l.shoot_url, 400)} alt="" className="w-full h-full object-cover" />
                            </a>
                          ) : (l.shoot_status === 'queued' || l.shoot_status === 'running') ? (
                            <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-10 w-auto flex-shrink-0" />
                          ) : null}
                          <div className="flex-1 min-w-0">
                            {href ? (
                              <a href={href} className="block text-center bg-[#0A0A0A] text-white py-2.5 text-[10px] tracking-[0.16em] rounded-full hover:opacity-85">✓ PICKED → EDIT DRAFT</a>
                            ) : (
                              <p className="text-center text-[10px] tracking-[0.16em] text-[#4A4E57] py-2.5">✓ PICKED</p>
                            )}
                            <p className={`mt-2 text-[8px] tracking-[0.10em] leading-relaxed ${l.shoot_status === 'failed' ? 'text-[#B83A3A]' : l.shoot_status === 'done' ? 'text-[#3D7A50]' : 'text-[#7C838B]'}`}>
                              {l.shoot_status === 'queued' && '✦ HIGGSFIELD SHOOT QUEUED — YOU CAN LEAVE THIS PAGE.'}
                              {l.shoot_status === 'running' && '✦ HIGGSFIELD IS SHOOTING (~30–90S)…'}
                              {l.shoot_status === 'done' && '✓ SHOT — SET AS THE DRAFT’S DISPLAY IMAGE.'}
                              {l.shoot_status === 'failed' && `✕ ${l.shoot_url ? 'MYRA’S CHECK REFUSED THIS TAKE — JUDGE IT YOURSELF' : 'SHOOT FAILED'}${l.shoot_error ? ` — ${l.shoot_error.slice(0, 110).toUpperCase()}` : ''}`}
                            </p>
                            {(l.shoot_status === 'failed' || l.shoot_status === 'done') && (
                              <button onClick={() => lookAction(l, 'reshoot')} disabled={!!b} className="mt-1 text-[8px] tracking-[0.12em] text-[#6B6B6B] hover:text-[#0A0A0A] disabled:opacity-40">
                                {l.shoot_status === 'done' ? 'ANOTHER TAKE' : 'SHOOT AGAIN'} →
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : l.decision === 'skipped' ? (
                      <button onClick={() => lookAction(l, 'restore')} disabled={!!b} className="w-full py-2.5 text-[10px] tracking-[0.14em] border border-[#E2E0DB] text-[#6B6B6B] rounded-full hover:border-[#0A0A0A] disabled:opacity-50">
                        SKIPPED · UNDO
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button onClick={() => lookAction(l, 'pick')} disabled={!!b} className="flex-1 bg-[#0A0A0A] text-white py-2.5 text-[10px] tracking-[0.18em] rounded-full hover:opacity-85 transition-opacity disabled:opacity-50">
                          {b === 'pick' ? 'MAKING THE DRAFT…' : 'PICK → HIGGSFIELD ✓'}
                        </button>
                        {canUndo && (
                          <button onClick={() => undo(l)} className="px-4 py-2.5 text-[10px] tracking-[0.14em] border border-[#E2E0DB] text-[#6B6B6B] rounded-full hover:border-[#0A0A0A]">UNDO</button>
                        )}
                        <button onClick={() => lookAction(l, 'skip')} disabled={!!b} className="px-4 py-2.5 text-[10px] tracking-[0.14em] border border-[#E2E0DB] text-[#6B6B6B] rounded-full hover:border-[#0A0A0A] transition-colors disabled:opacity-50">
                          SKIP
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {swap && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16 px-4" onClick={() => setSwap(null)}>
          <div data-lenis-prevent className="bg-white border border-[#E2E0DB] rounded-[12px] w-full max-w-3xl max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-[#E2E0DB]">
              <p className="text-[10px] tracking-[0.16em] text-[#6B6B6B]">{swap.mode === 'add' ? 'ADD ITEM' : `SWAP · ${SLOT_LABEL[swap.slot] ?? swap.slot}`}</p>
              <button onClick={() => setSwap(null)} className="text-[#A8A8A4] hover:text-[#0A0A0A] text-[18px] leading-none">×</button>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
              <input value={q} onChange={(e) => research({ q: e.target.value })} placeholder="SEARCH ANY ITEM BY NAME, BRAND OR TYPE…"
                className="flex-1 border border-[#E2E0DB] rounded-[10px] px-4 py-2.5 text-[11px] tracking-[0.08em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A]" />
              <select value={brand} onChange={(e) => research({ brand: e.target.value })} className="sm:w-[200px] border border-[#E2E0DB] rounded-[10px] px-3 py-2.5 text-[11px] tracking-[0.08em] text-[#4A4E57] bg-white focus:outline-none focus:border-[#0A0A0A]">
                <option value="">ALL BRANDS</option>
                {optBrands.map((b) => <option key={b.name} value={b.name}>{b.name.toUpperCase()} ({b.count})</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {PICKER_COLOURS.map((c) => (
                <button key={c.value} onClick={() => research({ colour: colour === c.value ? '' : c.value })} className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[8px] tracking-[0.08em] rounded-full border transition-colors ${colour === c.value ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white' : 'border-[#E2E0DB] text-[#4A4E57] hover:border-[#0A0A0A]'}`}>
                  <span className="w-2.5 h-2.5 rounded-full border border-[#E2E0DB]" style={{ background: c.swatch }} />{c.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {PICKER_TYPES.map((t) => (
                <button key={t.value} onClick={() => research({ type: type === t.value ? '' : t.value })} className={`px-2.5 py-1.5 text-[8px] tracking-[0.08em] rounded-full border transition-colors ${type === t.value ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white' : 'border-[#E2E0DB] text-[#4A4E57] hover:border-[#0A0A0A]'}`}>{t.label}</button>
              ))}
            </div>
            {optsLoading ? (
              <p className="text-[10px] tracking-[0.16em] text-[#A8A8A4] py-8 text-center">LOADING…</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {opts.map((opt) => (
                  <button key={opt.item_id} onClick={() => choose(opt)} className="group text-left">
                    <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbUrl(opt.image_url, 600)} alt="" className="w-full h-full object-cover group-hover:opacity-90" />
                    </div>
                    <p className="text-[8px] tracking-[0.08em] text-[#6B6B6B] mt-1 truncate">{(opt.brand_name ?? '').toUpperCase()}</p>
                    <p className="text-[9px] tracking-[0.04em] text-[#4A4E57] truncate">{opt.product_name}</p>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[8px] tracking-[0.06em] text-[#4A4E57]">{opt.price}</span>
                      <span className="text-[8px] tracking-[0.06em] text-[#A8A8A4]">{(opt.compat * 100).toFixed(0)}</span>
                    </div>
                  </button>
                ))}
                {opts.length === 0 && <p className="col-span-full text-[10px] tracking-[0.14em] text-[#A8A8A4] py-6 text-center">NO MATCHES.</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
