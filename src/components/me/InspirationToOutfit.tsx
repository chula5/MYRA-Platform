'use client'

// INSPIRATION TO OUTFIT — the door on her Looks page.
//
// She drops in a picture of a look she loves (a runway exit, a street shot,
// a saved post; chosen, dropped, or pasted anywhere on the page). MYRA reads
// it while she watches, then styles outfits around it from pieces in her size
// and price range in the background; the sheet follows the work and, when the
// outfits land, opens them on her FROM YOUR INSPIRATION shelf.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import FallbackImage from '@/components/FallbackImage'
import type { InspirationStatusView } from '@/lib/member-inspiration'

const T = 'text-[clamp(19px,1.1vw,27px)]'
const T_SMALL = 'text-[clamp(17px,1vw,23px)]'
const POLL_MS = 4_000

type Reply = InspirationStatusView | { error: string; read?: string | null }
const failed = (r: Reply | null): r is { error: string; read?: string | null } => !!r && 'error' in r

export default function InspirationToOutfit({
  testMemberId, firstName, onLanded, className = '',
}: {
  testMemberId?: string
  firstName: string
  /** The outfits are on her page: open the shelf, narrowed to this picture's delivery. */
  onLanded: (deliveryId: string) => void
  className?: string
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [picture, setPicture] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<Reply | null>(null)
  const [openSheet, setOpenSheet] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const member = testMemberId ? `?member=${encodeURIComponent(testMemberId)}` : ''

  async function drop(file: File | null | undefined) {
    if (!file || !file.type.startsWith('image/')) return
    setPicture(URL.createObjectURL(file))
    setReply(null); setBusy(true); setOpenSheet(true)
    const fd = new FormData()
    fd.set('file', file, file.name || 'inspiration.png')
    if (testMemberId) fd.set('member', testMemberId)
    let r: Reply
    try {
      const res = await fetch('/api/me/inspiration', { method: 'POST', body: fd, signal: AbortSignal.timeout(125_000) })
      r = (await res.json().catch(() => ({ error: 'MYRA could not read that — try again' }))) as Reply
    } catch { r = { error: 'MYRA could not reach the server — try again' } }
    setReply(r); setBusy(false)
  }

  // Follow the styling until the outfits land (or it gives up).
  const status = !failed(reply) && reply ? reply.status : null
  const inspirationId = !failed(reply) && reply ? reply.inspiration_id : null
  useEffect(() => {
    if (!inspirationId || (status !== 'queued' && status !== 'running')) return
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/me/inspiration${member ? `${member}&` : '?'}id=${inspirationId}`, { cache: 'no-store' })
        const j = (await res.json()) as Reply
        if (!failed(j)) {
          setReply(j)
          if (j.status === 'done') router.refresh()
        }
      } catch { /* next poll */ }
    }, POLL_MS)
    return () => clearInterval(t)
  }, [inspirationId, status, member, router])

  // A picture pasted anywhere on the page, when no other door has taken it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.defaultPrevented) return
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (!file) return
      e.preventDefault()
      void drop(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testMemberId])

  useEffect(() => {
    if (!openSheet) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) setOpenSheet(false) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [openSheet, busy])

  const done = !failed(reply) && reply?.status === 'done'
  const gaveUp = !failed(reply) && reply?.status === 'failed'
  const working = !failed(reply) && (reply?.status === 'queued' || reply?.status === 'running')
  const heading = busy ? 'MYRA is reading your picture'
    : failed(reply) ? 'Not this one'
    : done ? `${reply!.looks_count} outfit${reply!.looks_count === 1 ? '' : 's'} in this style`
    : gaveUp ? 'Not this time'
    : working ? 'Styling it for you'
    : 'Inspiration to outfit'
  const line = busy ? 'The pieces, the cloths, the colours — a few seconds.'
    : failed(reply) ? reply.error
    : done ? `From pieces in your size and price range. They are on your looks page, on the FROM YOUR INSPIRATION shelf.`
    : gaveUp ? (reply!.error ?? 'MYRA could not style this picture.')
    : working ? `MYRA is finding pieces like these in your size and price range and checking each outfit — a minute or two. You can close this; they land on your looks page.`
    : ''

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void drop(e.dataTransfer.files?.[0]) }}
        className={className}
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={`w-full border border-dashed px-6 py-5 myra-field tracking-[0.14em] rounded-full transition-colors ${dragOver ? 'border-[#2B2B2B] bg-[#2B2B2B] text-white' : 'border-[#2B2B2B] bg-[rgba(255,255,255,0.18)] text-[#2B2B2B] hover:bg-[#2B2B2B] hover:text-white'}`}
        >
          {testMemberId ? `INSPIRATION TO OUTFIT — TEST AS ${firstName.toUpperCase()}` : 'INSPIRATION TO OUTFIT — DROP IN A LOOK YOU LOVE'}
        </button>
        <p className="myra-section-note mt-3 text-center">A RUNWAY EXIT, A STREET SHOT, A SAVED POST · MYRA STYLES IT FROM PIECES IN YOUR SIZE AND PRICE RANGE</p>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void drop(e.target.files?.[0]); e.target.value = '' }} />

      {openSheet && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[90] bg-[rgba(43,43,43,0.4)] backdrop-blur-[3px] overflow-y-auto" data-lenis-prevent>
          <div className="min-h-full flex items-end sm:items-center justify-center sm:px-4 sm:py-8" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpenSheet(false) }}>
            <div role="dialog" aria-modal="true" aria-label="Inspiration to outfit"
              className="w-full sm:max-w-[760px] bg-white rounded-t-[28px] sm:rounded-[28px] shadow-[0_30px_60px_-30px_rgba(43,43,43,0.55)] px-6 sm:px-10 pt-7 pb-[calc(28px+env(safe-area-inset-bottom))] sm:pb-9 space-y-6">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <h2 className="text-[clamp(26px,2vw,42px)] leading-none text-[#1a1a1a]">{heading}</h2>
                  <p className={`${T_SMALL} myra-guide-text normal-case text-[#6E6B65] mt-2`}>{line}</p>
                </div>
                <button type="button" onClick={() => !busy && setOpenSheet(false)} aria-label="Close" disabled={busy}
                  className="shrink-0 w-[48px] h-[48px] rounded-full bg-[#F4F4F2] text-[24px] text-[#2B2B2B] hover:bg-[#E9E9E6] disabled:opacity-40">×</button>
              </div>

              <div className="flex items-start gap-5">
                <div className="w-[clamp(120px,24vw,200px)] aspect-[3/4] rounded-[18px] overflow-hidden bg-[#F3F2F0] relative shrink-0">
                  {picture && (
                    <FallbackImage src={picture} thumbWidth={600} alt="" className={`absolute inset-0 w-full h-full object-cover ${busy || working ? 'animate-pulse' : ''}`} />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  {!failed(reply) && reply && (
                    <>
                      <p className={`${T} text-[#1a1a1a] leading-tight`}>{reply.title}</p>
                      {reply.summary && <p className={`${T_SMALL} text-[#7C838B] normal-case`}>MYRA read: {reply.summary}</p>}
                      {reply.pieces.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {reply.pieces.map((p, i) => (
                            <span key={i} className="px-3 py-1.5 text-[13px] sm:text-[15px] tracking-[0.08em] uppercase rounded-full border border-[#E2E0DB] text-[#4A4E57]">{p}</span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {busy && <p className={`${T_SMALL} text-[#7C838B]`}>A few seconds.</p>}
                  {failed(reply) && reply.read && <p className={`${T_SMALL} text-[#7C838B] normal-case`}>MYRA read: {reply.read}</p>}
                  {failed(reply) && <p className={`${T_SMALL} text-[#9B3A3A]`}>Try a picture that shows the whole outfit clearly.</p>}
                </div>
              </div>

              {!busy && (
                <div className="flex flex-wrap gap-3">
                  {done && !failed(reply) && reply.delivery_id && (
                    <button type="button" onClick={() => { setOpenSheet(false); onLanded(reply.delivery_id!) }}
                      className="inline-block text-[15px] sm:text-[19px] tracking-[0.06em] rounded-full bg-[#2B2B2B] text-white px-7 py-3">
                      SEE THE OUTFITS
                    </button>
                  )}
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="inline-block text-[15px] sm:text-[19px] tracking-[0.06em] rounded-full border border-[#2B2B2B] text-[#2B2B2B] px-7 py-3">
                    {done || working ? 'ANOTHER PICTURE' : 'TRY ANOTHER'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
