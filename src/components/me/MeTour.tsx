'use client'

// THE TOUR — after she has made her login and connected her accounts, MYRA
// walks her round: one button at a time is lit, with a sentence about what it
// does, and it moves between her pages by itself. Short sentences, her words.
// Lives in her layout so it survives the move from room to room; its place is
// kept in localStorage so a reload picks up where she was. While she reads,
// her email and photos keep being worked through in the background — by the
// end, more of her wardrobe is there.

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useScrollTo } from '@/lib/smooth-scroll'
import { markTourDone } from '@/app/me/welcome/actions'
import { scanNow } from '@/app/me/dressing-room/email-actions'
import { nudgeArchival } from '@/app/me/dressing-room/archival-actions'

const KEY = 'myra:tour'

/** Begin the tour from anywhere (her welcome page does this, then goes to /me). */
export function startTour() {
  try { localStorage.setItem(KEY, '0') } catch { /* private window */ }
  window.dispatchEvent(new Event('myra:tour'))
}

interface Step { path?: string; target?: string; fallback?: string; title: string; body: string }

const DRESSING = '/me/dressing-room'
const STEPS: Step[] = [
  { path: '/me', target: '[data-tour="rooms"]', title: 'YOUR ROOMS', body: 'Everything in MYRA lives in these rooms. Here is what each one is for — it takes about a minute.' },
  { path: '/me', target: '[data-tour="room-for_you"]', title: 'FOR YOU', body: 'Where you land. Outfits MYRA has put together for you, built around what you own. Say yes or no to each one — it learns from both.' },
  { path: '/me', target: '[data-tour="room-all_looks"]', title: 'YOUR LOOKS', body: 'Every outfit you have said yes to, sorted by occasion — so it is there on the morning you need it.' },
  { path: DRESSING, target: '[data-tour="wardrobe"]', title: 'YOUR WARDROBE', body: 'Your own pieces. Tap any one and MYRA stands it up on the right with the outfits it already belongs to.' },
  { path: DRESSING, target: '[data-tour="styling-pane"]', title: 'STYLED FOR YOU', body: 'The outfits around the piece you tapped. BUILD NEW OUTFITS makes fresh ones — it takes a moment, because each is checked before you see it.' },
  { path: DRESSING, target: '[data-tour="email-sync"]', fallback: '#email-finds', title: 'UPDATE EMAIL SYNC', body: 'Reads your order emails again and finds what you have bought since, ready to add to your wardrobe.' },
  { path: DRESSING, target: '#archival-looks', title: 'ARCHIVAL LOOKS', body: 'Photos of what you already wear. MYRA learns how you put things together, and picks out the pieces — tap Add to wardrobe for the ones you still own.' },
  { path: DRESSING, target: '#email-finds', title: 'FIND WHAT YOU’VE BOUGHT', body: 'Pieces MYRA found in your order emails. Add the ones you kept; leave the ones that went back.' },
  { target: '[data-tour="room-inspiration"]', title: 'INSPIRATION', body: 'Outfits you love. Paste a screenshot or drop pictures in — MYRA reads them to understand where your taste is heading.' },
  { target: '[data-tour="room-magazine"]', title: 'MYRA MAGAZINE', body: 'The brand emails you already subscribe to, read for you and set like a magazine. A minute to read, not an inbox to clear.' },
  { target: '[data-tour="room-threads"]', title: 'THREADS', body: 'Everything MYRA believes about how you dress, and where each idea came from. Nothing it knows about you is hidden from you.' },
  { target: '[data-tour="search"]', title: 'SEARCH', body: 'Ask in your own words — “something for a wedding in June” — and MYRA looks through your looks, your pieces and your inspiration.' },
  { target: '[data-tour="you"]', title: 'YOU', body: 'Your sizes, your preferences and your account. Keeping your sizes right is what keeps every suggestion wearable.' },
  { title: 'THAT’S EVERYTHING', body: 'Your wardrobe is still filling in from your email and photos — give it a few minutes. When you are ready, start in your Dressing Room.' },
]

interface Box { top: number; left: number; width: number; height: number }

