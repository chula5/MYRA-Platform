'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ITEM_TYPES, COLOUR_FAMILIES } from '@/lib/wardrobe/detect'
import { SCORED_DIMS } from '@/lib/wardrobe/approve'
import { fmtUsd } from '@/lib/wardrobe/cost'
import type { WardrobeExtraction, ExtractionEdits } from '@/lib/wardrobe/types'
import {
  drainWardrobeQueue, linkMemberLogin, removeOwnedItem, removePhoto, retryFailedJobs, reviewApprove, reviewDiscard,
  reviewRegenerate, reviewRescore, reviewSaveEdits, startBatch, unlinkMemberLogin, unlockPurchases, updateOwned,
  uploadWardrobePhoto, type MemberWardrobe, type OwnedItemView, type UnlockRow, type WardrobeData,
} from './actions'

const label = 'text-[9px] tracking-[0.18em] text-[#6B6B6B]'
const btnTiny = 'text-[9px] tracking-[0.12em] px-2.5 py-1 border border-[#E2E0DB] text-[#4A4E57] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors disabled:opacity-40'
const btnGold = 'text-[9px] tracking-[0.12em] px-3 py-1.5 bg-[#C4A882] text-white hover:opacity-85 disabled:opacity-40'
const btnDark = 'text-[9px] tracking-[0.12em] px-3 py-1.5 bg-[#0A0A0A] text-white hover:opacity-85 disabled:opacity-40'
const input = 'w-full border border-[#E2E0DB] px-2 py-1.5 text-[10px] tracking-[0.04em] text-[#0A0A0A] bg-white focus:outline-none focus:border-[#0A0A0A]'

const TABS = ['REVIEW', 'WARDROBE', 'UPLOAD', 'PHOTOS & COST', 'WHAT TO BUY'] as const
type Tab = (typeof TABS)[number]

const SLOT_LABEL: Record<string, string> = { outerwear: 'OUTERWEAR', top: 'TOPS', bottom: 'BOTTOMS', dress: 'DRESSES', shoe: 'SHOES', bag: 'BAGS', jewellery: 'JEWELLERY', accessory: 'ACCESSORIES' }
const STATUS_LABEL: Record<string, string> = {
  detected: 'FOUND', cutout_queued: 'CUTOUT QUEUED', cutout_running: 'CUTTING OUT…', scoring: 'SCORING…',
  review: 'READY TO REVIEW', approved: 'APPROVED', discarded: 'DISCARDED', failed: 'FAILED',
}
const OCCASIONS: { id: string; label: string }[] = [
  { id: '', label: 'ANY OCCASION' },
  { id: 'work_standard', label: 'WORK' }, { id: 'work_elevated', label: 'WORK — ELEVATED' }, { id: 'casual_day', label: 'CASUAL DAY' },
  { id: 'dinner_drinks', label: 'DINNER / DRINKS' }, { id: 'event', label: 'EVENT' }, { id: 'travel', label: 'TRAVEL' },
]

type Run = (key: string, fn: () => Promise<any>, ok?: string) => Promise<any>

