'use client'

// Self-serve wardrobe — the front-end surface, so type sizes are the PUBLIC
// floors (15px+ labels, 17px+ body), not the admin's tracked caps.
//
// Few words on purpose (Chloe, 2026-10-18: the page read like a manual). One
// line says what to do, the button does it, and the pieces MYRA finds are
// answered in the Dressing Room, where she is sent once her photos are in.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WARDROBE_CONFIG } from '@/lib/wardrobe/config'
import {
  deleteMyItem, deleteMyPhoto, nudgeMyQueue, startMyBatch, updateMine, uploadMyPhoto, type MyWardrobe,
} from './actions'
import ReviewCard from './ReviewCard'

const SLOT_LABEL: Record<string, string> = { outerwear: 'Outerwear', top: 'Tops', bottom: 'Bottoms', dress: 'Dresses', shoe: 'Shoes', bag: 'Bags', jewellery: 'Jewellery', accessory: 'Accessories' }
const MAX = WARDROBE_CONFIG.maxPhotosPerUpload

export default function WardrobeSelfServe({ data }: { data: MyWardrobe }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [slot, setSlot] = useState('')

  // While her photos are being worked through, keep nudging the queue so the
  // review cards appear without her reloading.
  const nudging = useRef(false)
  useEffect(() => {
    if (!data.processing || !data.ready) return
    let alive = true
    const tick = async () => {
      if (nudging.current || !alive) return
      nudging.current = true
      try { await nudgeMyQueue() } finally { nudging.current = false }
      if (alive) router.refresh()
    }
    void tick()
    const id = setInterval(tick, 12_000)
    return () => { alive = false; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.processing, data.ready, data.queued])

  async function act(key: string, fn: () => Promise<{ error?: string } | any>) {
    setBusy(key); setError(null)
    const r = await fn()
    if (r?.error) setError(r.error)
    setBusy(null)
    router.refresh()
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy('upload'); setError(null)
    const list = Array.from(files).slice(0, MAX)
    if (files.length > MAX) setError(`${MAX} at a time — the first ${MAX} are going in.`)
    const b = await startMyBatch()
    let sent = 0
    for (let i = 0; i < list.length; i++) {
      setProgress(list.length > 1 ? `UPLOADING ${i + 1} OF ${list.length}…` : 'UPLOADING…')
      const fd = new FormData()
      fd.append('file', list[i])
      if (b.batchId) fd.append('batch_id', b.batchId)
      const r = await uploadMyPhoto(fd)
      if (r.error) setError(`${list[i].name}: ${r.error}`)
      else sent++
    }
    setBusy(null); setProgress(null)
    if (inputRef.current) inputRef.current.value = ''
    // Her pieces are answered in the Dressing Room, so that is where she goes.
    if (sent > 0 && data.ready) router.push('/me/dressing-room')
    else router.refresh()
  }

  const review = data.queue.filter((q) => q.status === 'review' || q.status === 'failed')
  const working = data.queue.filter((q) => !['review', 'failed'].includes(q.status)).length
  const slots = data.items.reduce<Record<string, number>>((m, it) => { m[it.slot] = (m[it.slot] ?? 0) + 1; return m }, {})
  const shown = data.items.filter((it) => !slot || it.slot === slot)

  return (
    <div className="space-y-10">
      <div>
        <p className="text-[15px] tracking-[0.12em] text-[#A8A8A4] mb-2">YOUR WARDROBE</p>
        <h1 className="text-[clamp(24px,5vw,34px)] tracking-[0.04em] text-[#4A4E57] leading-tight mb-3">
          ADD WHAT YOU OWN
        </h1>
        <p className="text-[17px] text-[#6B6B6B] leading-relaxed">
          A piece on its own, or an outfit on you. Up to {MAX} photos at a time.
        </p>
      </div>

      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      <button
        disabled={busy === 'upload'}
        onClick={() => inputRef.current?.click()}
        className="w-full bg-[#0A0A0A] text-white rounded-[12px] py-5 text-[17px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
      >
        {busy === 'upload' ? (progress ?? 'WORKING…') : '+ ADD PHOTOS'}
      </button>
      {!data.ready && <p className="text-[15px] text-[#7C838B] leading-relaxed">Photos are kept. Finding pieces is switched off for now.</p>}
      {error && <p className="text-[15px] text-[#B83A3A] leading-relaxed">{error}</p>}
      {(working > 0 || data.processing) && (
        <p className="text-[15px] text-[#7C838B] tracking-[0.04em]">Finding your pieces… {working > 0 ? `${working} to go.` : `${data.queued} photo${data.queued === 1 ? '' : 's'} to go.`}</p>
      )}

      {/* Review */}
      {review.length > 0 && (
        <section className="space-y-4">
          <p className="text-[15px] tracking-[0.12em] text-[#A8A8A4]">FOUND IN YOUR PHOTOS</p>
          {review.map((x) => <ReviewCard key={x.extraction_id} x={x} busy={busy} act={act} />)}
        </section>
      )}

      {/* Wardrobe */}
      <section className="space-y-4">
        <p className="text-[15px] tracking-[0.12em] text-[#A8A8A4]">IN YOUR WARDROBE &middot; {data.items.length}</p>
        {data.items.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setSlot('')} className={`text-[15px] tracking-[0.06em] rounded-full px-4 py-2 border ${!slot ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'border-[#E2E0DB] text-[#6B6B6B]'}`}>All</button>
            {Object.entries(slots).map(([k, n]) => (
              <button key={k} onClick={() => setSlot(slot === k ? '' : k)} className={`text-[15px] tracking-[0.06em] rounded-full px-4 py-2 border ${slot === k ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'border-[#E2E0DB] text-[#6B6B6B]'}`}>{SLOT_LABEL[k] ?? k} · {n}</button>
            ))}
          </div>
        )}
        {data.items.length === 0 ? (
          <p className="text-[17px] text-[#A8A8A4] leading-relaxed">Nothing yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {shown.map((it) => (
              <div key={it.item_id} className="border border-[#E2E0DB] rounded-[12px] overflow-hidden">
                {it.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.image_url} alt={it.product_name} className="w-full aspect-[3/4] object-contain bg-white" />
                ) : <div className="w-full aspect-[3/4] bg-[#F8F8F6]" />}
                <div className="px-3 py-3 space-y-1">
                  <p className="text-[15px] tracking-[0.06em] text-[#A8A8A4] truncate">{it.brand_name ?? 'Yours'}</p>
                  <p className="text-[17px] text-[#0A0A0A] leading-snug">{it.product_name}</p>
                  <p className="text-[15px] text-[#6B6B6B]">{it.styled_in > 0 ? `Styled in ${it.styled_in} look${it.styled_in === 1 ? '' : 's'}` : 'Not styled yet'}</p>
                  <ValueField itemId={it.item_id} value={it.estimated_value} act={act} />
                  <button className="text-[15px] text-[#B83A3A] underline mt-1" disabled={busy === `del-${it.item_id}`} onClick={() => { if (window.confirm('Remove this piece from your wardrobe?')) act(`del-${it.item_id}`, () => deleteMyItem(it.item_id)) }}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Photos */}
      {data.photos.length > 0 && (
        <section className="space-y-3">
          <p className="text-[15px] tracking-[0.12em] text-[#A8A8A4]">YOUR PHOTOS &middot; PRIVATE</p>
          <div className="grid grid-cols-3 gap-2">
            {data.photos.map((p) => (
              <div key={p.photo_id} className="relative">
                {p.signed_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.signed_url} alt="" className="w-full aspect-[3/4] object-cover bg-[#F8F8F6] rounded-[8px]" />
                ) : <div className="w-full aspect-[3/4] bg-[#F8F8F6] rounded-[8px]" />}
                <button
                  className="absolute top-2 right-2 bg-white/90 text-[#B83A3A] text-[15px] rounded-full w-8 h-8 flex items-center justify-center"
                  disabled={busy === `ph-${p.photo_id}`}
                  onClick={() => { if (window.confirm('Delete this photo and every piece taken from it?')) act(`ph-${p.photo_id}`, () => deleteMyPhoto(p.photo_id)) }}
                  aria-label="Delete photo"
                >
                  ×
                </button>
                <p className="text-[15px] text-[#A8A8A4] mt-1">{p.garment_count} piece{p.garment_count === 1 ? '' : 's'}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ValueField({ itemId, value, act }: { itemId: string; value: number | null; act: (k: string, fn: () => Promise<any>) => Promise<void> }) {
  const [v, setV] = useState(value != null ? String(value) : '')
  return (
    <label className="flex items-center gap-2 text-[15px] text-[#6B6B6B]">
      <span>Worth about £</span>
      <input
        className="w-20 border border-[#E2E0DB] rounded-[8px] px-2 py-1 text-[15px] text-[#0A0A0A]"
        value={v}
        inputMode="numeric"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { const n = v ? Number(v) : null; if (n !== value) act(`val-${itemId}`, () => updateMine(itemId, { estimated_value: n && n > 0 ? n : null })) }}
      />
    </label>
  )
}