export default function MeTour() {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const scrollTo = useScrollTo()
  const [step, setStep] = useState<number | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [ready, setReady] = useState(false)
  const el = useRef<Element | null>(null)

  // Pick the tour up: a fresh start, a reload mid-tour, or ?tour=1.
  useEffect(() => {
    const read = () => {
      try {
        if (new URLSearchParams(window.location.search).get('tour') === '1') localStorage.setItem(KEY, '0')
        const v = localStorage.getItem(KEY)
        setStep(v != null && /^\d+$/.test(v) ? Math.min(Number(v), STEPS.length - 1) : null)
      } catch { setStep(null) }
    }
    read()
    window.addEventListener('myra:tour', read)
    return () => window.removeEventListener('myra:tour', read)
  }, [])

  const finish = useCallback(() => {
    try { localStorage.removeItem(KEY) } catch { /* ignore */ }
    setStep(null); setBox(null)
    void markTourDone().catch(() => undefined)
  }, [])

  const go = useCallback((n: number) => {
    if (n < 0) return
    if (n >= STEPS.length) { finish(); return }
    try { localStorage.setItem(KEY, String(n)) } catch { /* ignore */ }
    setReady(false); setBox(null); el.current = null
    setStep(n)
    // Keep her wardrobe filling in while she reads.
    if (n % 3 === 1) { void scanNow().catch(() => undefined); void nudgeArchival().catch(() => undefined) }
  }, [finish])

  // Be on the right page, find the thing, bring it into view.
  useEffect(() => {
    if (step == null) return
    const s = STEPS[step]
    if (s.path && pathname !== s.path) { router.push(s.path); return }
    if (!s.target) { setReady(true); return }
    let live = true
    let tries = 0
    const find = () => {
      if (!live) return
      const found = document.querySelector(s.target!) ?? (s.fallback ? document.querySelector(s.fallback) : null)
      if (found && (found as HTMLElement).getBoundingClientRect().width > 0) {
        el.current = found
        if (!found.closest('header')) {
          const r = found.getBoundingClientRect()
          const headerH = (document.querySelector('header') as HTMLElement | null)?.getBoundingClientRect().height ?? 0
          const inView = r.top >= headerH + 16 && r.top <= window.innerHeight * 0.45
          if (!inView) scrollTo(found as HTMLElement, { offset: -(headerH + 32) })
        }
        setReady(true)
        return
      }
      if (++tries > 28) { setReady(true); return } // not on this screen — say the sentence anyway
      setTimeout(find, 250)
    }
    find()
    return () => { live = false }
  }, [step, pathname, router, scrollTo])

  // Follow the lit button as the page settles or scrolls.
  useEffect(() => {
    if (step == null || !ready) return
    let raf = 0
    const tick = () => {
      const e = el.current as HTMLElement | null
      if (e && e.isConnected) {
        const r = e.getBoundingClientRect()
        const pad = 10
        const vis = { top: Math.max(8, r.top - pad), left: Math.max(8, r.left - pad) }
        const next = {
          top: vis.top, left: vis.left,
          width: Math.min(window.innerWidth - 8, r.right + pad) - vis.left,
          height: Math.min(window.innerHeight - 8, r.bottom + pad) - vis.top,
        }
        setBox((b) => (b && Math.abs(b.top - next.top) < 1 && Math.abs(b.left - next.left) < 1 && Math.abs(b.width - next.width) < 1 && Math.abs(b.height - next.height) < 1 ? b : next))
      } else setBox(null)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [step, ready])

  useEffect(() => {
    if (step == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      if (e.key === 'ArrowRight' || e.key === 'Enter') go(step + 1)
      if (e.key === 'ArrowLeft') go(step - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, go, finish])

  if (step == null) return null
  const s = STEPS[step]
  const last = step === STEPS.length - 1
  const lit = ready && box && box.height > 4

  // Where the sentence sits: under the lit thing when there is room, else over it, else low and central.
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1400
  const cardW = Math.min(560, vw - 32)
  let cardStyle: React.CSSProperties = { left: (vw - cardW) / 2, bottom: 40, width: cardW }
  if (lit) {
    const left = Math.max(16, Math.min(vw - cardW - 16, box.left + box.width / 2 - cardW / 2))
    if (box.top + box.height + 300 < vh) cardStyle = { left, top: box.top + box.height + 18, width: cardW }
    else if (box.top > 320) cardStyle = { left, bottom: vh - box.top + 18, width: cardW }
  } else if (!s.target) cardStyle = { left: (vw - cardW) / 2, top: '50%', transform: 'translateY(-50%)', width: cardW }

  return (
    <div className="fixed inset-0 z-[300]" role="dialog" aria-modal="true" aria-label="A look around MYRA">
      {/* Her taps land here, not on the page underneath, while she is being shown round. */}
      <div className="absolute inset-0" style={{ background: lit ? 'transparent' : 'rgba(20,20,20,0.6)' }} />
      {lit && (
        <div
          className="absolute rounded-[20px] pointer-events-none transition-[top,left,width,height] duration-200 ease-out"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height, boxShadow: '0 0 0 9999px rgba(20,20,20,0.6), 0 0 0 2px rgba(255,255,255,0.95)' }}
        />
      )}
      <div className="absolute bg-[#F7F6F3] rounded-[22px] shadow-[0_18px_60px_rgba(0,0,0,0.35)] px-7 py-6" style={cardStyle}>
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[20px] xl:text-[22px] tracking-[0.16em] text-[#2B2B2B]">{s.title}</p>
          <p className="text-[18px] text-[#6E6B65] shrink-0">{step + 1} of {STEPS.length}</p>
        </div>
        <p className="mt-3 text-[22px] xl:text-[24px] leading-snug text-[#2B2B2B]">{s.body}</p>
        <div className="mt-5 flex items-center justify-between gap-4">
          <button onClick={finish} className="text-[18px] underline underline-offset-4 text-[#6E6B65]">{last ? 'Close' : 'Skip the tour'}</button>
          <div className="flex items-center gap-3">
            {step > 0 && <button onClick={() => go(step - 1)} className="text-[20px] px-6 py-3 border border-[#2B2B2B] text-[#2B2B2B] rounded-full">Back</button>}
            <button
              onClick={() => { if (last) { finish(); router.push(DRESSING) } else go(step + 1) }}
              className="text-[20px] tracking-[0.06em] px-7 py-3 bg-[#2B2B2B] text-white rounded-full"
            >
              {last ? 'Take me to my Dressing Room →' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