export default function WardrobeClient({ data }: { data: WardrobeData }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(data.selected?.queue.length ? 'REVIEW' : 'UPLOAD')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)
  const sel = data.selected

  const run: Run = async (key, fn, ok) => {
    setBusy(key)
    setMsg(null)
    try {
      const r = await fn()
      if (r?.error) setMsg({ text: String(r.error).toUpperCase(), tone: 'err' })
      else if (ok) setMsg({ text: ok, tone: 'ok' })
      router.refresh()
      return r
    } finally {
      setBusy(null)
    }
  }

  // Keep the queue moving while anything is pending — locally there is no cron,
  // and on Vercel this shortens the wait between the 5-minute ticks.
  const pending = (sel?.jobs.queued ?? 0) + (sel?.jobs.running ?? 0)
  const draining = useRef(false)
  useEffect(() => {
    if (!sel || pending === 0 || !data.openAiConfigured) return
    let alive = true
    const tick = async () => {
      if (draining.current || !alive) return
      draining.current = true
      try { await drainWardrobeQueue(40_000) } finally { draining.current = false }
      if (alive) router.refresh()
    }
    void tick()
    const id = setInterval(tick, 12_000)
    return () => { alive = false; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.member.member_id, pending, data.openAiConfigured])

  return (
    <div className="space-y-6">
      {!data.ready && (
        <div className="border border-[#B83A3A] bg-[#FDF4F4] px-4 py-3 text-[10px] tracking-[0.1em] text-[#B83A3A]">
          MIGRATION 0046_wardrobe_import.sql HAS NOT BEEN RUN — RUN IT IN THE SUPABASE SQL EDITOR, THEN RELOAD.
        </div>
      )}
      {data.ready && !data.openAiConfigured && (
        <div className="border border-[#C4A882] bg-[#FBF8F2] px-4 py-3 text-[10px] tracking-[0.1em] text-[#8B5E00]">
          OPENAI_API_KEY IS NOT SET — PHOTOS WILL UPLOAD AND QUEUE, BUT NOTHING IS DETECTED OR CUT OUT UNTIL IT IS. (VISION {data.models.vision.toUpperCase()} · IMAGES {data.models.image.toUpperCase()} · {data.models.quality.toUpperCase()})
        </div>
      )}

      {/* Member picker */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`${label} mr-2`}>CLIENT</span>
        {data.members.map((m) => (
          <button
            key={m.member_id}
            onClick={() => router.push(`/admin/wardrobe?member=${m.member_id}`)}
            className={`${btnTiny} ${sel?.member.member_id === m.member_id ? '!border-[#0A0A0A] !text-[#0A0A0A]' : ''}`}
          >
            {m.name.toUpperCase()} · {m.owned_count}
            {m.pending_review > 0 && <span className="ml-1.5 text-[#8B5E00]">● {m.pending_review}</span>}
          </button>
        ))}
        {!data.members.length && <span className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">NO PILOT MEMBERS YET — ADD ONE IN PRIVATE STYLIST (ALISON COTTER TO START).</span>}
      </div>

      {msg && (
        <p className={`text-[9px] tracking-[0.12em] ${msg.tone === 'ok' ? 'text-[#3D7A50]' : 'text-[#B83A3A]'}`}>{msg.text}</p>
      )}

      {sel && (
        <>
          {/* Header strip */}
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E2E0DB] pb-4">
            <div>
              <p className="text-[16px] tracking-[0.08em] text-[#0A0A0A]">{sel.member.name.toUpperCase()}</p>
              <p className="text-[9px] tracking-[0.1em] text-[#6B6B6B] mt-1">
                {sel.items.length} OWNED PIECE{sel.items.length === 1 ? '' : 'S'} · {sel.queue.filter((q) => q.status === 'review').length} TO REVIEW · {sel.photos.length} PHOTO{sel.photos.length === 1 ? '' : 'S'} · STYLED INTO {sel.lookCount} LOOK{sel.lookCount === 1 ? '' : 'S'} SO FAR
              </p>
              <QueueStrip sel={sel} run={run} busy={busy} />
            </div>
            <LoginLink sel={sel} run={run} busy={busy} />
          </div>

          <div className="flex gap-1.5 flex-wrap">
            {TABS.map((t) => {
              const n = t === 'REVIEW' ? sel.queue.length : t === 'WARDROBE' ? sel.items.length : t === 'PHOTOS & COST' ? sel.photos.length : null
              return (
                <button key={t} onClick={() => setTab(t)} className={`${btnTiny} ${tab === t ? '!border-[#0A0A0A] !text-[#0A0A0A]' : ''}`}>
                  {t}{n != null ? ` · ${n}` : ''}
                </button>
              )
            })}
          </div>

          {tab === 'UPLOAD' && <UploadPanel sel={sel} run={run} onDone={() => { setTab('REVIEW'); router.refresh() }} />}
          {tab === 'REVIEW' && <ReviewPanel sel={sel} brandNames={data.brandNames} run={run} busy={busy} />}
          {tab === 'WARDROBE' && <WardrobeGrid sel={sel} run={run} busy={busy} brandNames={data.brandNames} />}
          {tab === 'PHOTOS & COST' && <PhotosPanel sel={sel} run={run} busy={busy} />}
          {tab === 'WHAT TO BUY' && <UnlockPanel sel={sel} />}
        </>
      )}
    </div>
  )
}

// ── Queue strip ─────────────────────────────────────────────────────────────

function QueueStrip({ sel, run, busy }: { sel: MemberWardrobe; run: Run; busy: string | null }) {
  const j = sel.jobs
  const pending = j.queued + j.running
  return (
    <div className="mt-2 flex items-center gap-3">
      <p className="text-[9px] tracking-[0.1em] text-[#6B6B6B]">
        QUEUE · {pending > 0 ? `${pending} PENDING (${Object.entries(j.byKind).map(([k, n]) => `${n} ${k.toUpperCase()}`).join(', ')})` : 'IDLE'}
        {j.failed > 0 && <span className="text-[#B83A3A]"> · {j.failed} FAILED</span>}
      </p>
      {pending > 0 && (
        <button className={btnTiny} disabled={busy === 'drain'} onClick={() => run('drain', () => drainWardrobeQueue(60_000), 'QUEUE PROCESSED')}>
          {busy === 'drain' ? 'PROCESSING…' : '▶ PROCESS NOW'}
        </button>
      )}
      {j.failed > 0 && (
        <button className={btnTiny} onClick={() => run('retry', () => retryFailedJobs(sel.member.member_id), 'FAILED JOBS RE-QUEUED')}>
          ↻ RETRY FAILED
        </button>
      )}
    </div>
  )
}

