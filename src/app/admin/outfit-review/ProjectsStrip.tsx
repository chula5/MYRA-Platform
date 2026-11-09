'use client'

// PROJECTS — briefs MYRA composes in the background (lib/review-projects).
//
// A brief ("fur coats", "New Year's Eve party outfits"), a kind (six looks
// per anchor, or three ways to wear each), and optionally a screenshot of the
// piece to build around. The project starts composing on its own; this strip
// shows every project's progress and opens one for picking.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { thumbUrl } from '@/lib/image-utils'
import type { ReviewProjectSummary, ProjectKind } from '@/lib/review-projects'

const CHIP = 'px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full border transition-colors disabled:opacity-50'
const CHIP_ON = 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
const CHIP_OFF = 'text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]'

export function projectStatusLine(p: ReviewProjectSummary): { text: string; tone: string; live: boolean } {
  const looks = `${p.looks_count} LOOK${p.looks_count === 1 ? '' : 'S'}`
  const picks = p.picked ? ` · ${p.picked} PICKED` : ''
  const shots = p.shot ? ` · ${p.shot} SHOT` : ''
  const shooting = p.shooting ? ` · ${p.shooting} SHOOTING` : ''
  switch (p.status) {
    case 'queued': return { text: 'QUEUED — STARTS IN A MOMENT', tone: 'text-[#7C838B]', live: true }
    case 'running':
      return {
        text: p.anchors_total === 0 ? (p.anchor_item_id ? 'STYLING YOUR PIECE…' : 'READING THE BRIEF AND THE LIBRARY…') : `STYLING ${Math.min(p.anchors_tried + 1, p.anchors_total)} OF ${p.anchors_total} · ${looks}${picks}`,
        tone: 'text-[#4A4E57]', live: true,
      }
    case 'paused': return { text: `PAUSED · ${p.anchors_tried} OF ${p.anchors_total || p.target_anchors} · ${looks}${picks}`, tone: 'text-[#7C838B]', live: false }
    case 'failed': return { text: (p.error ?? 'FAILED').toUpperCase(), tone: 'text-[#B83A3A]', live: false }
    default: return { text: `${looks}${picks}${shots}${shooting}`, tone: p.shooting ? 'text-[#4A4E57]' : 'text-[#7C838B]', live: p.shooting > 0 }
  }
}

