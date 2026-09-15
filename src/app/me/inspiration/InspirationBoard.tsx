'use client'

// INSPIRATION — outfits she loves. The pictures Chloe added for her and the
// ones she adds herself, in one place. Paste a screenshot anywhere on the page,
// drop pictures, choose them or paste links; a screenshot of several outfits is
// split so each one is learned on its own.

import { useEffect, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import { ArchiveCard } from '@/components/ArchiveCard'
import { addMyInspiration, loadMyInspiration, type InspirationBoardView } from './board-actions'

export default function InspirationBoard({ view: initial, testMemberId }: { view: InspirationBoardView; testMemberId?: string }) {
  const [view, setView] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [links, setLinks] = useState('')
  const [dragging, setDragging] = useState(false)

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

  async function add(files: File[], urls = '') {
    if (!files.length && !urls.trim()) return
    setBusy(true)
    setMsg(files.length ? 'Looking at your pictures…' : 'Saving…')
    const fd = new FormData()
    fd.set('urls', urls)
    if (testMemberId) fd.set('asMemberId', testMemberId)
    for (const f of files) fd.append('files', f)
    const r = await addMyInspiration(fd)
    setBusy(false)
    if (r.error) { setMsg(r.error); return }
    setMsg(`${r.added} outfit${r.added === 1 ? '' : 's'} added — MYRA is learning what you love.${r.failed ? ` ${r.failed} could not be saved.` : ''}`)
    setLinks('')
    setView(await loadMyInspiration(testMemberId))
  }

  // ⌘V anywhere on the page adds a pasted screenshot. Pasting text into the
  // links field still works — only image pastes are taken.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imagesFrom(e.clipboardData?.items)
      if (!files.length || busy) return
      e.preventDefault()
      void add(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, testMemberId])

  return (
    <div className={`myra-texture relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-screen ${testMemberId ? '' : '-my-10'}`}>
      <div className="w-full px-6 sm:px-10 pb-16">
        <ArchiveCard
          className="w-full"
          intro="settle"
          heading={
            <div className="text-center">
              <h1 className="text-[clamp(30px,5vw,72px)] tracking-[0.045em] text-[#4A4E57] leading-[1.05]">INSPIRATION</h1>
              <p className="myra-section-note mt-4">OUTFITS YOU LOVE — THEY SHAPE EVERY LOOK WE MAKE YOU</p>
              {view.test && (
                <p className="text-[18px] tracking-[0.1em] text-[#8B5E00] mt-4">
                  TEST AS {view.firstName.toUpperCase()} — PICTURES ADDED HERE ARE ADDED TO HER REAL PICTURES
                </p>
              )}
            </div>
          }
        >
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void add(imagesFrom(e.dataTransfer.files)) }}
            className={`max-w-[900px] mx-auto border-2 border-dashed px-6 py-8 mb-8 text-center transition-colors ${dragging ? 'border-[#2B2B2B] bg-[rgba(255,255,255,0.35)]' : 'border-[#6E6B65] bg-[rgba(255,255,255,0.18)]'}`}
          >
            <p className="text-[22px] text-[#2B2B2B]">Add an outfit you love</p>
            <p className="text-[20px] text-[#55534E] mt-2">A screenshot, a photo, a whole Pinterest board — paste it, drop it, or choose it.</p>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
              <label className={`text-[22px] px-7 py-3.5 bg-[#2B2B2B] text-white cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
                Choose pictures
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = '' }}
                />
              </label>
              <input
                value={links}
                onChange={(e) => setLinks(e.target.value)}
                placeholder="Or paste a picture link"
                className="text-[20px] bg-white border border-[#6E6B65] px-4 py-3 min-w-0 w-full sm:w-[320px] placeholder:text-[#8C8A85] focus:outline-none focus:border-[#2B2B2B]"
              />
              <button
                disabled={busy || !links.trim()}
                onClick={() => add([], links)}
                className="text-[22px] px-6 py-3.5 border border-[#2B2B2B] text-[#2B2B2B] disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {msg && <p className="text-[20px] text-[#2B2B2B] mt-5">{msg}</p>}
          </div>

          {view.error && <p className="text-[20px] text-[#B83A3A] text-center mb-6">{view.error}</p>}
          {view.pictures.length === 0 ? (
            <p className="text-[22px] text-[#4A4E57] text-center py-6">Nothing here yet — add the first outfit you love.</p>
          ) : (
            <>
              <p className="myra-section-note text-center mb-4">
                {view.pictures.length} OUTFIT{view.pictures.length === 1 ? '' : 'S'} YOU LOVE
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-[6px] max-w-[1600px] mx-auto">
                {view.pictures.map((p) => (
                  <div key={p.image_id} className="relative aspect-[3/4] bg-[#E4E2DD] overflow-hidden">
                    <FallbackImage src={p.image_url} thumbWidth={500} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </>
          )}
        </ArchiveCard>
      </div>
    </div>
  )
}
