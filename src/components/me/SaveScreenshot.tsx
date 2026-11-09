'use client'

// SAVE A SCREENSHOT — for anyone who shops without the Mirror. A button that
// takes a screenshot (chosen, or pasted anywhere on the page with ⌘V) and
// hands it to MYRA, which reads the piece, pins the real product when it can,
// and keeps it on her SAVED shelf — styled three ways, and fed into MORE OF
// THE SAME like any other save. One sheet shows the picture while MYRA reads
// it, then what it kept.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import FallbackImage from '@/components/FallbackImage'
import type { ScreenshotSaveResult } from '@/lib/screenshot-save'

/** Fired on window after a save, with the result's item — the shelf and FOR YOU refresh on it. */
export const PIECE_SAVED_EVENT = 'myra:piece-saved'

const T = 'text-[clamp(19px,1.1vw,27px)]'
const T_SMALL = 'text-[clamp(17px,1vw,23px)]'

export default function SaveScreenshot({
  testMemberId, variant = 'pill', className = '', children,
}: {
  testMemberId?: string
  /** pill: a silver button with the camera; quiet: an underlined line of text. */
  variant?: 'pill' | 'quiet'
  className?: string
  children?: ReactNode
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [picture, setPicture] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ScreenshotSaveResult | null>(null)
  const [openSheet, setOpenSheet] = useState(false)

  async function save(file: File | null | undefined) {
    if (!file || !file.type.startsWith('image/')) return
    setPicture(URL.createObjectURL(file))
    setResult(null); setBusy(true); setOpenSheet(true)
    const fd = new FormData()
    fd.set('file', file, file.name || 'screenshot.png')
    if (testMemberId) fd.set('member', testMemberId)
    // A route, not a server action: finding the piece can take a web search
    // and the eye's look, longer than the member pages' actions are allowed.
    let r: ScreenshotSaveResult
    try {
      const res = await fetch('/api/me/screenshot', { method: 'POST', body: fd, signal: AbortSignal.timeout(125_000) })
      r = (await res.json().catch(() => ({ error: 'MYRA could not keep that — try again' }))) as ScreenshotSaveResult
    } catch { r = { error: 'MYRA could not reach the server — try again' } }
    setResult(r); setBusy(false)
    if (r.saved && r.item) {
      try { window.dispatchEvent(new CustomEvent(PIECE_SAVED_EVENT, { detail: r.item })) } catch { /* no window */ }
    }
  }

  // A screenshot pasted anywhere on the page is a save: the gesture she
  // already knows from Messages. Only images; text pastes go where they went.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (!file) return
      e.preventDefault()
      void save(file)
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

  const label = children ?? 'SAVE A SCREENSHOT'
  const button = variant === 'quiet' ? (
    <button type="button" onClick={() => fileRef.current?.click()} className={`${T_SMALL} tracking-[0.08em] text-[#2B2B2B] underline underline-offset-4 ${className}`}>
      {label}
    </button>
  ) : (
    <button type="button" onClick={() => fileRef.current?.click()} className={`myra-silver-button !w-auto !inline-flex items-center gap-3 px-7 !py-3.5 text-[15px] sm:text-[19px] xl:text-[22px] tracking-[0.08em] uppercase ${className}`}>
      <CameraIcon />
      <span>{label}</span>
    </button>
  )

  return (
    <>
      {button}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void save(e.target.files?.[0]); e.target.value = '' }} />
      {openSheet && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[90] bg-[rgba(43,43,43,0.4)] backdrop-blur-[3px] overflow-y-auto" data-lenis-prevent>
          <div className="min-h-full flex items-end sm:items-center justify-center sm:px-4 sm:py-8" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpenSheet(false) }}>
            <div role="dialog" aria-modal="true" aria-label="Save a screenshot"
              className="w-full sm:max-w-[760px] bg-white rounded-t-[28px] sm:rounded-[28px] shadow-[0_30px_60px_-30px_rgba(43,43,43,0.55)] px-6 sm:px-10 pt-7 pb-[calc(28px+env(safe-area-inset-bottom))] sm:pb-9 space-y-6">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <h2 className="text-[clamp(26px,2vw,42px)] leading-none text-[#1a1a1a]">{busy ? 'MYRA is reading it' : result?.saved ? 'Kept' : 'Not kept'}</h2>
                  <p className={`${T_SMALL} myra-guide-text normal-case text-[#6E6B65] mt-2`}>
                    {busy ? 'Finding the piece, the label and the words a shop would use for it…'
                      : result?.saved ? (result.pinned ? 'MYRA found the real page for it, so its stock and price are watched too.' : 'MYRA kept your picture as the piece and will show you more like it.')
                      : result?.error ?? ''}
                  </p>
                </div>
                <button type="button" onClick={() => !busy && setOpenSheet(false)} aria-label="Close" disabled={busy}
                  className="shrink-0 w-[48px] h-[48px] rounded-full bg-[#F4F4F2] text-[24px] text-[#2B2B2B] hover:bg-[#E9E9E6] disabled:opacity-40">×</button>
              </div>

              <div className="flex items-start gap-5">
                <div className="w-[clamp(120px,24vw,200px)] aspect-[3/4] rounded-[18px] overflow-hidden bg-[#F3F2F0] relative shrink-0">
                  {(result?.item?.image_url || picture) && (
                    <FallbackImage src={result?.item?.image_url || picture!} thumbWidth={600} alt="" className={`absolute inset-0 w-full h-full object-cover ${busy ? 'animate-pulse' : ''}`} />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {result?.saved && result.item && (
                    <>
                      <p className={`${T} text-[#1a1a1a] leading-tight`}>{result.item.product_name}</p>
                      <p className={`${T_SMALL} text-[#6E6B65]`}>{[result.item.brand, result.item.price_gbp ? `£${Math.round(result.item.price_gbp)}` : null].filter(Boolean).join(' · ')}</p>
                      {result.read && <p className={`${T_SMALL} text-[#7C838B] normal-case`}>MYRA read: {result.read}</p>}
                    </>
                  )}
                  {busy && <p className={`${T_SMALL} text-[#7C838B]`}>A few seconds.</p>}
                  {!busy && result?.error && <p className={`${T_SMALL} text-[#9B3A3A]`}>Try a screenshot that shows the piece and its name clearly.</p>}
                </div>
              </div>

              {!busy && (
                <div className="flex flex-wrap gap-3">
                  {result?.saved && result.item && (
                    <Link href={`/me/dressing-room?tab=saved&piece=${result.item.item_id}`} onClick={() => setOpenSheet(false)}
                      className="inline-block text-[15px] sm:text-[19px] tracking-[0.06em] rounded-full bg-[#2B2B2B] text-white px-7 py-3">
                      SEE IT STYLED
                    </Link>
                  )}
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="inline-block text-[15px] sm:text-[19px] tracking-[0.06em] rounded-full border border-[#2B2B2B] text-[#2B2B2B] px-7 py-3">
                    {result?.saved ? 'SAVE ANOTHER' : 'TRY ANOTHER'}
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

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-[20px] h-[20px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8.5A1.5 1.5 0 015.5 7h2l1.2-2h6.6L16.5 7h2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5v-9z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  )
}
