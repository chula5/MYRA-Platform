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
import { inNativeApp } from '@/components/me/AppFirstOpen'

const KEY = 'myra:tour'

/** Begin the tour from anywhere (her welcome page does this, then goes to /me). */
export function startTour() {
  try { localStorage.setItem(KEY, '0') } catch { /* private window */ }
  window.dispatchEvent(new Event('myra:tour'))
}

/** Which part of the example look a step is about. */
type DemoPart = 'open' | 'source' | 'similar' | 'explore' | 'style'

interface Step {
  /** The page the step is on (matched against the pathname). */
  path?: string
  /** Where to send her when it is a tab of that page (`/me/profile?tab=threads`). */
  href?: string
  target?: string
  fallback?: string
  /** The Dressing Room shelf this step is about — opened before the target is looked for. */
  tab?: 'wardrobe' | 'saved' | 'email'
  /** The step is told over the example look instead of lighting something on the page. */
  demo?: DemoPart
  title: string
  body: string
  /** Something to do from the step itself, not only read about. */
  cta?: { label: string; href: string }
  /** Said differently inside the iPhone app, where the Mirror came with the app. */
  app?: { body: string; cta?: { label: string; href: string } }
}

/** The mirror's listing, once it is published; until then, her connect page. */
const MIRROR_HREF = process.env.NEXT_PUBLIC_MIRROR_STORE_URL || '/me/welcome'

const DRESSING = '/me/dressing-room'
const PROFILE = '/me/profile'
// In the order of the rooms across her screen. Checked against the pages on
// 2026-10-17: Inspiration and Threads live under YOU now, Coming Up is in
// EVENTS, the shelves are Your wardrobe / Saved pieces / Email finds, and the
// look buttons are shown on an example look, since a new member has no looks
// of her own yet to show them on.
const STEPS: Step[] = [
  { path: '/me', target: '[data-tour="rooms"]', title: 'YOUR ROOMS', body: 'Everything lives in these rooms. A one minute look around.' },
  { path: '/me', target: '[data-tour="room-for_you"]', title: 'FOR YOU', body: 'What MYRA did while you shopped: more of the same, more from your brands, and your saved pieces styled.' },
  { path: '/me', target: '[data-tour="room-browse"]', title: 'BROWSE', body: 'Ask for anything in your own words.' },
  { path: '/me/browse', target: '[data-tour="browse-search"]', title: 'SEARCH THROUGH MYRA', body: 'Try \u201ca wedding in June\u201d, typed or spoken. Then style what you find with your wardrobe or with something new.' },
  { path: '/me', target: '[data-tour="room-all_looks"]', title: 'LOOKS', body: 'Every outfit MYRA made for you. Thumbs up or down and MYRA learns; the ones you loved, sorted by occasion.' },
  { path: '/me/looks', demo: 'open', title: 'A LOOK', body: 'Every outfit is a card like this one. Tap the picture to open it and flick through each piece.' },
  { path: '/me/looks', demo: 'source', title: 'SOURCE ITEMS', body: 'Every piece in the look, and where to buy it in your size.' },
  { path: '/me/looks', demo: 'similar', title: 'SIMILAR LOOKS', body: 'More looks like this one.' },
  { path: '/me/looks', demo: 'explore', title: 'EXPLORE STYLES', body: 'The same kind of pieces, styled a different way.' },
  { path: '/me/looks', demo: 'style', title: 'STYLE ITEM', body: 'The see-through circles on the photo. Tap one to see that piece in other outfits.' },
  { path: '/me', target: '[data-tour="room-dressing_room"]', title: 'DRESSING ROOM', body: 'Your own pieces, the ones you saved while shopping, and what your order emails turned up.' },
  { path: DRESSING, tab: 'wardrobe', target: '[data-tour="wardrobe"]', fallback: '[data-tour="tab-wardrobe"]', title: 'YOUR WARDROBE', body: 'Your own pieces. Tap one to see it styled.' },
  { path: DRESSING, tab: 'wardrobe', target: '[data-tour="styling-pane"]', fallback: '[data-tour="tab-wardrobe"]', title: 'STYLED FOR YOU', body: 'Outfits around the piece you tapped. Build new ones here.' },
  { path: DRESSING, tab: 'saved', target: '[data-tour="tab-saved"]', title: 'SAVED PIECES', body: 'Pieces you kept with the MYRA Mirror while shopping, each styled three ways.' },
  { path: DRESSING, tab: 'email', target: '[data-tour="email-sync"]', fallback: '[data-tour="tab-email"]', title: 'SYNC YOUR EMAIL', body: 'The Gmail circle. MYRA reads your order emails and finds what you have bought. Instagram and Photos beside it bring in what you already wear.' },
  { path: DRESSING, tab: 'email', target: '#email-finds', fallback: '[data-tour="tab-email"]', title: 'EMAIL FINDS', body: 'Pieces from your order emails. Add the ones you kept.' },
  { path: '/me', target: '[data-tour="room-events"]', title: 'EVENTS', body: 'Your calendar. Three outfits for each day worth dressing for, every Monday.' },
  { path: '/me/events', target: '[data-tour="coming-up"]', fallback: '[data-tour="events"]', title: 'COMING UP', body: 'What is in your diary. Add anything you want dressed and MYRA has options ready.' },
  { target: '[data-tour="you"]', title: 'YOU', body: 'Your sizes, your brands, your inspiration and what MYRA has learned.' },
  { path: PROFILE, href: PROFILE, target: '[data-tour="brands"]', title: 'YOUR BRANDS', body: 'The brands you love, and what MYRA found from them. Add one any time.' },
  { path: PROFILE, href: `${PROFILE}?tab=inspiration`, target: '[data-tour="inspiration"]', title: 'INSPIRATION', body: 'Save outfits you love. MYRA learns your taste from them.' },
  { path: PROFILE, href: `${PROFILE}?tab=inspiration`, target: '#archival-looks', fallback: '[data-tour="inspiration"]', title: 'ARCHIVAL LOOKS', body: 'Photos of what you already wear. The pieces you still own go to your Dressing Room.' },
  { path: PROFILE, href: `${PROFILE}?tab=threads`, target: '[data-tour="threads"]', title: 'THREADS', body: 'Everything MYRA knows about your style, and why.' },
  { target: '[data-tour="sharing"]', title: 'SHARING', body: 'Friends on MYRA. Send them a look or a piece and talk it over.' },
  {
    title: 'MYRA WHERE YOU SHOP',
    body: 'Add MYRA to your browser and every shop you open is in your order — keep a piece, or ask what to wear with it, without leaving the shop.',
    cta: { label: 'Add MYRA to my browser', href: MIRROR_HREF },
    app: {
      body: 'MYRA Mirror came with this app. Turn it on in Settings → Apps → Safari → Extensions, connect it once from YOU, and every shop you open in Safari is in your order — keep a piece, or ask what to wear with it, without leaving the shop.',
      cta: { label: 'Show me where', href: '/me/profile#mirror' },
    },
  },
  {
    path: PROFILE,
    href: PROFILE,
    target: '#assistant',
    title: 'MYRA IN CLAUDE',
    body: 'Want to ask MYRA for outfits inside Claude or ChatGPT? Make your link here and paste it in as a connector. It lives under YOU, so you can do it whenever you like.',
    cta: { label: 'Take me to it', href: '/me/profile#assistant' },
  },
  { title: 'THAT\u2019S EVERYTHING', body: 'Your wardrobe is still filling in. Start on your For You page.' },
]

