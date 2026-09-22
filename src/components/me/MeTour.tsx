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

interface Step {
  path?: string
  target?: string
  fallback?: string
  title: string
  body: string
  /** Something to do from the step itself, not only read about. */
  cta?: { label: string; href: string }
}

/** The mirror's listing, once it is published; until then, her connect page. */
const MIRROR_HREF = process.env.NEXT_PUBLIC_MIRROR_STORE_URL || '/me/welcome'

const DRESSING = '/me/dressing-room'
const STEPS: Step[] = [
  { path: '/me', target: '[data-tour="rooms"]', title: 'YOUR ROOMS', body: 'Everything lives in these rooms. A one minute look around.' },
  { path: '/me', target: '[data-tour="room-for_you"]', title: 'FOR YOU', body: 'Outfits made for you. Say yes or no and MYRA learns.' },
  { path: '/me', target: '[data-tour="room-all_looks"]', title: 'YOUR LOOKS', body: 'Every outfit you said yes to, sorted by occasion.' },
  { path: '/me/looks', target: '[data-tour="look-open"]', title: 'OPEN A LOOK', body: 'Tap a look to open it. Flick through each piece, then back to the outfit.' },
  { path: '/me/looks', target: '[data-tour="look-source"]', fallback: '[data-tour="look-open"]', title: 'SOURCE ITEMS', body: 'Every piece in the look, and where to buy it.' },
  { path: '/me/looks', target: '[data-tour="look-similar"]', fallback: '[data-tour="look-open"]', title: 'SIMILAR LOOKS', body: 'More looks like this one.' },
  { path: '/me/looks', target: '[data-tour="look-explore"]', fallback: '[data-tour="look-open"]', title: 'EXPLORE STYLES', body: 'The same kind of piece, styled a different way.' },
  { path: '/me/looks', target: '[data-tour="look-open"] button[aria-label^="Style "]', fallback: '[data-tour="look-open"]', title: 'STYLE ITEM', body: 'The see-through circles on a look. Tap one to see that piece in other outfits.' },
  { path: DRESSING, target: '[data-tour="wardrobe"]', title: 'YOUR WARDROBE', body: 'Your own pieces. Tap one to see it styled.' },
  { path: DRESSING, target: '[data-tour="styling-pane"]', title: 'STYLED FOR YOU', body: 'Outfits around the piece you tapped. Build new ones here.' },
  { path: DRESSING, target: '[data-tour="email-sync"]', fallback: '#email-finds', title: 'UPDATE EMAIL SYNC', body: 'Finds what you have bought from your order emails.' },
  { path: DRESSING, target: '#coming-up', title: 'COMING UP', body: 'Your calendar. Tap Plan an outfit for anything you want dressed.' },
  { path: DRESSING, target: '#archival-looks', title: 'ARCHIVAL LOOKS', body: 'Photos of what you already wear. Add the pieces you still own.' },
  { path: DRESSING, target: '#email-finds', title: 'FIND WHAT YOU\u2019VE BOUGHT', body: 'Pieces from your order emails. Add the ones you kept.' },
  { target: '[data-tour="room-inspiration"]', title: 'INSPIRATION', body: 'Save outfits you love. MYRA learns your taste from them.' },
  { target: '[data-tour="room-magazine"]', title: 'MYRA MAGAZINE', body: 'Your brand emails, read for you in a minute.' },
  { target: '[data-tour="room-threads"]', title: 'THREADS', body: 'Everything MYRA knows about your style, and why.' },
  { target: '[data-tour="search"]', title: 'SEARCH', body: 'Ask in your own words. Try \u201ca wedding in June\u201d.' },
  { target: '[data-tour="you"]', title: 'YOU', body: 'Your sizes, preferences and account.' },
  { path: '/me/profile', target: '[data-tour="brands"]', title: 'YOUR BRANDS', body: 'The brands you love, and what MYRA found from them. Add one any time.' },
  {
    title: 'MYRA WHERE YOU SHOP',
    body: 'Add MYRA to your browser and every shop you open is in your order — keep a piece, or ask what to wear with it, without leaving the shop.',
    cta: { label: 'Add MYRA to my browser', href: MIRROR_HREF },
  },
  { title: 'THAT\u2019S EVERYTHING', body: 'Your wardrobe is still filling in. Start on your For You page.' },
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
  const cardW = Math.min(Math.max(560, vw * 0.36), 1040, vw - 32)
  const cardH = cardW * 0.42 // roughly: a title, two lines, a row of buttons
  let cardStyle: React.CSSProperties = { left: (vw - cardW) / 2, bottom: 40, width: cardW }
  if (lit) {
    const left = Math.max(16, Math.min(vw - cardW - 16, box.left + box.width / 2 - cardW / 2))
    if (box.top + box.height + cardH + 40 < vh) cardStyle = { left, top: box.top + box.height + 18, width: cardW }
    else if (box.top > cardH + 40) cardStyle = { left, bottom: vh - box.top + 18, width: cardW }
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
      <div className="absolute bg-[#F7F6F3] rounded-[22px] shadow-[0_18px_60px_rgba(0,0,0,0.35)] px-[clamp(28px,1.8vw,56px)] py-[clamp(24px,1.5vw,48px)]" style={cardStyle}>
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[clamp(22px,1.25vw,38px)] tracking-[0.16em] text-[#2B2B2B]">{s.title}</p>
          <p className="text-[clamp(18px,1vw,30px)] text-[#6E6B65] shrink-0">{step + 1} of {STEPS.length}</p>
        </div>
        <p className="mt-[0.5em] text-[clamp(27px,1.6vw,48px)] leading-snug text-[#2B2B2B]">{s.body}</p>
        {s.cta && (
          <a
            href={s.cta.href}
            target={s.cta.href.startsWith('http') ? '_blank' : undefined}
            rel={s.cta.href.startsWith('http') ? 'noopener noreferrer' : undefined}
            className="mt-[0.9em] inline-block text-[clamp(22px,1.2vw,36px)] tracking-[0.06em] px-[1.3em] py-[0.55em] rounded-full bg-white text-[#2B2B2B] shadow-[0_10px_24px_-16px_rgba(43,43,43,0.7)]"
          >
            {s.cta.label} →
          </a>
        )}
        <div className="mt-[1em] flex items-center justify-between gap-4 text-[clamp(22px,1.2vw,36px)]">
          <button onClick={finish} className="text-[clamp(20px,1.1vw,32px)] underline underline-offset-4 text-[#6E6B65]">{last ? 'Close' : 'Skip the tour'}</button>
          <div className="flex items-center gap-3">
            {step > 0 && <button onClick={() => go(step - 1)} className="text-[clamp(22px,1.2vw,36px)] px-[1.2em] py-[0.55em] border border-[#2B2B2B] text-[#2B2B2B] rounded-full">Back</button>}
            <button
              onClick={() => { if (last) { finish(); router.push('/me') } else go(step + 1) }}
              className="text-[clamp(22px,1.2vw,36px)] tracking-[0.06em] px-[1.3em] py-[0.55em] bg-[#2B2B2B] text-white rounded-full"
            >
              {last ? 'Take me to For You →' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
