'use client'

// SCORING REVIEW — the grid where the vision pass gets corrected.
//
// Lowest confidence first, because that's where the reads go wrong. Every score
// is a tap-to-correct chip; corrections keep the original alongside the fix, so
// the disagreement is training data rather than an overwrite. Only confirmed
// images reach the envelope.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  loadInspirationImages,
  scoreInspirationImages,
  correctInspirationScores,
  setInspirationStatus,
  confirmAllScored,
  recomputeEnvelope,
  addInspirationPictures,
} from './inspiration-actions'
import {
  SCORE_DIMENSIONS,
  type InspirationImage,
  type InspirationScores,
} from '@/lib/inspiration'

const STATUS_TONE: Record<string, string> = {
  pending_scoring: 'text-[#A8A8A4] border-[#E2E0DB]',
  scored: 'text-[#7C838B] border-[#DCDEE1]',
  confirmed: 'text-[#3D7A50] border-[#C9E0CF]',
  rejected: 'text-[#B83A3A] border-[#E8B4B4]',
}

export default function InspirationReview({
  personaId,
  personaName,
  envelopeStatus,
}: {
  personaId: string
  personaName: string
  envelopeStatus?: string | null
}) {
  const router = useRouter()
  const [images, setImages] = useState<InspirationImage[]>([])
  const [confirmed, setConfirmed] = useState(0)
  const [minRequired, setMinRequired] = useState(15)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [addUrls, setAddUrls] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  async function addPictures(files: File[], links = '') {
    if (!files.length && !links.trim()) return
    setBusy('add')
    setMsg(files.length ? `READING ${files.length} PICTURE${files.length === 1 ? '' : 'S'} — FINDING EACH OUTFIT…` : 'SAVING…')
    const fd = new FormData()
    fd.set('personaId', personaId)
    fd.set('urls', links)
    for (const f of files) fd.append('files', f)
    const r = await addInspirationPictures(fd)
    setBusy(null)
    if (r.error) setMsg(r.error.toUpperCase())
    else {
      const parts = [`${r.added} OUTFIT${r.added === 1 ? '' : 'S'} LOGGED AND SCORED`]
      if (r.screenshots) parts.push(`FROM ${r.screenshots} SCREENSHOT${r.screenshots === 1 ? '' : 'S'}`)
      if (r.failed) parts.push(`${r.failed} COULD NOT BE SAVED`)
      setMsg(`${parts.join(' · ')} — CONFIRM THE ONES THAT ARE THE STYLE`)
      setAddUrls('')
    }
    await refresh()
    router.refresh()
  }

  const imagesFrom = (list: DataTransferItemList | FileList | null | undefined): File[] => {
    if (!list) return []
    const out: File[] = []
    for (let i = 0; i < list.length; i++) {
      const it = list[i] as DataTransferItem | File
      const f = 'getAsFile' in it ? (it.kind === 'file' ? it.getAsFile() : null) : it
      if (f && f.type.startsWith('image/')) out.push(f)
    }
    return out
  }

  // ⌘V anywhere while this moodboard is open: pasted screenshots are added at once.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imagesFrom(e.clipboardData?.items)
      if (!files.length || busy) return
      e.preventDefault()
      void addPictures(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, personaId])

  async function refresh() {
    const r = await loadInspirationImages(personaId)
    setImages(r.images)
    setConfirmed(r.confirmed)
    setMinRequired(r.minRequired)
    setLoaded(true)
    if (r.error) setMsg(r.error.toUpperCase())
  }

  // refresh is stable enough for this surface; re-run only when the persona changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh() }, [personaId])

  async function act(key: string, fn: () => Promise<any>, ok: (r: any) => string) {
    setBusy(key)
    setMsg(null)
    const r = await fn()
    setBusy(null)
    setMsg(r?.error ? String(r.error).toUpperCase() : ok(r).toUpperCase())
    await refresh()
    router.refresh()
  }

  const pending = images.filter((i) => i.status === 'pending_scoring').length
  const scored = images.filter((i) => i.status === 'scored').length
  const rejected = images.filter((i) => i.status === 'rejected').length
  const ready = confirmed >= minRequired

  return (
    <div className="mt-4 border-t border-[#E2E0DB] pt-4">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <p className="text-[10px] tracking-[0.14em] text-[#0A0A0A]">INSPIRATION · {personaName.toUpperCase()}</p>
        <span className={`text-[9px] tracking-[0.12em] ${ready ? 'text-[#3D7A50]' : 'text-[#B83A3A]'}`}>
          {confirmed}/{minRequired} CONFIRMED{ready ? ' ✓' : ' — CANNOT GO LIVE YET'}
        </span>
        <span className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">
          {pending} PENDING · {scored} AWAITING REVIEW · {rejected} REJECTED
        </span>
        {envelopeStatus === 'needs_review' && (
          <span className="text-[9px] tracking-[0.12em] text-[#7C838B] border border-[#DCDEE1] px-2 py-0.5">
            ENVELOPE UPDATED — REVIEW RULES
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          disabled={!!busy || pending === 0}
          onClick={() => act('score', () => scoreInspirationImages(personaId), (r) => `SCORED ${r.scored} (${r.failed} FAILED)`)}
          className="border border-[#E2E0DB] px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full text-[#6B6B6B] hover:border-[#0A0A0A] disabled:opacity-40"
        >
          {busy === 'score' ? 'SCORING…' : `VISION-SCORE ${pending} PENDING`}
        </button>
        <button
          disabled={!!busy || scored === 0}
          onClick={() => act('confirmall', () => confirmAllScored(personaId), (r) => `${r.confirmed} CONFIRMED`)}
          className="border border-[#E2E0DB] px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full text-[#6B6B6B] hover:border-[#0A0A0A] disabled:opacity-40"
          title="Confirm every image still awaiting review — correct the wrong ones first"
        >
          CONFIRM ALL REVIEWED
        </button>
        <button
          disabled={!!busy || confirmed === 0}
          onClick={() =>
            act('envelope', () => recomputeEnvelope(personaId), (r) =>
              r.belowMinimum
                ? `ENVELOPE FROM ${r.confirmed} IMAGES — BELOW THE ${minRequired} NEEDED TO GO LIVE`
                : `ENVELOPE FROM ${r.confirmed} CONFIRMED · TIGHTNESS ${r.tightness} — RULES PROPOSED`)
          }
          className="bg-[#0A0A0A] text-white px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full hover:opacity-85 disabled:opacity-40"
        >
          {busy === 'envelope' ? 'COMPUTING…' : 'COMPUTE ENVELOPE → PROPOSE RULES'}
        </button>
        {msg && <span className="text-[9px] tracking-[0.1em] text-[#C4A882]">{msg}</span>}
      </div>

      {/* Moodboard intake — paste a screenshot, drop pictures, or link them. A
          Pinterest board is split into one image per outfit. Allowed after
          go-live; a live style is flagged rather than moved underneath clients. */}
      <div
        tabIndex={0}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void addPictures(imagesFrom(e.dataTransfer.files)) }}
        className={`border-2 border-dashed rounded-[12px] px-6 py-7 mb-4 text-center outline-none transition-colors ${dragging ? 'border-[#0A0A0A] bg-[#F4F3F0]' : 'border-[#C3BFB8] focus:border-[#0A0A0A]'}`}
      >
        <p className="text-[18px] tracking-[0.1em] text-[#0A0A0A]">
          {busy === 'add' ? 'WORKING…' : 'PASTE A SCREENSHOT (⌘V) · OR DROP PICTURES'}
        </p>
        <p className="text-[15px] tracking-[0.04em] text-[#6B6B6B] mt-1">
          A single outfit or a whole Pinterest board — each outfit is found, cut out and scored on its own.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
          <label className="border border-[#0A0A0A] px-4 py-2 text-[14px] tracking-[0.1em] text-[#0A0A0A] cursor-pointer hover:bg-[#0A0A0A] hover:text-white">
            CHOOSE PICTURES
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void addPictures(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          </label>
          <input
            value={addUrls}
            onChange={(e) => setAddUrls(e.target.value)}
            placeholder="OR PASTE IMAGE LINKS"
            className="min-w-[280px] border border-[#E2E0DB] px-3 py-2 text-[14px] tracking-[0.05em] outline-none focus:border-[#0A0A0A]"
          />
          <button
            disabled={!!busy || !addUrls.trim()}
            onClick={() => addPictures([], addUrls)}
            className="border border-[#E2E0DB] px-4 py-2 text-[14px] tracking-[0.1em] text-[#6B6B6B] hover:border-[#0A0A0A] disabled:opacity-40"
          >
            ADD LINKS
          </button>
        </div>
      </div>

      {!loaded && <p className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">LOADING…</p>}
      {loaded && images.length === 0 && (
        <p className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">
          NO INSPIRATION IMAGES YET — ADD URLS ABOVE.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {images.map((img) => (
          <ImageCard
            key={img.image_id}
            img={img}
            open={openId === img.image_id}
            onToggle={() => setOpenId(openId === img.image_id ? null : img.image_id)}
            busy={busy}
            onCorrect={(patch) =>
              act(`fix-${img.image_id}`, () => correctInspirationScores(img.image_id, patch), () => 'CORRECTION SAVED')
            }
            onStatus={(st) =>
              act(`st-${img.image_id}`, () => setInspirationStatus(img.image_id, st), () => `${st.toUpperCase()}`)
            }
          />
        ))}
      </div>
    </div>
  )
}

function ImageCard({
  img,
  open,
  onToggle,
  busy,
  onCorrect,
  onStatus,
}: {
  img: InspirationImage
  open: boolean
  onToggle: () => void
  busy: string | null
  onCorrect: (patch: Partial<InspirationScores>) => void
  onStatus: (s: 'confirmed' | 'rejected' | 'scored') => void
}) {
  const s = img.scores
  const lowConfidence = (img.score_confidence ?? 0) <= 2
  const corrected = new Set(img.corrected_fields ?? [])

  return (
    <div className={`border bg-white overflow-hidden ${img.status === 'confirmed' ? 'border-[#C9E0CF]' : img.status === 'rejected' ? 'border-[#E8B4B4] opacity-60' : 'border-[#E2E0DB]'}`}>
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.image_url} alt="" className="w-full aspect-[3/4] object-cover bg-[#F8F8F6]" />
        <span className={`absolute top-2 left-2 bg-white/95 border rounded-full px-2 py-0.5 text-[8px] tracking-[0.1em] ${STATUS_TONE[img.status]}`}>
          {img.status.replace('_', ' ').toUpperCase()}
        </span>
        {img.score_confidence != null && (
          <span
            className={`absolute top-2 right-2 border rounded-full px-2 py-0.5 text-[8px] tracking-[0.1em] ${
              lowConfidence ? 'bg-[#B83A3A] text-white border-[#B83A3A]' : 'bg-white/95 text-[#6B6B6B] border-[#E2E0DB]'
            }`}
            title="Vision-pass confidence — low reads are shown first"
          >
            CONF {img.score_confidence}
          </span>
        )}
        {corrected.size > 0 && (
          <span className="absolute bottom-2 left-2 bg-[#C4A882] text-white rounded-full px-2 py-0.5 text-[8px] tracking-[0.1em]">
            {corrected.size} CORRECTED
          </span>
        )}
        {/* Client uploads sit in the same review queue as seed-set variants,
            tagged so it's obvious whose eye this came from. */}
        {img.source === 'user_upload' && (
          <span className="absolute bottom-2 right-2 bg-[#4A6FA5] text-white rounded-full px-2 py-0.5 text-[8px] tracking-[0.1em]">
            CLIENT UPLOAD
          </span>
        )}
      </div>

      <div className="px-2.5 py-2">
        {img.scoring_error && (
          <p className="text-[8px] tracking-[0.08em] text-[#B83A3A] mb-1">{img.scoring_error.slice(0, 80).toUpperCase()}</p>
        )}
        {s && (
          <>
            <button onClick={onToggle} className="text-[8px] tracking-[0.12em] text-[#6B6B6B] hover:text-[#0A0A0A] mb-1.5">
              {open ? 'HIDE SCORES ▲' : 'TAP TO CORRECT ▼'}
            </button>
            {!open && (
              <p className="text-[8px] tracking-[0.06em] text-[#A8A8A4] leading-relaxed">
                {SCORE_DIMENSIONS.map((d) => `${d.label.slice(0, 4)} ${s[d.key] ?? '—'}`).join(' · ')}
              </p>
            )}
            {open && (
              <div className="space-y-1.5 mb-2">
                {SCORE_DIMENSIONS.map((d) => (
                  <div key={d.key}>
                    <p className="text-[8px] tracking-[0.1em] text-[#A8A8A4] flex items-center gap-1">
                      {d.label}
                      {corrected.has(d.key) && <span className="text-[#C4A882]">·FIXED</span>}
                    </p>
                    <div className="flex gap-1 mt-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          disabled={!!busy}
                          onClick={() => onCorrect({ [d.key]: n } as Partial<InspirationScores>)}
                          title={n === 1 ? d.low : n === 5 ? d.high : undefined}
                          className={`flex-1 text-[9px] py-1 border transition-colors ${
                            s[d.key] === n
                              ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
                              : 'bg-white text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {!!s.item_types?.length && (
                  <p className="text-[8px] tracking-[0.08em] text-[#6B6B6B] pt-1">
                    READS AS: {s.item_types.join(', ').toUpperCase()}
                  </p>
                )}
                {!!img.occasion_read?.length && (
                  <p className="text-[8px] tracking-[0.08em] text-[#A8A8A4]">
                    OCCASIONS: {img.occasion_read.join(', ').toUpperCase()}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex gap-1.5 mt-1.5">
          {img.status !== 'confirmed' && (
            <button
              disabled={!!busy || !s}
              onClick={() => onStatus('confirmed')}
              className="flex-1 bg-[#0A0A0A] text-white text-[8px] tracking-[0.1em] py-1.5 hover:opacity-85 disabled:opacity-40"
            >
              CONFIRM ✓
            </button>
          )}
          {img.status !== 'rejected' && (
            <button
              disabled={!!busy}
              onClick={() => onStatus('rejected')}
              className="flex-1 border border-[#E2E0DB] text-[#B83A3A] text-[8px] tracking-[0.1em] py-1.5 hover:border-[#B83A3A] disabled:opacity-40"
            >
              REJECT ✕
            </button>
          )}
          {img.status !== 'scored' && s && (
            <button
              disabled={!!busy}
              onClick={() => onStatus('scored')}
              className="border border-[#E2E0DB] text-[#6B6B6B] text-[8px] tracking-[0.1em] px-2 py-1.5 hover:border-[#0A0A0A] disabled:opacity-40"
              title="Back to awaiting review"
            >
              ↺
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