/**
 * The example look the tour talks over: one of MYRA's own outfits, with every
 * button a look card has. Nothing here does anything; the ring says which part
 * the step is about. The classes are the Looks page card's, so it is the real
 * thing she will see.
 */
const DEMO_ACTION = 'pointer-events-none text-[13px] sm:text-[clamp(15px,1.05vw,32px)] tracking-[0.1em] uppercase font-light myra-action'
const DEMO_SPOTS = [
  { label: 'BLAZER', x: 58, y: 38 },
  { label: 'TROUSERS', x: 55, y: 70 },
  { label: 'BAG', x: 72, y: 71 },
]
function DemoLook({ part }: { part: DemoPart }) {
  const lit = (p: DemoPart) => (part === p ? ' myra-tour-lit' : '')
  return (
    <div className={`relative aspect-[3/4] h-full overflow-hidden rounded-[14px] bg-[#EDEDED] shadow-[0_18px_60px_rgba(0,0,0,0.35)]${lit('open')}`} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/tour/example-look.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      {DEMO_SPOTS.map((h, i) => (
        <div key={h.label} className="absolute" style={{ left: `${h.x}%`, top: `${h.y}%`, transform: 'translate(-50%, -50%)' }}>
          <span className={`block w-7 h-7 rounded-full bg-white/40 backdrop-blur-sm border border-white/70 shadow-[0_1px_4px_rgba(0,0,0,0.15)] transition-opacity duration-500 ${part === 'style' ? 'opacity-100' : 'opacity-0'}${i === 0 ? lit('style') : ''}`} />
          {part === 'style' && i === 0 && (
            <span className="absolute top-1/2 -translate-y-1/2 right-full mr-3 flex items-center bg-[#9B9B9B]/30 backdrop-blur-md border border-white/40 rounded-full px-2.5 py-1 whitespace-nowrap">
              <span className="text-[13px] sm:text-[15px] tracking-[0.068em] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
                STYLE {h.label}{' '}
                <svg viewBox="0 0 12 12" className="inline-block w-2.5 h-2.5 -mt-px" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5 8.5 3.5M4.7 3.5h3.8v3.8" /></svg>
              </span>
            </span>
          )}
        </div>
      ))}
      <div className="absolute inset-x-0 bottom-0 pt-10 pb-3.5 px-3 bg-gradient-to-t from-black/55 via-black/20 to-transparent">
        <div className="flex flex-nowrap items-center justify-center gap-x-2 sm:gap-x-3 gap-y-2">
          <span className={DEMO_ACTION + lit('source')}>Source Items</span>
          <span className={DEMO_ACTION + lit('similar')}>Similar Looks</span>
        </div>
        <div className="flex justify-center mt-2.5">
          <span className={DEMO_ACTION + lit('explore')}>Explore Styles</span>
        </div>
      </div>
    </div>
  )
}

