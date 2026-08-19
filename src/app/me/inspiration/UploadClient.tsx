'use client'

// The upload surface. Three things have to happen, in this order, every time:
//   1. the image saves
//   2. she is SHOWN the read, in her own language, and can correct it
//   3. she gets something back — three looks chosen because of what she added
// Without (3) the behaviour doesn't repeat, so it is not optional.

import { useRef, useState } from 'react'
import { uploadInspiration, correctMyRead, type UploadResult } from '../actions'
import { SCORE_DIMENSIONS, type InspirationScores } from '@/lib/inspiration'

interface Uploaded extends UploadResult {
  key: string
}

export default function UploadClient({
  existing,
}: {
  existing: { image_id: string; image_url: string }[]
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [results, setResults] = useState<Uploaded[]>([])
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    const list = Array.from(files).slice(0, 6)
    for (let i = 0; i < list.length; i++) {
      setProgress(list.length > 1 ? `READING ${i + 1} OF ${list.length}…` : 'READING YOUR IMAGE…')
      const fd = new FormData()
      fd.append('file', list[i])
      const r = await uploadInspiration(fd)
      if (r.error && !r.imageId) setError(r.error)
      else setResults((prev) => [{ ...r, key: r.imageId ?? String(Date.now() + i) }, ...prev])
    }
    setBusy(false)
    setProgress(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[10px] tracking-[0.16em] text-[#A8A8A4] mb-2">YOUR INSPIRATION</p>
        <h1 className="text-[clamp(22px,4.5vw,30px)] tracking-[0.04em] text-[#4A4E57] leading-tight mb-2">
          ADD AN OUTFIT YOU LOVE
        </h1>
        <p className="text-[12px] tracking-[0.03em] text-[#A8A8A4] leading-relaxed">
          A screenshot, a photo, anything that stopped you. We&rsquo;ll tell you what we see — correct us if we&rsquo;re wrong.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="w-full bg-[#0A0A0A] text-white rounded-[12px] py-4 text-[12px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
      >
        {busy ? (progress ?? 'WORKING…') : '+ ADD IMAGES'}
      </button>
      {error && <p className="text-[11px] tracking-[0.04em] text-[#B83A3A]">{error}</p>}

      {results.map((r) => (
        <ResultCard
          key={r.key}
          result={r}
          open={openId === r.imageId}
          onToggle={() => setOpenId(openId === r.imageId ? null : (r.imageId ?? null))}
        />
      ))}

      {existing.length > 0 && (
        <section>
          <p className="text-[10px] tracking-[0.16em] text-[#A8A8A4] mb-2">EVERYTHING YOU&rsquo;VE ADDED</p>
          <div className="grid grid-cols-3 gap-2">
            {existing.map((i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i.image_id} src={i.image_url} alt="" className="w-full aspect-[3/4] object-cover bg-[#F8F8F6] rounded-[8px]" />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ResultCard({
  result,
  open,
  onToggle,
}: {
  result: Uploaded
  open: boolean
  onToggle: () => void
}) {
  const [scores, setScores] = useState<InspirationScores | undefined>(result.scores)
  const [readAs, setReadAs] = useState<string[]>(result.readAs ?? [])
  const [saving, setSaving] = useState(false)

  async function fix(key: keyof InspirationScores, value: number) {
    if (!result.imageId) return
    setSaving(true)
    const next = { ...(scores as InspirationScores), [key]: value }
    setScores(next)
    const r = await correctMyRead(result.imageId, { [key]: value } as Partial<InspirationScores>)
    if (r.readAs) setReadAs(r.readAs)
    setSaving(false)
  }

  return (
    <section className="border border-[#E2E0DB] rounded-[12px] overflow-hidden">
      <div className="flex gap-3 p-3">
        {result.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={result.imageUrl} alt="" className="w-24 aspect-[3/4] object-cover bg-[#F8F8F6] rounded-[8px] shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] tracking-[0.14em] text-[#A8A8A4] mb-1.5">WHAT WE SEE</p>
          {readAs.length ? (
            <div className="flex flex-wrap gap-1.5">
              {readAs.map((w) => (
                <span key={w} className="text-[11px] tracking-[0.03em] text-[#4A4E57] border border-[#E2E0DB] rounded-full px-2.5 py-1">
                  {w}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] tracking-[0.03em] text-[#B83A3A]">{result.error ?? 'We couldn’t read this one.'}</p>
          )}
          {!!result.occasions?.length && (
            <p className="text-[10px] tracking-[0.06em] text-[#A8A8A4] mt-2">
              READS AS: {result.occasions.join(' · ')}
            </p>
          )}
          {scores && (
            <button onClick={onToggle} className="text-[10px] tracking-[0.12em] text-[#0A0A0A] underline mt-2">
              {open ? 'DONE' : 'NOT QUITE? CORRECT IT'}
            </button>
          )}
        </div>
      </div>

      {open && scores && (
        <div className="px-3 pb-3 space-y-3 border-t border-[#E2E0DB] pt-3">
          {SCORE_DIMENSIONS.map((d) => (
            <div key={d.key}>
              <div className="flex justify-between mb-1">
                <span className="text-[10px] tracking-[0.1em] text-[#A8A8A4]">{d.low}</span>
                <span className="text-[10px] tracking-[0.1em] text-[#A8A8A4]">{d.high}</span>
              </div>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    disabled={saving}
                    onClick={() => fix(d.key, n)}
                    className={`flex-1 py-2.5 rounded-[8px] border text-[12px] transition-colors ${
                      scores[d.key] === n
                        ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
                        : 'bg-white text-[#6B6B6B] border-[#E2E0DB]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[10px] tracking-[0.04em] text-[#A8A8A4] leading-relaxed">
            Your corrections teach MYRA faster than anything else.
          </p>
        </div>
      )}

      {/* The payoff — an upload has to visibly do something. */}
      {!!result.because?.length && (
        <div className="border-t border-[#E2E0DB] px-3 py-3 bg-[#FAFAF8]">
          <p className="text-[10px] tracking-[0.14em] text-[#8B5E00] mb-2">BECAUSE OF WHAT YOU JUST ADDED</p>
          <div className="grid grid-cols-3 gap-2">
            {result.because.map((o) => (
              <a key={o.outfit_id} href={`/outfit/${o.outfit_id}`} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={o.image_url} alt={o.label} className="w-full aspect-[3/4] object-cover bg-[#F2F2F0] rounded-[8px]" />
                {o.label && (
                  <p className="text-[9px] tracking-[0.04em] text-[#6B6B6B] mt-1 line-clamp-2">{o.label}</p>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
