'use client'

// Self-serve wardrobe — the front-end surface, so type sizes are the PUBLIC
// floors (15px+ labels, 17px+ body), not the admin's tracked caps.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WardrobeExtraction } from '@/lib/wardrobe/types'
import {
  approveMine, deleteMyItem, deleteMyPhoto, discardMine, nudgeMyQueue, regenerateMine, startMyBatch,
  updateMine, uploadMyPhoto, type MyWardrobe,
} from './actions'

const SLOT_LABEL: Record<string, string> = { outerwear: 'Outerwear', top: 'Tops', bottom: 'Bottoms', dress: 'Dresses', shoe: 'Shoes', bag: 'Bags', jewellery: 'Jewellery', accessory: 'Accessories' }

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
    const list = Array.from(files).slice(0, 24)
    const b = await startMyBatch()
    for (let i = 0; i < list.length; i++) {
      setProgress(list.length > 1 ? `UPLOADING ${i + 1} OF ${list.length}…` : 'UPLOADING…')
      const fd = new FormData()
      fd.append('file', list[i])
      if (b.batchId) fd.append('batch_id', b.batchId)
      const r = await uploadMyPhoto(fd)
      if (r.error) setError(`${list[i].name}: ${r.error}`)
    }
    setBusy(null); setProgress(null)
    if (inputRef.current) inputRef.current.value = ''
    router.refresh()
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
          ADD WHAT YOU ALREADY OWN
        </h1>
        <p className="text-[17px] text-[#6B6B6B] leading-relaxed">
          Photograph pieces on their own or a whole outfit on you. We find each garment, cut it out, and you tell us which ones to keep &mdash; then your stylist builds new looks around them.
        </p>
        {!data.linkedToStylist && (
          <p className="text-[15px] text-[#A8A8A4] leading-relaxed mt-2">Your account isn&rsquo;t linked to a stylist yet &mdash; your pieces are saved and ready for when it is.</p>
        )}
      </div>

      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      <button
        disabled={busy === 'upload'}
        onClick={() => inputRef.current?.click()}
        className="w-full bg-[#0A0A0A] text-white rounded-[12px] py-5 text-[17px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
      >
        {busy === 'upload' ? (progress ?? 'WORKING…') : '+ ADD PHOTOS'}
      </button>
      {!data.ready && <p className="text-[15px] text-[#8B5E00] leading-relaxed">Photos are saved, but extraction isn&rsquo;t switched on yet &mdash; we&rsquo;ll work through them as soon as it is.</p>}
      {error && <p className="text-[15px] text-[#B83A3A] leading-relaxed">{error}</p>}
      {(working > 0 || data.processing) && (
        <p className="text-[15px] text-[#8B5E00] tracking-[0.04em]">Working through your photos… {working > 0 ? `${working} piece${working === 1 ? '' : 's'} in progress` : `${data.queued} in the queue`}. Pieces appear below as they are ready.</p>
      )}

      {/* Review */}
      {review.length > 0 && (
        <section className="space-y-4">
          <p className="text-[15px] tracking-[0.12em] text-[#A8A8A4]">WHAT WE FOUND &mdash; KEEP THE ONES THAT ARE RIGHT</p>
          {review.map((x) => <ReviewCard key={x.extraction_id} x={x} busy={busy} act={act} />)}
        </section>
      )}

      {/* Wardrobe */}
      <section className="space-y-4">
        <p className="text-[15px] tracking-[0.12em] text-[#A8A8A4]">IN YOUR WARDROBE &mdash; {data.items.length} PIECE{data.items.length === 1 ? '' : 'S'}</p>
        {data.items.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setSlot('')} className={`text-[15px] tracking-[0.06em] rounded-full px-4 py-2 border ${!slot ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'border-[#E2E0DB] text-[#6B6B6B]'}`}>All</button>
            {Object.entries(slots).map(([k, n]) => (
              <button key={k} onClick={() => setSlot(slot === k ? '' : k)} className={`text-[15px] tracking-[0.06em] rounded-full px-4 py-2 border ${slot === k ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'border-[#E2E0DB] text-[#6B6B6B]'}`}>{SLOT_LABEL[k] ?? k} · {n}</button>
            ))}
          </div>
        )}
        {data.items.length === 0 ? (
          <p className="text-[17px] text-[#A8A8A4] leading-relaxed">Nothing yet. Add a few photos to start.</p>
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
          <p className="text-[15px] tracking-[0.12em] text-[#A8A8A4]">YOUR PHOTOS &mdash; PRIVATE TO YOU</p>
          <p className="text-[15px] text-[#6B6B6B] leading-relaxed">Only you and your stylist can see these. Delete a photo and every piece we took from it goes too.</p>
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

function ReviewCard({ x, busy, act }: { x: WardrobeExtraction; busy: string | null; act: (k: string, fn: () => Promise<any>) => Promise<void> }) {
  const d = x.detected
  const [brand, setBrand] = useState(x.edits?.brand_name ?? d.brand_hint ?? '')
  const [name, setName] = useState(x.edits?.product_name ?? titleCase(d.name))
  const [direction, setDirection] = useState('')
  const ready = x.status === 'review' && !!x.cutout_url && !!x.scores
  return (
    <div className="border border-[#E2E0DB] rounded-[12px] overflow-hidden">
      <div className="flex gap-3 p-3">
        {x.crop_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={x.crop_url} alt="" className="w-24 aspect-[3/4] object-cover bg-[#F8F8F6] rounded-[8px] shrink-0" />
        )}
        {x.cutout_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={x.cutout_url} alt="" className="w-28 aspect-[3/4] object-contain bg-white border border-[#F0EEE9] rounded-[8px] shrink-0" />
        ) : (
          <div className="w-28 aspect-[3/4] bg-[#F8F8F6] rounded-[8px] shrink-0 flex items-center justify-center text-center px-2">
            <span className="text-[15px] text-[#A8A8A4]">{x.status === 'failed' ? 'Didn’t work' : 'Cutting out…'}</span>
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <input className="w-full border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[17px] text-[#0A0A0A]" value={name} onChange={(e) => setName(e.target.value)} />
          <p className="text-[15px] text-[#6B6B6B] leading-relaxed">{d.description}</p>
          <input className="w-full border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[15px] text-[#0A0A0A]" placeholder="Brand, if you know it (e.g. Sézane)" value={brand} onChange={(e) => setBrand(e.target.value)} />
          {x.error && <p className="text-[15px] text-[#B83A3A]">{x.error}</p>}
        </div>
      </div>
      <div className="border-t border-[#E2E0DB] px-3 py-3 flex flex-wrap items-center gap-3 bg-[#FAFAF8]">
        <button
          className="bg-[#0A0A0A] text-white rounded-[10px] px-5 py-3 text-[15px] tracking-[0.08em] disabled:opacity-40"
          disabled={!ready || busy === `ap-${x.extraction_id}`}
          onClick={() => act(`ap-${x.extraction_id}`, () => approveMine(x.extraction_id, { product_name: name || null, brand_name: brand || null }))}
        >
          KEEP IT
        </button>
        <button className="text-[15px] text-[#6B6B6B] underline" onClick={() => act(`dc-${x.extraction_id}`, () => discardMine(x.extraction_id))}>Not this one</button>
        <div className="flex items-center gap-2 ml-auto">
          <input className="w-44 border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[15px]" placeholder="What’s wrong with it?" value={direction} onChange={(e) => setDirection(e.target.value)} />
          <button className="text-[15px] text-[#0A0A0A] underline" disabled={busy === `rg-${x.extraction_id}`} onClick={() => act(`rg-${x.extraction_id}`, () => regenerateMine(x.extraction_id, direction || null))}>Try again</button>
        </div>
      </div>
    </div>
  )
}

function titleCase(s: string): string {
  return s.split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}