interface Box { top: number; left: number; width: number; height: number }

export default function MeTour() {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const scrollTo = useScrollTo()
  const [step, setStep] = useState<number | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [ready, setReady] = useState(false)
  const [native, setNative] = useState(false)
  useEffect(() => { setNative(inNativeApp()) }, [])
  const el = useRef<Element | null>(null)
  /** The last step the tour moved her for, so a redirected route cannot loop. */
  const moved = useRef<number | null>(null)

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
    // A step whose route now redirects somewhere else (a room that moved)
    // would send her round in a circle: move her once, then say the sentence
    // where she is.
    if (s.path && pathname !== s.path && moved.current !== step) {
      moved.current = step
      router.push(s.href ?? s.path)
      return
    }
    // Same page, another tab of it: go there once and keep looking for the thing.
    if (s.href && moved.current !== step && `${pathname}${window.location.search}` !== s.href) {
      moved.current = step
      router.push(s.href)
    }
    if (!s.target) { setReady(true); return }
    // A Dressing Room step: open its shelf first (DressingRoomClient listens).
    if (s.tab) window.dispatchEvent(new CustomEvent('myra:dressing-tab', { detail: s.tab }))
    let live = true
    let tries = 0
    const find = () => {
      if (!live) return
      // The desktop header and the phone's slim one are both in the DOM with
      // the same data-tour marks — light the one she can actually see.
      const visible = (sel: string): Element | null =>
        Array.from(document.querySelectorAll(sel)).find((e) => (e as HTMLElement).getBoundingClientRect().width > 0) ?? null
      const found = visible(s.target!) ?? (s.fallback ? visible(s.fallback) : null)
      if (found) {
        el.current = found
        if (!found.closest('header')) {
          const r = found.getBoundingClientRect()
          const headerH = (document.querySelector('header') as HTMLElement | null)?.getBoundingClientRect().height ?? 0
          const inView = r.top >= headerH + 16 && r.top <= window.innerHeight * 0.45
          if (!inView) {
            scrollTo(found as HTMLElement, { offset: -(headerH + 32) })
            // Lenis sometimes leaves a long page where it was (MYRA IN CLAUDE sits
            // 6,000px down YOU), and it also holds back a native smooth scroll;
            // a moment later, if the thing is still out of sight, jump to it the
            // plain way — Lenis follows an instant native scroll.
            setTimeout(() => {
              if (!live || el.current !== found) return
              const r2 = found.getBoundingClientRect()
              if (r2.top < headerH || r2.top > window.innerHeight * 0.6) {
                window.scrollTo({ top: r2.top + window.scrollY - (headerH + 32), behavior: 'auto' })
              }
            }, 700)
          }
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
  const body = native && s.app ? s.app.body : s.body
  const cta = native && s.app ? s.app.cta : s.cta
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

  const card = (
      <div className={`bg-[#F7F6F3] rounded-[22px] shadow-[0_18px_60px_rgba(0,0,0,0.35)] px-[clamp(28px,1.8vw,56px)] py-[clamp(24px,1.5vw,48px)] ${s.demo ? 'relative shrink-0' : 'absolute'}`} style={s.demo ? { width: cardW } : cardStyle}>
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[clamp(22px,1.25vw,38px)] tracking-[0.16em] text-[#2B2B2B]">{s.title}</p>
          <p className="text-[clamp(18px,1vw,30px)] text-[#6E6B65] shrink-0">{step + 1} of {STEPS.length}</p>
        </div>
        <p className="mt-[0.5em] text-[clamp(27px,1.6vw,48px)] leading-snug text-[#2B2B2B]">{body}</p>
        {cta && (
          <a
            href={cta.href}
            target={cta.href.startsWith('http') ? '_blank' : undefined}
            rel={cta.href.startsWith('http') ? 'noopener noreferrer' : undefined}
            className="mt-[0.9em] inline-block text-[clamp(22px,1.2vw,36px)] tracking-[0.06em] px-[1.3em] py-[0.55em] rounded-full bg-white text-[#2B2B2B] shadow-[0_10px_24px_-16px_rgba(43,43,43,0.7)]"
          >
            {cta.label} →
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
  )

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
      {s.demo ? (
        // The example look stands beside the sentence (above it on a phone).
        <div className="absolute inset-0 flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8 p-4 overflow-y-auto">
          <div className="h-[min(42vh,520px)] md:h-[min(72vh,820px)] shrink-0"><DemoLook part={s.demo} /></div>
          {card}
        </div>
      ) : card}
    </div>
  )
}