function LoginLink({ sel, run, busy }: { sel: MemberWardrobe; run: Run; busy: string | null }) {
  const [email, setEmail] = useState('')
  return (
    <div className="text-right">
      <p className={label}>HER LOGIN (SELF-SERVE UPLOADS AT /ME/WARDROBE)</p>
      {sel.member.auth_user_id ? (
        <div className="mt-1 flex items-center justify-end gap-2">
          <span className="text-[9px] tracking-[0.08em] text-[#3D7A50]">LINKED ✓</span>
          <button className={btnTiny} onClick={() => run('unlink', () => unlinkMemberLogin(sel.member.member_id), 'UNLINKED')}>UNLINK</button>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <input className={`${input} !w-56`} placeholder="her@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className={btnTiny} disabled={!email || busy === 'link'} onClick={() => run('link', () => linkMemberLogin(sel.member.member_id, email), 'LOGIN LINKED')}>LINK</button>
        </div>
      )}
    </div>
  )
}

// ── Upload ──────────────────────────────────────────────────────────────────

async function collectFiles(items: DataTransferItemList): Promise<File[]> {
  const out: File[] = []
  const walk = async (entry: any): Promise<void> => {
    if (!entry) return
    if (entry.isFile) {
      await new Promise<void>((res) => entry.file((f: File) => { if (f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|avif|tiff?)$/i.test(f.name)) out.push(f); res() }, () => res()))
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      const readAll = async (): Promise<void> => {
        const batch: any[] = await new Promise((res) => reader.readEntries((e: any[]) => res(e), () => res([])))
        if (!batch.length) return
        for (const e of batch) await walk(e)
        await readAll()
      }
      await readAll()
    }
  }
  const entries: any[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const entry = typeof (it as any).webkitGetAsEntry === 'function' ? (it as any).webkitGetAsEntry() : null
    if (entry) entries.push(entry)
    else { const f = it.getAsFile(); if (f) out.push(f) }
  }
  for (const e of entries) await walk(e)
  return out
}

