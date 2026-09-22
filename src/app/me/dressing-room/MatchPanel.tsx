'use client'

// FIND PIECES LIKE THIS — a pop-out that takes one picture (one she keeps, or
// one she uploads) and shows what MYRA holds nearest to it: pieces first, then
// outfits it has already made. Reads only; nothing is saved by looking.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import FallbackImage from '@/components/FallbackImage'
import { matchMyPicture, matchUploadedPhoto, type MatchView } from './match-actions'

const T = 'text-[clamp(20px,1.1vw,28px)]'
const T_SMALL = 'text-[clamp(18px,1vw,24px)]'
const PILL = `${T_SMALL} px-5 py-2.5 rounded-full bg-white text-[#2B2B2B] shadow-[0_8px_18px_-12px_rgba(43,43,43,0.5)] disabled:opacity-40`

export default function MatchPanel({
  source, testMemberId, onClose,
}: {
  /** One of her pictures to match, or 'upload' for a new one. */
  source: { kind: 'inspiration' | 'archival'; id: string; imageUrl?: string | null } | { kind: 'upload' }
  testMemberId?: string
  onClose: () => void
}) {
  const [view, setView] = useState<MatchView | null>(null)
  const [busy, setBusy] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [picture, setPicture] = useState<string | null>(source.kind === 'upload' ? null : source.imageUrl ?? null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (source.kind === 'upload') return
    let live = true
    setBusy(true)
    void matchMyPicture(source.kind, source.id, { asMemberId: testMemberId }).then((v) => {
      if (!live) return
      setView(v); setBusy(false)
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testMemberId])

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prev }
  }, [onClose])

  async function upload(file: File | null | undefined) {
    if (!file) return
    setPicture(URL.createObjectURL(file))
    setBusy(true)
    const fd = new FormData()
    fd.set('file', file)
    if (testMemberId) fd.set('member', testMemberId)
    setView(await matchUploadedPhoto(fd))
    setBusy(false)
  }

  if (!mounted) return null

  const close = (n: number) => `${Math.round(n * 100)}%`

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-[rgba(43,43,43,0.4)] backdrop-blur-[3px] overflow-y-auto" data-lenis-prevent>
      <div className="min-h-full flex items-start justify-center px-4 py-8" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <div role="dialog" aria-modal="true" aria-label="Find pieces like this"
          className="w-full max-w-[clamp(680px,72vw,1600px)] bg-white rounded-[28px] shadow-[0_30px_60px_-30px_rgba(43,43,43,0.55)] px-[clamp(22px,2.2vw,52px)] py-[clamp(22px,2vw,48px)] space-y-7">
          <div className="flex items-start justify-between gap-5">
            <div>
              <h2 className="text-[clamp(28px,2.2vw,52px)] leading-none text-[#1a1a1a]">Pieces like this</h2>
              <p className={`${T_SMALL} myra-guide-text text-[#6E6B65] mt-2`}>
                {view?.read ? view.read : 'MYRA reads the picture and finds what it holds nearest to it.'}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="shrink-0 w-[52px] h-[52px] rounded-full bg-[#F4F4F2] text-[26px] text-[#2B2B2B] hover:bg-[#E9E9E6]">×</button>
          </div>

          <div className="flex flex-wrap items-start gap-6">
            <div className="w-[clamp(150px,13vw,260px)] aspect-[3/4] rounded-[18px] overflow-hidden bg-[#F3F2F0] relative shrink-0">
              {picture && <FallbackImage src={picture} thumbWidth={600} alt="" className="absolute inset-0 w-full h-full object-cover" />}
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="myra-silver-button !w-auto px-7 !py-3 !inline-flex text-[clamp(19px,1.1vw,28px)]">
                {busy ? 'Looking…' : source.kind === 'upload' && !view ? 'Choose a picture' : 'Try another picture'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
            </div>
          </div>

          {view?.error && <p className={`${T} text-[#9B3A3A]`}>{view.error}</p>}
          {busy && !view && <p className={T}>MYRA is looking…</p>}

          {!!view?.items.length && (
            <section className="space-y-4">
              <h3 className={`${T} text-[#1a1a1a]`}>The closest pieces</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
                {view.items.map((it) => (
                  <a key={it.item_id} href={it.retailer_url ?? undefined} target={it.retailer_url ? '_blank' : undefined} rel="noreferrer"
                    className="group block">
                    <div className="relative aspect-[3/4] rounded-[14px] overflow-hidden bg-[#F3F2F0]">
                      {it.image_url && <FallbackImage src={it.image_url} thumbWidth={500} alt={it.product_name} className="absolute inset-0 w-full h-full object-cover" />}
                      <span className="absolute top-2 left-2 rounded-full bg-[rgba(255,255,255,0.92)] px-3 py-1 text-[16px] text-[#2B2B2B]">{close(it.closeness)}</span>
                      {it.owned && <span className="absolute top-2 right-2 rounded-full bg-[#2B2B2B] text-white px-3 py-1 text-[15px]">Yours</span>}
                    </div>
                    <p className={`${T_SMALL} myra-guide-text text-[#2B2B2B] mt-2 leading-tight line-clamp-2`}>{it.product_name}</p>
                    <p className={`${T_SMALL} text-[#6E6B65]`}>{[it.brand, it.price_gbp ? `£${Math.round(it.price_gbp)}` : null].filter(Boolean).join(' · ')}</p>
                  </a>
                ))}
              </div>
            </section>
          )}

          {!!view?.outfits.length && (
            <section className="space-y-4">
              <h3 className={`${T} text-[#1a1a1a]`}>Outfits MYRA has made like it</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                {view.outfits.map((o) => (
                  <div key={o.outfit_id} className="relative aspect-[3/4] rounded-[14px] overflow-hidden bg-[#F3F2F0]">
                    {o.image_url && <FallbackImage src={o.image_url} thumbWidth={500} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                    <span className="absolute top-2 left-2 rounded-full bg-[rgba(255,255,255,0.92)] px-3 py-1 text-[16px] text-[#2B2B2B]">{close(o.closeness)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {view && !view.items.length && !view.error && <p className={T}>Nothing close enough in the library yet.</p>}

          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={PILL}>Close</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