export default function ProjectsStrip() {
  const [projects, setProjects] = useState<ReviewProjectSummary[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [brief, setBrief] = useState('')
  const [kind, setKind] = useState<ProjectKind>('looks')
  const [anchors, setAnchors] = useState(20)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/review-projects', { cache: 'no-store' })
      const j = await r.json()
      if (j.error) setLoadError(j.error)
      else { setLoadError(null); setProjects(j.projects ?? []) }
    } catch { /* next poll */ }
  }, [])

  useEffect(() => { void load() }, [load])
  // Poll while anything is composing or shooting.
  const live = projects.some((p) => projectStatusLine(p).live)
  useEffect(() => {
    const t = setInterval(() => { void load() }, live ? 4_000 : 30_000)
    return () => clearInterval(t)
  }, [live, load])

  function takeFile(f: File | null | undefined) {
    if (!f || !f.type.startsWith('image/')) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }
  // ⌘V a screenshot anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))
      const f = item?.getAsFile()
      if (f) { e.preventDefault(); takeFile(f) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  async function start() {
    if (busy || (!brief.trim() && !file)) return
    setBusy(true)
    setNote(null)
    const fd = new FormData()
    fd.set('brief', brief.trim())
    fd.set('kind', kind)
    fd.set('anchors', String(anchors))
    if (file) fd.set('file', file)
    try {
      const r = await fetch('/api/admin/review-projects', { method: 'POST', body: fd })
      const j = await r.json()
      if (j.error) { setNote({ text: `${j.error}${j.read ? ` (read: ${j.read})` : ''}`, tone: 'bad' }); return }
      setNote({ text: j.intake?.message ? `${j.intake.message}. Composing now.` : `Composing “${j.project?.title ?? brief}” — carry on here.`, tone: 'ok' })
      setBrief(''); setFile(null); setPreview(null)
      if (fileRef.current) fileRef.current.value = ''
      await load()
    } catch {
      setNote({ text: 'Could not start the project — try again', tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  async function act(p: ReviewProjectSummary, action: 'pause' | 'resume' | 'delete') {
    if (action === 'delete' && !confirm(`Delete “${p.title}” and its ${p.looks_count} looks? Picked drafts stay in Outfit Projects.`)) return
    await fetch(`/api/admin/review-projects/${p.project_id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
    await load()
  }

  return (
    <section className="border border-[#E2E0DB] bg-[#FAFAF8] rounded-[14px] p-5 space-y-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-[10px] tracking-[0.2em] text-[#4A4E57]">PROJECTS</p>
          <p className="text-[10px] tracking-[0.08em] text-[#A8A8A4] mt-1">
            Say what the content is about — a piece, an occasion, a brand — and MYRA composes it in the background and keeps every look. Pick the ones for Higgsfield when you&rsquo;re ready, while the next project runs. A screenshot is optional, for building around one piece.
          </p>
        </div>
        {loadError && <p className="text-[9px] tracking-[0.12em] text-[#B83A3A] flex-shrink-0">{loadError.toUpperCase()}</p>}
      </div>

      {/* New project */}
      <form
        onSubmit={(e) => { e.preventDefault(); void start() }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); takeFile(e.dataTransfer.files?.[0]) }}
        className={`rounded-[12px] border bg-white p-4 space-y-3 transition-colors ${dragOver ? 'border-[#0A0A0A]' : 'border-[#E2E0DB]'}`}
      >
        <input
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={file ? 'OPTIONAL — HOW TO STYLE IT, E.G. CHRISTMAS LUNCH, OR WITH JEANS' : 'FUR COATS · MIDI SKIRTS · TRENCH COATS · NEW YEAR’S EVE PARTY OUTFITS · CHRISTMAS LUNCH…'}
          aria-label="Project brief"
          autoComplete="off"
          className="w-full border border-[#0A0A0A] rounded-[10px] px-4 py-3 text-[12px] tracking-[0.05em] text-[#4A4E57] placeholder:text-[10px] placeholder:tracking-[0.08em] placeholder:text-[#A8A8A4] focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[8px] tracking-[0.18em] text-[#A8A8A4]">MAKE</span>
          <button type="button" onClick={() => setKind('looks')} className={`${CHIP} ${kind === 'looks' ? CHIP_ON : CHIP_OFF}`}>LOTS OF LOOKS</button>
          <button type="button" onClick={() => setKind('three_ways')} className={`${CHIP} ${kind === 'three_ways' ? CHIP_ON : CHIP_OFF}`}>THREE WAYS TO WEAR IT</button>
          {!file && (
            <>
              <span className="text-[8px] tracking-[0.18em] text-[#A8A8A4] ml-2">ANCHORS</span>
              {[10, 20, 40].map((n) => (
                <button key={n} type="button" onClick={() => setAnchors(n)} className={`${CHIP} ${anchors === n ? CHIP_ON : CHIP_OFF}`}>{n}</button>
              ))}
            </>
          )}
        </div>
        {/* The piece, optionally: words alone are a whole project. */}
        <div className="flex flex-wrap items-center gap-3">
          {preview ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="w-10 h-[52px] rounded-[6px] overflow-hidden border border-[#0A0A0A] bg-[#F2F2F0]" aria-label="Change the screenshot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="" className="w-full h-full object-cover" />
              </button>
              <div>
                <p className="text-[8px] tracking-[0.14em] text-[#4A4E57]">BUILT AROUND THIS PIECE</p>
                <button type="button" onClick={() => { setFile(null); setPreview(null); if (fileRef.current) fileRef.current.value = '' }} className="text-[8px] tracking-[0.12em] text-[#6B6B6B] hover:text-[#B83A3A]">✕ REMOVE</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={`${CHIP} ${CHIP_OFF} border-dashed`}
              aria-label="Add a screenshot of the piece (optional)"
            >
              + SCREENSHOT OF A PIECE · OPTIONAL · DROP OR ⌘V
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => takeFile(e.target.files?.[0])} />
          <button
            type="submit"
            disabled={busy || (!brief.trim() && !file)}
            className="ml-auto bg-[#0A0A0A] text-white px-6 py-2.5 text-[10px] tracking-[0.16em] rounded-full hover:opacity-85 transition-opacity disabled:opacity-40"
          >
            {busy ? (file ? 'READING THE SCREENSHOT…' : 'STARTING…') : 'START PROJECT →'}
          </button>
        </div>
        {busy && file && (
          <div className="flex items-center gap-3" aria-busy="true">
            <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-8 w-auto" />
            <p className="text-[9px] tracking-[0.14em] text-[#A8A8A4]">MYRA IS READING THE PIECE AND LOOKING FOR IT IN THE SHOPS — UP TO A MINUTE.</p>
          </div>
        )}
        {note && <p className={`text-[9px] tracking-[0.1em] ${note.tone === 'bad' ? 'text-[#B83A3A]' : 'text-[#4A4E57]'}`}>{note.text.toUpperCase()}</p>}
      </form>

      {/* Projects */}
      {projects.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.map((p) => {
            const st = projectStatusLine(p)
            const pct = p.anchors_total ? Math.round((p.anchors_tried / p.anchors_total) * 100) : 0
            return (
              <div key={p.project_id} className="group border border-[#E2E0DB] bg-white rounded-[12px] overflow-hidden flex">
                <Link href={`/admin/outfit-review/projects/${p.project_id}`} className="w-[84px] flex-shrink-0 bg-[#F2F2F0] relative">
                  {p.cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbUrl(p.cover, 400)} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  )}
                </Link>
                <div className="flex-1 min-w-0 p-3 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/admin/outfit-review/projects/${p.project_id}`} className="min-w-0">
                      <p className="text-[12px] tracking-[0.06em] text-[#4A4E57] truncate hover:underline">{p.title.toUpperCase()}</p>
                      <p className="text-[8px] tracking-[0.14em] text-[#A8A8A4] mt-0.5">{p.kind === 'three_ways' ? 'THREE WAYS' : 'LOOKS'}{p.anchor_item_id ? ' · FROM A SCREENSHOT' : ''}</p>
                    </Link>
                    <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {(p.status === 'queued' || p.status === 'running') && (
                        <button onClick={() => act(p, 'pause')} title="Pause" className="text-[8px] tracking-[0.1em] text-[#6B6B6B] hover:text-[#0A0A0A]">PAUSE</button>
                      )}
                      {(p.status === 'paused' || p.status === 'failed') && (
                        <button onClick={() => act(p, 'resume')} title="Resume" className="text-[8px] tracking-[0.1em] text-[#6B6B6B] hover:text-[#0A0A0A]">RESUME</button>
                      )}
                      <button onClick={() => act(p, 'delete')} title="Delete" className="text-[#A8A8A4] hover:text-[#B83A3A] text-[14px] leading-none">×</button>
                    </div>
                  </div>
                  <p className={`mt-auto pt-2 text-[8px] tracking-[0.12em] ${st.tone} flex items-center gap-2`}>
                    {st.live && <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-4 w-auto" />}
                    <span className="truncate">{st.text}</span>
                  </p>
                  {p.status === 'running' && p.anchors_total > 0 && (
                    <div className="mt-1.5 h-[2px] bg-[#F2F2F0] rounded-full overflow-hidden">
                      <div className="h-full bg-[#0A0A0A] transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