function UploadPanel({ sel, run, onDone }: { sel: MemberWardrobe; run: Run; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [labelText, setLabelText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number; errors: string[] } | null>(null)
  const [over, setOver] = useState(false)

  async function start() {
    if (!files.length) return
    const b = await startBatch(sel.member.member_id, labelText || null)
    if (!b.batchId) { setProgress({ done: 0, total: files.length, errors: [b.error ?? 'Could not start batch'] }); return }
    const errors: string[] = []
    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length, errors })
      const fd = new FormData()
      fd.append('member_id', sel.member.member_id)
      fd.append('batch_id', b.batchId)
      fd.append('file', files[i])
      const r = await uploadWardrobePhoto(fd)
      if (r.error) errors.push(`${files[i].name}: ${r.error}`)
    }
    setProgress({ done: files.length, total: files.length, errors })
    setFiles([])
    if (inputRef.current) inputRef.current.value = ''
    onDone()
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => { e.preventDefault(); setOver(false); const got = await collectFiles(e.dataTransfer.items); setFiles((prev) => [...prev, ...got]) }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed px-6 py-12 text-center cursor-pointer transition-colors ${over ? 'border-[#C4A882] bg-[#FBF8F2]' : 'border-[#D8D5CE] bg-[#FCFCFA]'}`}
      >
        <p className="text-[11px] tracking-[0.16em] text-[#0A0A0A]">DROP A FOLDER OF {sel.member.name.split(' ')[0].toUpperCase()}&rsquo;S PHOTOS HERE</p>
        <p className="text-[9px] tracking-[0.1em] text-[#6B6B6B] mt-2">OR CLICK TO CHOOSE · FULL OUTFITS OR SINGLE PIECES · JPG / PNG / HEIC · UP TO 12MB EACH</p>
        <input ref={inputRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])} />
      </div>
      {files.length > 0 && (
        <div className="border border-[#E2E0DB] px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[10px] tracking-[0.1em] text-[#0A0A0A]">{files.length} PHOTO{files.length === 1 ? '' : 'S'} READY · {(files.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB</p>
            <button className={btnTiny} onClick={() => setFiles([])}>CLEAR</button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <input className={`${input} !w-72`} placeholder="BATCH LABEL (OPTIONAL) — e.g. WARDROBE DAY 1" value={labelText} onChange={(e) => setLabelText(e.target.value)} />
            <button className={btnGold} disabled={!!progress && progress.done < progress.total} onClick={start}>
              {progress && progress.done < progress.total ? `UPLOADING ${progress.done + 1} / ${progress.total}…` : '▲ UPLOAD & START EXTRACTION'}
            </button>
          </div>
          <p className="text-[8px] tracking-[0.08em] text-[#A8A8A4] mt-2">
            ONE JOB AT A TIME: EVERY PHOTO IS DETECTED FIRST, THEN EACH GARMENT IS CUT OUT AND SCORED IN TURN. 12 PHOTOS ≈ 12 DETECTS + ~30 CUTOUTS — EXPECT 10–20 MINUTES; REVIEW STARTS AS PIECES LAND.
          </p>
        </div>
      )}
      {progress && progress.done === progress.total && (
        <div className="text-[9px] tracking-[0.1em]">
          <p className="text-[#3D7A50]">{progress.total - progress.errors.length} UPLOADED · QUEUED FOR DETECTION</p>
          {progress.errors.map((e) => <p key={e} className="text-[#B83A3A]">{e.toUpperCase()}</p>)}
        </div>
      )}
    </div>
  )
}

// ── Review queue ────────────────────────────────────────────────────────────

function ReviewPanel({ sel, brandNames, run, busy }: { sel: MemberWardrobe; brandNames: string[]; run: Run; busy: string | null }) {
  const byPhoto = useMemo(() => {
    const m = new Map<string, WardrobeExtraction[]>()
    for (const x of sel.queue) m.set(x.photo_id, [...(m.get(x.photo_id) ?? []), x])
    return Array.from(m.entries())
  }, [sel.queue])
  if (!sel.queue.length) {
    return <p className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">NOTHING WAITING. UPLOAD PHOTOS, OR EVERYTHING EXTRACTED HAS BEEN REVIEWED.</p>
  }
  return (
    <div className="space-y-8">
      <datalist id="wardrobe-brands">{brandNames.map((b) => <option key={b} value={b} />)}</datalist>
      {byPhoto.map(([photoId, xs]) => (
        <div key={photoId}>
          <div className="flex items-center gap-3 mb-3">
            {xs[0].photo_signed_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={xs[0].photo_signed_url} alt="" className="w-14 h-[72px] object-cover bg-[#F2F2F0]" />
            )}
            <p className={label}>PHOTO · {(xs[0].photo_name ?? photoId.slice(0, 8)).toUpperCase()} · {xs.length} PIECE{xs.length === 1 ? '' : 'S'} FOUND</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {xs.map((x) => <ReviewCard key={x.extraction_id} x={x} run={run} busy={busy} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function ReviewCard({ x, run, busy }: { x: WardrobeExtraction; run: Run; busy: string | null }) {
  const d = x.detected
  const s = x.scores
  const e0 = x.edits ?? {}
  const [edits, setEdits] = useState<ExtractionEdits>({
    product_name: e0.product_name ?? null,
    item_type: e0.item_type ?? s?.item_type ?? d.item_type,
    colour_family: e0.colour_family ?? s?.colour_family ?? d.colour_family ?? null,
    material_primary: e0.material_primary ?? s?.material_primary ?? d.material_guess ?? null,
    brand_name: e0.brand_name ?? d.brand_hint ?? s?.brand_name ?? null,
    estimated_value: e0.estimated_value ?? null,
    owned_since: e0.owned_since ?? null,
    fit_notes: e0.fit_notes ?? null,
    favourite: e0.favourite ?? null,
    notes: e0.notes ?? null,
    scores: e0.scores ?? {},
  })
  const [direction, setDirection] = useState(x.regen_direction ?? '')
  const [showScores, setShowScores] = useState(false)
  const ready = x.status === 'review' && !!x.cutout_url
  const working = ['cutout_queued', 'cutout_running', 'scoring', 'detected'].includes(x.status)
  const low = new Set(x.low_confidence_dims ?? [])
  const set = (k: keyof ExtractionEdits, v: any) => setEdits((p) => ({ ...p, [k]: v }))
  const setScore = (k: string, v: number | null) => setEdits((p) => ({ ...p, scores: { ...(p.scores ?? {}), [k]: v } }))
  const name = edits.product_name || titleCase(d.name)

  return (
    <div className={`border ${x.status === 'failed' ? 'border-[#B83A3A]' : ready ? 'border-[#C4A882]' : 'border-[#E2E0DB]'} bg-white`}>
      <div className="flex gap-3 p-3">
        {/* crop */}
        <div className="w-24 shrink-0">
          <p className="text-[7px] tracking-[0.14em] text-[#A8A8A4] mb-1">IN THE PHOTO</p>
          {x.crop_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={x.crop_url} alt="" className="w-24 aspect-[3/4] object-cover bg-[#F2F2F0]" />
          ) : <div className="w-24 aspect-[3/4] bg-[#F2F2F0]" />}
        </div>
        {/* cutout */}
        <div className="w-32 shrink-0">
          <p className="text-[7px] tracking-[0.14em] text-[#A8A8A4] mb-1">CUTOUT{x.cutout_attempts > 1 ? ` · TAKE ${x.cutout_attempts}` : ''}</p>
          {x.cutout_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={x.cutout_url} alt="" className="w-32 aspect-[3/4] object-contain bg-white border border-[#F0EEE9]" />
          ) : (
            <div className="w-32 aspect-[3/4] bg-[#F8F8F6] flex items-center justify-center text-center px-2">
              <span className="text-[8px] tracking-[0.1em] text-[#A8A8A4]">{working ? STATUS_LABEL[x.status] : 'NO CUTOUT'}</span>
            </div>
          )}
        </div>
        {/* attributes */}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] tracking-[0.1em] text-[#0A0A0A] truncate">{name.toUpperCase()}</p>
            <span className={`text-[8px] tracking-[0.12em] whitespace-nowrap ${x.status === 'failed' ? 'text-[#B83A3A]' : ready ? 'text-[#8B5E00]' : 'text-[#A8A8A4]'}`}>{STATUS_LABEL[x.status] ?? x.status.toUpperCase()}</span>
          </div>
          <p className="text-[8px] tracking-[0.06em] text-[#6B6B6B] leading-relaxed">{d.description} <span className="text-[#A8A8A4]">· CONFIDENCE {(d.confidence * 100).toFixed(0)}%</span></p>
          {x.error && <p className="text-[8px] tracking-[0.06em] text-[#B83A3A]">{x.error.toUpperCase()}</p>}
          <input className={input} placeholder={titleCase(d.name)} value={edits.product_name ?? ''} onChange={(e) => set('product_name', e.target.value || null)} />
          <div className="grid grid-cols-2 gap-1.5">
            <select className={input} value={edits.item_type ?? ''} onChange={(e) => set('item_type', e.target.value)}>
              {ITEM_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ').toUpperCase()}</option>)}
            </select>
            <select className={input} value={edits.colour_family ?? ''} onChange={(e) => set('colour_family', e.target.value || null)}>
              <option value="">COLOUR —</option>
              {COLOUR_FAMILIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
            <input className={input} placeholder="MATERIAL" value={edits.material_primary ?? ''} onChange={(e) => set('material_primary', e.target.value || null)} />
            <input className={input} list="wardrobe-brands" placeholder="BRAND (IF SHE KNOWS IT)" value={edits.brand_name ?? ''} onChange={(e) => set('brand_name', e.target.value || null)} />
            <input className={input} type="number" min={0} placeholder="EST. VALUE £" value={edits.estimated_value ?? ''} onChange={(e) => set('estimated_value', e.target.value ? Number(e.target.value) : null)} />
            <input className={input} placeholder="OWNED SINCE (E.G. 2023)" value={edits.owned_since ?? ''} onChange={(e) => set('owned_since', e.target.value || null)} />
            <input className={`${input} col-span-2`} placeholder="FIT / COMFORT NOTES" value={edits.fit_notes ?? ''} onChange={(e) => set('fit_notes', e.target.value || null)} />
          </div>
          <label className="flex items-center gap-2 text-[8px] tracking-[0.12em] text-[#6B6B6B]">
            <input type="checkbox" checked={!!edits.favourite} onChange={(e) => set('favourite', e.target.checked)} /> FAVOURITE — SHE REACHES FOR THIS
          </label>
          {s && (
            <button className="text-[8px] tracking-[0.12em] text-[#C4A882] hover:underline" onClick={() => setShowScores((v) => !v)}>
              {showScores ? 'HIDE' : 'SHOW'} SCORED DIMENSIONS{low.size ? ` · ${low.size} LOWER CONFIDENCE` : ''}
            </button>
          )}
          {!s && ready && <p className="text-[8px] tracking-[0.1em] text-[#B83A3A]">NOT SCORED — RESCORE BEFORE APPROVING</p>}
        </div>
      </div>

      {showScores && s && (
        <div className="border-t border-[#F0EEE9] px-3 py-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
          {SCORED_DIMS.map((k) => {
            const base = s[k] as number | null
            const cur = (edits.scores?.[k] as number | null | undefined) ?? base
            if (base == null && cur == null) return null
            return (
              <div key={String(k)} className="flex items-center justify-between gap-2">
                <span className={`text-[7px] tracking-[0.1em] ${low.has(String(k)) ? 'text-[#8B5E00]' : 'text-[#6B6B6B]'}`} title={low.has(String(k)) ? 'Scored with lower confidence' : ''}>
                  {String(k).replace(/_/g, ' ').toUpperCase()}{low.has(String(k)) ? ' ◌' : ''}
                </span>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} onClick={() => setScore(String(k), n)} className={`w-5 h-5 text-[8px] border ${cur === n ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'border-[#E2E0DB] text-[#6B6B6B]'}`}>{n}</button>
                  ))}
                </div>
              </div>
            )
          })}
          {low.size > 0 && (
            <p className="col-span-full text-[7px] tracking-[0.08em] text-[#8B5E00] mt-1">
              ◌ LOWER CONFIDENCE: {Array.from(low).map((d) => d.replace(/_/g, ' ').toUpperCase()).join(' · ')} — {low.has('brand_price_tier') ? 'NO BRAND, SO THE BRAND-DERIVED SIGNALS ARE ABSENT' : 'MATERIAL OR SHAPE COULD NOT BE READ WITH CERTAINTY'}
            </p>
          )}
        </div>
      )}

      <div className="border-t border-[#F0EEE9] px-3 py-2 flex flex-wrap items-center gap-2">
        <button className={btnGold} disabled={!ready || !s || busy === `ap-${x.extraction_id}`} onClick={() => run(`ap-${x.extraction_id}`, () => reviewApprove(x.extraction_id, edits), 'APPROVED — IN HER WARDROBE, COMPOSABLE NOW')}>
          ✓ APPROVE
        </button>
        <button className={btnTiny} disabled={busy === `sv-${x.extraction_id}`} onClick={() => run(`sv-${x.extraction_id}`, () => reviewSaveEdits(x.extraction_id, edits), 'EDITS SAVED')}>SAVE EDITS</button>
        <input className={`${input} !w-56`} placeholder="REGENERATE — WHAT TO FIX (OPTIONAL)" value={direction} onChange={(e) => setDirection(e.target.value)} />
        <button className={btnTiny} disabled={working || busy === `rg-${x.extraction_id}`} onClick={() => run(`rg-${x.extraction_id}`, () => reviewRegenerate(x.extraction_id, direction || null), 'REGENERATION QUEUED')}>↻ REGENERATE CUTOUT</button>
        {x.cutout_url && <button className={btnTiny} disabled={working} onClick={() => run(`rs-${x.extraction_id}`, () => reviewRescore(x.extraction_id), 'RESCORE QUEUED')}>RESCORE</button>}
        <button className="text-[9px] tracking-[0.12em] text-[#B83A3A] hover:underline ml-auto" onClick={() => run(`dc-${x.extraction_id}`, () => reviewDiscard(x.extraction_id), 'DISCARDED')}>✕ DISCARD</button>
      </div>
    </div>
  )
}

// ── Wardrobe grid ───────────────────────────────────────────────────────────

function WardrobeGrid({ sel, run, busy, brandNames }: { sel: MemberWardrobe; run: Run; busy: string | null; brandNames: string[] }) {
  const [slot, setSlot] = useState('')
  const [colour, setColour] = useState('')
  const slots = useMemo(() => countBy(sel.items, (i) => i.slot), [sel.items])
  const colours = useMemo(() => countBy(sel.items, (i) => i.colour_family ?? ''), [sel.items])
  const shown = sel.items.filter((i) => (!slot || i.slot === slot) && (!colour || i.colour_family === colour))
  if (!sel.items.length) return <p className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">NOTHING APPROVED YET.</p>
  return (
    <div className="space-y-4">
      <datalist id="wardrobe-brands-grid">{brandNames.map((b) => <option key={b} value={b} />)}</datalist>
      <div className="flex flex-wrap gap-1.5">
        <button className={`${btnTiny} ${!slot ? '!border-[#0A0A0A] !text-[#0A0A0A]' : ''}`} onClick={() => setSlot('')}>ALL · {sel.items.length}</button>
        {Object.entries(slots).map(([k, n]) => (
          <button key={k} className={`${btnTiny} ${slot === k ? '!border-[#0A0A0A] !text-[#0A0A0A]' : ''}`} onClick={() => setSlot(slot === k ? '' : k)}>{SLOT_LABEL[k] ?? k.toUpperCase()} · {n}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(colours).filter(([k]) => k).map(([k, n]) => (
          <button key={k} className={`${btnTiny} ${colour === k ? '!border-[#0A0A0A] !text-[#0A0A0A]' : ''}`} onClick={() => setColour(colour === k ? '' : k)}>{k.toUpperCase()} · {n}</button>
        ))}
      </div>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {shown.map((it) => <OwnedCard key={it.item_id} it={it} run={run} busy={busy} />)}
      </div>
    </div>
  )
}

function OwnedCard({ it, run, busy }: { it: OwnedItemView; run: Run; busy: string | null }) {
  const [value, setValue] = useState<string>(it.estimated_value != null ? String(it.estimated_value) : '')
  const [brand, setBrand] = useState(it.brand_name ?? '')
  const cpw = it.estimated_value && it.styled_in > 0 ? it.estimated_value / it.styled_in : null
  return (
    <div className="border border-[#E2E0DB] bg-white">
      {it.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={it.image_url} alt={it.product_name} className="w-full aspect-[3/4] object-contain bg-white" />
      ) : <div className="w-full aspect-[3/4] bg-[#F8F8F6]" />}
      <div className="px-2 py-2 space-y-1">
        <p className="text-[8px] tracking-[0.12em] text-[#8B5E00]">◈ {(it.brand_name ?? 'HER WARDROBE').toUpperCase()}</p>
        <p className="text-[9px] tracking-[0.06em] text-[#0A0A0A] leading-snug">{it.product_name.toUpperCase()}</p>
        <p className="text-[8px] tracking-[0.08em] text-[#6B6B6B]">
          STYLED IN {it.styled_in} LOOK{it.styled_in === 1 ? '' : 'S'}{cpw != null ? ` · £${cpw.toFixed(0)}/WEAR` : ''}
          {it.owned_metadata?.favourite ? ' · ♥' : ''}
        </p>
        <div className="flex gap-1">
          <input className={`${input} !px-1.5 !py-1 !text-[9px]`} placeholder="£ VALUE" value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => { const n = value ? Number(value) : null; if (n !== it.estimated_value) run(`v-${it.item_id}`, () => updateOwned(it.item_id, { estimated_value: n && n > 0 ? n : null }), 'VALUE SAVED') }} />
          <input className={`${input} !px-1.5 !py-1 !text-[9px]`} list="wardrobe-brands-grid" placeholder="BRAND" value={brand} onChange={(e) => setBrand(e.target.value)} onBlur={() => { if ((brand || null) !== (it.brand_name ?? null)) run(`b-${it.item_id}`, () => updateOwned(it.item_id, { brand_name: brand || null }), 'BRAND SAVED') }} />
        </div>
        <button className="text-[8px] tracking-[0.12em] text-[#B83A3A] hover:underline" disabled={busy === `rm-${it.item_id}`} onClick={() => { if (window.confirm(`Remove ${it.product_name} from her wardrobe? Looks that use it will be rebuilt.`)) run(`rm-${it.item_id}`, () => removeOwnedItem(it.item_id), 'REMOVED — LOOKS REBUILT') }}>✕ REMOVE</button>
      </div>
    </div>
  )
}

// ── Photos & cost ───────────────────────────────────────────────────────────

function PhotosPanel({ sel, run, busy }: { sel: MemberWardrobe; run: Run; busy: string | null }) {
  const total = sel.batches.reduce((s, b) => s + (b.cost?.total_usd ?? 0), 0)
  const pieces = sel.items.length
  return (
    <div className="space-y-6">
      <div>
        <p className={`${label} mb-2`}>UNIT ECONOMICS · {sel.batches.length} BATCH{sel.batches.length === 1 ? '' : 'ES'} · {fmtUsd(total)} TOTAL{pieces ? ` · ${fmtUsd(total / pieces)} PER APPROVED PIECE` : ''}</p>
        <div className="border border-[#E2E0DB] bg-white overflow-x-auto">
          <table className="w-full text-[9px] tracking-[0.06em]">
            <thead><tr className="text-left text-[#A8A8A4] border-b border-[#F0EEE9]">
              <th className="px-3 py-2 font-normal">BATCH</th><th className="px-3 py-2 font-normal">PHOTOS</th><th className="px-3 py-2 font-normal">STATUS</th>
              <th className="px-3 py-2 font-normal">DETECT</th><th className="px-3 py-2 font-normal">CUTOUTS</th><th className="px-3 py-2 font-normal">SCORING</th><th className="px-3 py-2 font-normal">TOTAL</th><th className="px-3 py-2 font-normal">CALLS</th>
            </tr></thead>
            <tbody>
              {sel.batches.map((b) => (
                <tr key={b.batch_id} className="border-b border-[#F6F4F0] text-[#4A4E57]">
                  <td className="px-3 py-2 text-[#0A0A0A]">{(b.label ?? b.created_at.slice(0, 16).replace('T', ' ')).toUpperCase()}</td>
                  <td className="px-3 py-2">{b.photo_count}</td>
                  <td className="px-3 py-2">{b.status.toUpperCase()}</td>
                  <td className="px-3 py-2">{fmtUsd(b.cost?.detect_usd ?? 0)}</td>
                  <td className="px-3 py-2">{fmtUsd(b.cost?.cutout_usd ?? 0)} ({b.cost?.images_generated ?? 0})</td>
                  <td className="px-3 py-2">{fmtUsd(b.cost?.score_usd ?? 0)}</td>
                  <td className="px-3 py-2 text-[#0A0A0A]">{fmtUsd(b.cost?.total_usd ?? 0)}</td>
                  <td className="px-3 py-2">{b.cost?.calls ?? 0}{b.cost?.estimated_calls ? ` (${b.cost.estimated_calls} EST.)` : ''}</td>
                </tr>
              ))}
              {!sel.batches.length && <tr><td className="px-3 py-3 text-[#A8A8A4]" colSpan={8}>NO BATCHES YET</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <p className={`${label} mb-2`}>ORIGINAL PHOTOS — PRIVATE, SIGNED URLS ONLY · DELETING ONE DISCARDS ITS PIECES AND REBUILDS ANY LOOK THAT USED THEM</p>
        <div className="grid gap-3 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {sel.photos.map((p) => (
            <div key={p.photo_id} className="border border-[#E2E0DB] bg-white">
              {p.signed_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.signed_url} alt="" className="w-full aspect-[3/4] object-cover bg-[#F2F2F0]" />
              ) : <div className="w-full aspect-[3/4] bg-[#F2F2F0]" />}
              <div className="px-2 py-1.5">
                <p className="text-[8px] tracking-[0.08em] text-[#6B6B6B] truncate">{(p.original_name ?? p.photo_id.slice(0, 8)).toUpperCase()}</p>
                <p className="text-[8px] tracking-[0.08em] text-[#A8A8A4]">{p.status.replace(/_/g, ' ').toUpperCase()} · {p.garment_count} PIECE{p.garment_count === 1 ? '' : 'S'}</p>
                <button className="text-[8px] tracking-[0.12em] text-[#B83A3A] hover:underline mt-1" disabled={busy === `ph-${p.photo_id}`} onClick={() => { if (window.confirm('Delete this photo, every piece extracted from it, and rebuild looks that used them?')) run(`ph-${p.photo_id}`, () => removePhoto(p.photo_id), 'PHOTO DELETED — PIECES DISCARDED, LOOKS REBUILT') }}>✕ DELETE</button>
              </div>
            </div>
          ))}
          {!sel.photos.length && <p className="text-[9px] tracking-[0.1em] text-[#A8A8A4] col-span-full">NO PHOTOS YET</p>}
        </div>
      </div>
    </div>
  )
}

// ── What to buy ─────────────────────────────────────────────────────────────

function UnlockPanel({ sel }: { sel: MemberWardrobe }) {
  const [occasion, setOccasion] = useState('')
  const [rows, setRows] = useState<UnlockRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function go() {
    setBusy(true); setErr(null)
    const r = await unlockPurchases(sel.member.member_id, (occasion || null) as any)
    setBusy(false)
    if (r.error) setErr(r.error)
    setRows(r.rows ?? [])
  }
  return (
    <div className="space-y-4">
      <p className="text-[9px] tracking-[0.08em] text-[#6B6B6B] max-w-3xl leading-relaxed">
        FOR EACH RETAIL PIECE IN HER POOL: HOW MANY NEW OUTFITS IT COMPLETES USING ONLY WHAT SHE ALREADY OWNS FOR EVERY OTHER SLOT — EACH ONE CLEARING THE SAME BAR HER LOOKS DO, RANKED THROUGH HER STYLIST PERSONA. THE SHARPEST COST-PER-WEAR NUMBER BEFORE SHE SPENDS A POUND.
      </p>
      <div className="flex items-center gap-2">
        <select className={`${input} !w-56`} value={occasion} onChange={(e) => setOccasion(e.target.value)}>
          {OCCASIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button className={btnDark} disabled={busy || !sel.items.length} onClick={go}>{busy ? 'RANKING…' : '✦ RANK WHAT TO BUY'}</button>
        {!sel.items.length && <span className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">APPROVE SOME OWNED PIECES FIRST</span>}
      </div>
      {err && <p className="text-[9px] tracking-[0.1em] text-[#B83A3A]">{err.toUpperCase()}</p>}
      {rows && !rows.length && <p className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">NOTHING IN THE RETAIL POOL COMPLETES A WEARABLE OUTFIT WITH HER WARDROBE YET — SHE MAY NEED A BODY PIECE (TOP + BOTTOM OR DRESS) APPROVED FIRST.</p>}
      {rows && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.item_id} className="border border-[#E2E0DB] bg-white flex gap-3 p-3">
              <span className="text-[10px] tracking-[0.1em] text-[#C4A882] w-6 shrink-0">{i + 1}</span>
              {r.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.image_url} alt="" className="w-20 aspect-[3/4] object-cover bg-[#F8F8F6] shrink-0" />
              ) : <div className="w-20 aspect-[3/4] bg-[#F8F8F6] shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4]">{(r.brand_name ?? '—').toUpperCase()} · {SLOT_LABEL[r.slot] ?? r.slot.toUpperCase()}</p>
                <p className="text-[10px] tracking-[0.08em] text-[#0A0A0A]">{r.product_name.toUpperCase()}</p>
                <p className="text-[9px] tracking-[0.08em] text-[#8B5E00] mt-1">
                  UNLOCKS {r.unlocked} NEW OUTFIT{r.unlocked === 1 ? '' : 'S'}{r.price_gbp != null ? ` · £${r.price_gbp}` : ''}{r.outfitsPer100 != null ? ` · ${r.outfitsPer100} OUTFITS PER £100` : ''} · COHERENCE {r.avgCoherence}
                </p>
                {r.retailer_url && <a href={r.retailer_url} target="_blank" rel="noreferrer" className="text-[8px] tracking-[0.12em] text-[#C4A882] hover:underline">RETAILER →</a>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.examples.map((ex, j) => (
                    <div key={j} className="flex gap-1 border border-[#F0EEE9] p-1">
                      {ex.items.map((it) => (
                        <div key={it.item_id} className="w-9" title={`${it.product_name}${it.owned ? ' — hers' : ''}`}>
                          {it.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={it.image_url} alt="" className={`w-9 aspect-[3/4] object-cover ${it.owned ? 'ring-1 ring-[#C4A882]' : ''}`} />
                          ) : <div className="w-9 aspect-[3/4] bg-[#F2F2F0]" />}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── utils ───────────────────────────────────────────────────────────────────

function countBy<T>(xs: T[], key: (x: T) => string): Record<string, number> {
  const m: Record<string, number> = {}
  for (const x of xs) { const k = key(x); m[k] = (m[k] ?? 0) + 1 }
  return m
}

function titleCase(s: string): string {
  return s.split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}
