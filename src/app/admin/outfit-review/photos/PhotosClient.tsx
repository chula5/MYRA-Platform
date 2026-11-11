'use client'

// The photos, project by project. Each photo shows its pieces small underneath; tapping a
// photo opens it large with the pieces named, a full-size link, a download and the draft.

import { useEffect, useState } from 'react'
import { thumbUrl } from '@/lib/image-utils'
import type { ProjectPhoto, ProjectPhotoGroup } from '@/lib/review-photos'

const CHIP = 'px-3 py-1.5 text-[10px] tracking-[0.1em] rounded-full border transition-colors'
/** Cloudinary serves the file as a download when asked; a plain link would only open it. */
const downloadUrl = (u: string) => (u.includes('res.cloudinary.com') ? u.replace('/upload/', '/upload/fl_attachment/') : u)

function Pieces({ photo, size }: { photo: ProjectPhoto; size: 'small' | 'large' }) {
  if (size === 'small') {
    return (
      <div className="mt-2 flex gap-1.5 overflow-hidden">
        {photo.pieces.map((p, i) => (
          <span key={`${p.item_id}-${i}`} title={[p.brand, p.name, p.price].filter(Boolean).join(' · ')} className="h-11 w-11 flex-shrink-0 rounded-[6px] border border-[#E2E0DB] bg-white overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbUrl(p.image_url, 160)} alt="" loading="lazy" className="h-full w-full object-contain" />
          </span>
        ))}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {photo.pieces.map((p, i) => (
        <div key={`${p.item_id}-${i}`} className="flex gap-3 items-center min-w-0">
          <span className="h-20 w-16 flex-shrink-0 rounded-[8px] border border-[#E2E0DB] bg-white overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbUrl(p.image_url, 300)} alt="" className="h-full w-full object-contain" />
          </span>
          <span className="min-w-0">
            <span className="block text-[10px] tracking-[0.12em] text-[#A8A8A4]">{p.slot === 'anchor' ? 'ANCHOR' : p.slot.toUpperCase()}</span>
            <span className="block text-[11px] tracking-[0.08em] text-[#6B6B6B] truncate">{(p.brand ?? '').toUpperCase()}</span>
            <span className="block text-[12px] text-[#4A4E57] leading-snug line-clamp-2">{p.name}</span>
            {p.price && <span className="block text-[11px] text-[#4A4E57]">{p.price}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function PhotosClient({ groups }: { groups: ProjectPhotoGroup[] }) {
  const [open, setOpen] = useState<{ photo: ProjectPhoto; title: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!groups.length) {
    return <p className="py-20 text-center text-[12px] tracking-[0.1em] text-[#A8A8A4]">NO PROJECT PHOTOS YET. PICK A LOOK IN A PROJECT AND ITS HIGGSFIELD PHOTO LANDS HERE.</p>
  }

  return (
    <div className="space-y-10">
      {/* Jump to a project */}
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <a key={g.projectId} href={`#p-${g.projectId}`} className={`${CHIP} border-[#E2E0DB] text-[#4A4E57] hover:border-[#0A0A0A]`}>
            {g.title.toUpperCase()} <span className="opacity-50">{g.photos.length}</span>
          </a>
        ))}
      </div>

      {groups.map((g) => (
        <section key={g.projectId} id={`p-${g.projectId}`} className="scroll-mt-6">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-[14px] tracking-[0.1em] text-[#4A4E57]">{g.title.toUpperCase()}</h2>
            <a href={`/admin/outfit-review/projects/${g.projectId}`} className="text-[10px] tracking-[0.14em] text-[#6B6B6B] hover:text-[#0A0A0A] flex-shrink-0">OPEN PROJECT →</a>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
            {g.photos.map((p) => (
              <div key={p.key} className="min-w-0">
                <button type="button" onClick={() => { setOpen({ photo: p, title: g.title }); setCopied(false) }} className="relative block w-full aspect-[3/4] rounded-[10px] overflow-hidden bg-[#F2F2F0] group" aria-label={`Open photo from ${g.title}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbUrl(p.url, 700)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
                  {p.refused && <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[8px] tracking-[0.1em] text-[#B83A3A]">CHECK REFUSED</span>}
                </button>
                <Pieces photo={p} size="small" />
              </div>
            ))}
          </div>
        </section>
      ))}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setOpen(null)}>
          <div data-lenis-prevent className="bg-white rounded-[14px] w-full max-w-5xl max-h-[92vh] overflow-y-auto grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-6 p-5" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbUrl(open.photo.url, 1400)} alt="" className="w-full rounded-[10px] bg-[#F2F2F0] object-contain max-h-[84vh]" />
            <div className="space-y-5 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] tracking-[0.18em] text-[#A8A8A4]">PROJECT</p>
                  <p className="text-[14px] tracking-[0.08em] text-[#4A4E57]">{open.title.toUpperCase()}</p>
                  {open.photo.refused && <p className="mt-1 text-[10px] tracking-[0.1em] text-[#B83A3A]">MYRA&rsquo;S RENDER CHECK REFUSED THIS ONE — JUDGE IT YOURSELF</p>}
                </div>
                <button type="button" onClick={() => setOpen(null)} className="text-[22px] leading-none text-[#A8A8A4] hover:text-[#0A0A0A]" aria-label="Close">×</button>
              </div>
              <Pieces photo={open.photo} size="large" />
              <div className="flex flex-wrap gap-2 pt-1">
                <a href={downloadUrl(open.photo.url)} className="bg-[#0A0A0A] text-white px-5 py-2.5 text-[10px] tracking-[0.16em] rounded-full hover:opacity-85">DOWNLOAD</a>
                <a href={open.photo.url} target="_blank" rel="noreferrer" className="border border-[#0A0A0A] text-[#4A4E57] px-5 py-2.5 text-[10px] tracking-[0.16em] rounded-full hover:bg-[#0A0A0A] hover:text-white">FULL SIZE ↗</a>
                <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(open.photo.url); setCopied(true) } catch { setCopied(false) } }} className="border border-[#E2E0DB] text-[#6B6B6B] px-5 py-2.5 text-[10px] tracking-[0.16em] rounded-full hover:border-[#0A0A0A]">
                  {copied ? 'LINK COPIED' : 'COPY LINK'}
                </button>
                {open.photo.draftHref && <a href={open.photo.draftHref} className="border border-[#E2E0DB] text-[#6B6B6B] px-5 py-2.5 text-[10px] tracking-[0.16em] rounded-full hover:border-[#0A0A0A]">EDIT DRAFT →</a>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
