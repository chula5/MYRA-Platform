'use client'

// HER FIRST TWO MINUTES, in two phases.
//
// FIRST, THE BRANDS SHE LOVES. It comes before connecting anything because it
// is the only part she can finish on her own, in ten seconds, with no account
// to authorise — and because it is the single largest thing MYRA can learn
// about her. Naming three brands seeds her whole taste model; connecting a
// mailbox that has to be scanned does not pay her back for minutes. Skippable,
// like everything else here, and she can change it all later in YOU.
//
// THEN, CONNECT YOUR ACCOUNTS. Four round icons, not cards of text: Instagram,
// email, calendar, photos. Hovering one says what MYRA does with it; a tick
// shows what is connected. All optional, so the way past sits above them,
// loud. All live on in her Dressing Room.
//
// THEN, MYRA WHERE SHE SHOPS. The Mirror is how MYRA comes to know her — every
// shop she opens in her order, a piece styled without leaving the shop — so it
// is a page of its own, not an icon she might not tap: the steps for the
// device in her hand (the iPhone app, where the extension came with the app;
// Safari on an iPhone; Chrome on a laptop), then the tour.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import BrandPicker from '@/components/me/BrandPicker'
import InfluencePicker from '@/components/me/InfluencePicker'
import VirginConnect from '../dressing-room/VirginConnect'
import InstagramImport from '../dressing-room/InstagramImport'
import { loadEmailPanel, scanNow, type EmailPanelView } from '../dressing-room/email-actions'
import { loadArchivalPanel, syncArchivalInstagram, uploadArchivalPhoto, nudgeArchival, type ArchivalPanelView } from '../dressing-room/archival-actions'
import { loadCalendarPanel, syncMyCalendar, type CalendarPanelView } from '../dressing-room/calendar-actions'
import { startTour } from '@/components/me/MeTour'
import { inNativeApp, APP_WELCOMED_KEY } from '@/components/me/AppFirstOpen'
import { markWelcomed } from './actions'

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
// The Chrome Web Store listing for the MYRA Mirror extension, once published.
const MIRROR_STORE_URL = process.env.NEXT_PUBLIC_MIRROR_STORE_URL ?? ''
const MIRROR_IOS_URL = process.env.NEXT_PUBLIC_MIRROR_IOS_URL ?? ''
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.myraassistant.co.uk').replace(/\/+$/, '')
const BODY = 'text-[clamp(22px,1.35vw,40px)]'
const PILL = 'text-[clamp(21px,1.2vw,32px)] inline-block px-[1.3em] py-[0.6em] bg-white text-[#2B2B2B] rounded-full shadow-[0_8px_18px_-12px_rgba(43,43,43,0.5)] hover:bg-[#2B2B2B] hover:text-white transition-colors'

const DARK = 'text-[clamp(21px,1.2vw,32px)] inline-block px-[1.3em] py-[0.6em] bg-[#2B2B2B] text-white rounded-full hover:opacity-85 transition-opacity'
// The way on to the next phase: clear, but not the loudest thing on the page.
const NEXT = 'text-[clamp(17px,1.1vw,30px)] tracking-[0.08em] px-[1.5em] py-[0.75em] bg-[#2B2B2B] text-white rounded-full hover:opacity-85 transition-opacity'

type Phase = 'brands' | 'connect' | 'mirror'

export default function WelcomeFlow({ firstName, previewMemberId }: { firstName: string; previewMemberId?: string }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('brands')
  const [brandCount, setBrandCount] = useState(0)
  const [email, setEmail] = useState<EmailPanelView | null>(null)
  const [archival, setArchival] = useState<ArchivalPanelView | null>(null)
  const [calendar, setCalendar] = useState<CalendarPanelView | null>(null)
  const [mirrorOpen, setMirrorOpen] = useState(false)
  const [virgin, setVirgin] = useState(false)
  const [emailChoice, setEmailChoice] = useState(false)
  const [igImport, setIgImport] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // The device in her hand decides what the Mirror step says.
  const [native, setNative] = useState(false)
  const [iphone, setIphone] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = async () => { const [e, a, c] = await Promise.all([loadEmailPanel(previewMemberId), loadArchivalPanel(previewMemberId), loadCalendarPanel(previewMemberId)]); setEmail(e); setArchival(a); setCalendar(c) }

  useEffect(() => {
    void refresh()
    const q = new URLSearchParams(window.location.search)
    if (q.get('email_connected')) { setMsg('Email connected. MYRA is reading your order emails.'); void scanNow().catch(() => undefined) }
    if (q.get('instagram_connected')) { setMsg('Instagram connected. Your photos are coming in.'); void syncArchivalInstagram().then(() => nudgeArchival()).then(refresh).catch(() => undefined) }
    if (q.get('calendar_connected')) { setMsg('Calendar connected. MYRA is reading what is coming up.'); void syncMyCalendar(previewMemberId).then(refresh).catch(() => undefined) }
    const err = q.get('email_error') || q.get('instagram_error') || q.get('calendar_error')
    if (err) setMsg(err)
    const app = inNativeApp()
    // ?app=1 shows Chloe's preview what the iPhone app says (Safari, not Chrome).
    setNative(app || (!!previewMemberId && q.get('app') === '1'))
    setIphone(/iPhone|iPad/.test(navigator.userAgent))
    // The app's first open brought her here: noted on her login and in the
    // app, so For You opens as itself from now on. Not for a preview.
    if (app && !previewMemberId) {
      try { localStorage.setItem(APP_WELCOMED_KEY, String(Date.now())) } catch { /* private window */ }
      void markWelcomed({ app: true }).catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addPhotos(files: FileList | null) {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/')).slice(0, 24)
    if (!list.length) return
    setUploading(true)
    let added = 0
    for (let i = 0; i < list.length; i++) {
      setMsg(`Adding photo ${i + 1} of ${list.length}`)
      const fd = new FormData(); fd.set('file', list[i]); if (previewMemberId) fd.set('member', previewMemberId)
      const r = await uploadArchivalPhoto(fd)
      if (!r.error && !r.skipped) added++
    }
    setUploading(false)
    setMsg(`${added} photo${added === 1 ? '' : 's'} added. MYRA is looking at them.`)
    if (fileRef.current) fileRef.current.value = ''
    void nudgeArchival().catch(() => undefined)
    await refresh()
  }

  const inboxes = (email?.connections ?? []).filter((c) => c.status !== 'disconnected')
  const igs = (archival?.connections ?? []).filter((c) => c.status !== 'disconnected')
  const photos = archival?.looks.length ?? 0
  const cals = (calendar?.connections ?? []).filter((c) => c.status !== 'disconnected')
  const anything = inboxes.length > 0 || igs.length > 0 || photos > 0 || cals.length > 0
  const member = previewMemberId ? `&member=${previewMemberId}` : ''
  const gmailHref = `/api/email/google/start?return=${encodeURIComponent('/me/welcome')}${member}`
  const igHref = `/api/instagram/start?return=${encodeURIComponent('/me/welcome')}${member}`
  const calHref = `/api/calendar/google/start?return=${encodeURIComponent('/me/welcome')}${member}`
  const tour = () => { startTour(); router.push('/me') }
  // Connecting the Mirror means opening /mirror/connect IN THE BROWSER THAT
  // HAS THE EXTENSION — inside the app that is Safari, so the app hands the
  // page to Safari itself (the same door YOU uses).
  const connectPath = `/mirror/connect${previewMemberId ? `?as=${previewMemberId}` : ''}`
  const connectHref = `${SITE}${connectPath}`
  function connectMirror() {
    if (inNativeApp()) { window.location.href = `x-safari-${connectHref}`; return }
    window.open(connectPath, '_blank', 'noopener')
  }
  async function copyConnectLink() {
    try { await navigator.clipboard.writeText(connectHref); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { /* she can type it */ }
  }

  // ── Phase one: the brands she loves ───────────────────────────────────────
  if (phase === 'brands') {
    return (
      <div className="w-full max-w-[1100px] mx-auto space-y-7 pb-10">
        {previewMemberId && (
          <p className="text-center text-[15px] tracking-[0.12em] bg-[#7C838B] text-white py-2.5 rounded-full">
            PREVIEW · STEP 2 OF 4 · THE BRANDS {firstName.toUpperCase() || 'SHE'} NAMES HERSELF · SAVING HERE IS REAL
          </p>
        )}

        <header className="text-center space-y-4 pt-2">
          <h1 className="text-[clamp(34px,3.6vw,76px)] leading-[1.08] text-[#2B2B2B]">
            {firstName ? `${firstName}, which brands do you love?` : 'Which brands do you love?'}
          </h1>
          <p className={`${BODY} myra-guide-text text-[#4A4E57]`}>
            You don’t have to think of them. Tap the ones you recognise, or take a whole group. MYRA works out the rest.
          </p>
          {/* The way past, above the work: nothing here is required, and she
              should never feel stuck on the first screen she is ever shown. */}
          <button onClick={() => setPhase('connect')} className={NEXT}>
            {brandCount ? 'NEXT: CONNECT YOUR ACCOUNTS →' : 'SKIP FOR NOW →'}
          </button>
        </header>

        <div className="rounded-[28px] bg-white/80 shadow-[0_18px_40px_-24px_rgba(43,43,43,0.35)] p-6 sm:p-9">
          <BrandPicker bare testMemberId={previewMemberId} onChange={setBrandCount} />
        </div>

        {/* The people whose style she loves — shown once Chloe has made someone live. */}
        <InfluencePicker testMemberId={previewMemberId} className="rounded-[28px] bg-white/80 shadow-[0_18px_40px_-24px_rgba(43,43,43,0.35)] p-6 sm:p-9" />

        <p className="text-center text-[clamp(18px,1.05vw,30px)] text-[#6E6B65]">
          You can change these any time in YOU.
        </p>
      </div>
    )
  }

  // ── Phase three: MYRA where she shops ─────────────────────────────────────
  if (phase === 'mirror') {
    const who = firstName ? `${firstName}, ` : ''
    const safari = native || iphone
    const step = (n: number, text: React.ReactNode) => (
      <li className="flex items-start gap-5">
        <span className="shrink-0 grid h-[2.1em] w-[2.1em] place-items-center rounded-full bg-[#2B2B2B] text-white text-[clamp(18px,1.05vw,28px)]">{n}</span>
        <span className={`${BODY} myra-guide-text text-[#2B2B2B] leading-snug pt-[0.15em]`}>{text}</span>
      </li>
    )
    return (
      <div className="w-full max-w-[1100px] mx-auto space-y-7 pb-10">
        {previewMemberId && (
          <p className="text-center text-[15px] tracking-[0.12em] bg-[#7C838B] text-white py-2.5 rounded-full">
            PREVIEW · STEP 4 OF 4 · MYRA WHERE {firstName.toUpperCase() || 'SHE'} SHOPS · CONNECTING HERE IS REAL
          </p>
        )}

        <header className="text-center space-y-4 pt-2">
          <h1 className="text-[clamp(34px,3.6vw,76px)] leading-[1.08] text-[#2B2B2B]">
            {safari ? `${who}put MYRA in Safari` : `${who}take MYRA where you shop`}
          </h1>
          <p className={`${BODY} myra-guide-text text-[#4A4E57]`}>
            {native
              ? 'MYRA Mirror came with this app. Turn it on once and every shop you open in Safari is in your order — keep a piece, or ask what to wear with it, without leaving the shop. It is how MYRA gets to know you.'
              : safari
                ? 'MYRA Mirror lives inside the MYRA app. Install the app, turn the extension on, and every shop you open in Safari is in your order. It is how MYRA gets to know you.'
                : 'Add MYRA Mirror to Chrome and every brand site you open is in your order — keep a piece, or ask what to wear with it, without leaving the shop. It is how MYRA gets to know you.'}
          </p>
          {/* The way past, above the steps: she can do all of this later from YOU. */}
          <button onClick={tour} className={NEXT}>
            NEXT: SHOW ME AROUND →
          </button>
        </header>

        <div className="rounded-[28px] bg-white/80 shadow-[0_18px_40px_-24px_rgba(43,43,43,0.35)] p-6 sm:p-9 space-y-7">
          {native ? (
            <>
              <ol className="space-y-5">
                {step(1, <>Open <strong>Settings → Apps → Safari → Extensions</strong>.</>)}
                {step(2, <>Tap <strong>MYRA Mirror</strong>. Turn it on, and set <strong>All Websites</strong> to <strong>Allow</strong>.</>)}
                {step(3, <>Come back here and tap <strong>CONNECT MYRA</strong>. It opens in Safari — once, and MYRA knows it is you.</>)}
              </ol>
              <div className="flex flex-wrap items-center gap-4">
                <button type="button" onClick={connectMirror} className={DARK}>CONNECT MYRA IN SAFARI</button>
                <button type="button" onClick={copyConnectLink} className={PILL}>{copied ? 'Copied' : 'Copy the link'}</button>
              </div>
              <p className="text-[clamp(18px,1.05vw,30px)] myra-guide-text text-[#6E6B65] [overflow-wrap:anywhere]">
                If Safari does not open, go to {connectHref.replace(/^https?:\/\//, '')} in Safari yourself. On a laptop, add MYRA to Chrome from YOU any time.
              </p>
            </>
          ) : safari ? (
            <>
              <ol className="space-y-5">
                {step(1, <>Install the <strong>MYRA</strong> app. The Safari extension comes inside it.</>)}
                {step(2, <>Open <strong>Settings → Apps → Safari → Extensions</strong>, tap <strong>MYRA Mirror</strong>, turn it on, and set <strong>All Websites</strong> to <strong>Allow</strong>.</>)}
                {step(3, <>Come back and tap <strong>CONNECT MYRA</strong> — once, and MYRA knows it is you.</>)}
              </ol>
              <div className="flex flex-wrap items-center gap-4">
                {MIRROR_IOS_URL && <a href={MIRROR_IOS_URL} target="_blank" rel="noopener noreferrer" className={DARK}>GET THE MYRA APP</a>}
                <button type="button" onClick={connectMirror} className={PILL}>Connect MYRA</button>
              </div>
            </>
          ) : (
            <>
              <ol className="space-y-5">
                {step(1, MIRROR_STORE_URL
                  ? <>Add <strong>MYRA Mirror</strong> to Chrome.</>
                  : <>Add <strong>MYRA Mirror</strong> to Chrome. It is nearly ready, and the link will be waiting in YOU.</>)}
                {step(2, <>Tap <strong>CONNECT MYRA</strong> — once, and MYRA knows it is you.</>)}
                {step(3, <>Open any brand site. The pieces you would wear come first; save one to MYRA for later, or tap it to style it.</>)}
              </ol>
              <div className="flex flex-wrap items-center gap-4">
                {MIRROR_STORE_URL && <a href={MIRROR_STORE_URL} target="_blank" rel="noopener noreferrer" className={DARK}>ADD MYRA TO CHROME</a>}
                <button type="button" onClick={connectMirror} className={PILL}>Connect MYRA</button>
              </div>
              <p className="text-[clamp(18px,1.05vw,30px)] myra-guide-text text-[#6E6B65]">On your iPhone, MYRA Mirror comes inside the MYRA app — Settings → Apps → Safari → Extensions.</p>
            </>
          )}
        </div>

        <p className="text-center text-[clamp(18px,1.05vw,30px)] text-[#6E6B65]">You can do this any time from YOU.</p>
      </div>
    )
  }

  // ── Phase two: connect your accounts ──────────────────────────────────────
  return (
    <div className="w-full max-w-[1700px] mx-auto space-y-7 pb-10">
      {previewMemberId && (
        <p className="text-center text-[15px] tracking-[0.12em] bg-[#7C838B] text-white py-2.5 rounded-full">
          PREVIEW · STEP 3 OF 4 · WHAT {firstName.toUpperCase() || 'SHE'} SEES AFTER MAKING HER LOGIN · CONNECTING HERE IS REAL
        </p>
      )}

      <header className="text-center space-y-4 pt-2">
        <h1 className="text-[clamp(34px,3.6vw,76px)] leading-[1.08] text-[#2B2B2B]">{firstName ? `${firstName}, connect your accounts` : 'Connect your accounts'}</h1>
        <p className={`${BODY} text-[#4A4E57]`}>Tap one. Hover to see what it does.</p>
        {/* The way past, above the cards: both are optional and she should never feel stuck. */}
        <button onClick={() => setPhase('mirror')} className={NEXT}>
          {anything ? 'NEXT: MYRA WHERE YOU SHOP →' : 'SKIP FOR NOW →'}
        </button>
      </header>

      {msg && <p className={`${BODY} text-center text-[#2B2B2B]`}>{msg}</p>}

      <ul className="myra-connect pt-28 pb-4">
        <li className="item">
          <button type="button" data-app="instagram" data-on={igs.length > 0 || photos > 0} className="btn" aria-label="Instagram"
            onClick={() => (archival?.instagramReady && !igs.length ? window.location.assign(igHref) : setIgImport(true))}>
            <span className="filled" />
            <svg viewBox="0 0 64 64" aria-hidden>
              <rect x="10" y="10" width="44" height="44" rx="13" {...S} strokeWidth={4} />
              <circle cx="32" cy="32" r="10.5" {...S} strokeWidth={4} />
              <circle cx="44.5" cy="19.5" r="3" fill="currentColor" stroke="none" />
            </svg>
            {(igs.length > 0 || photos > 0) && <span className="done" aria-label="Connected">✓</span>}
          </button>
          <span className="tip">Instagram shows MYRA how you really dress</span>
          <span className="label">Instagram</span>
        </li>

        <li className="item">
          <button type="button" data-app="email" data-on={inboxes.length > 0} className="btn" aria-label="Email" onClick={() => setEmailChoice((v) => !v)}>
            <span className="filled" />
            <svg viewBox="0 0 64 64" aria-hidden>
              <rect x="8" y="15" width="48" height="34" rx="5" {...S} strokeWidth={4} />
              <path d="M9.5 18.5L32 36l22.5-17.5" {...S} strokeWidth={4} />
            </svg>
            {inboxes.length > 0 && <span className="done" aria-label="Connected">✓</span>}
          </button>
          <span className="tip">Email finds what you have bought. Only order emails are read</span>
          <span className="label">Email</span>
        </li>

        <li className="item">
          <button type="button" data-app="calendar" data-on={cals.length > 0} className="btn" aria-label="Calendar"
            onClick={() => (calendar?.ready ? window.location.assign(calHref) : setMsg('Calendar connect is not switched on yet.'))}>
            <span className="filled" />
            <svg viewBox="0 0 64 64" aria-hidden>
              <rect x="10" y="14" width="44" height="40" rx="6" {...S} strokeWidth={4} />
              <path d="M10 25h44M22 9v10M42 9v10" {...S} strokeWidth={4} />
              <circle cx="24" cy="36" r="3" fill="currentColor" stroke="none" />
              <circle cx="32" cy="36" r="3" fill="currentColor" stroke="none" />
              <circle cx="40" cy="36" r="3" fill="currentColor" stroke="none" />
              <circle cx="24" cy="45" r="3" fill="currentColor" stroke="none" />
            </svg>
            {cals.length > 0 && <span className="done" aria-label="Connected">✓</span>}
          </button>
          <span className="tip">Your calendar lets MYRA plan outfits for what is coming up</span>
          <span className="label">Calendar</span>
        </li>

        <li className="item">
          <button type="button" data-app="photos" data-on={uploading} className="btn" aria-label="Add photos" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <span className="filled" />
            <svg viewBox="0 0 64 64" aria-hidden>
              <rect x="14" y="8" width="42" height="36" rx="5" {...S} strokeWidth={4} />
              <path d="M8 18v33a5 5 0 0 0 5 5h33" {...S} strokeWidth={4} />
              <path d="M17 40l11-12 8 8 6-6 11 10" {...S} strokeWidth={4} />
              <circle cx="44" cy="19" r="3.5" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
          <span className="tip">Add photos of you in outfits you love</span>
          <span className="label">{uploading ? 'Adding…' : 'Photos'}</span>
        </li>

        <li className="item">
          <button type="button" data-app="mirror" data-on={mirrorOpen} className="btn" aria-label="MYRA Mirror for Chrome or Safari" onClick={() => setMirrorOpen((v) => !v)}>
            <span className="filled" />
            <svg viewBox="0 0 64 64" aria-hidden>
              {/* MYRA's standing mirror (the For You room's drawing), not a browser's mark. */}
              <rect x="21" y="8" width="22" height="38" rx="2" {...S} strokeWidth={3.5} />
              <path d="M26 14l-2 9M31 14l-2 9" {...S} strokeWidth={3.5} opacity="0.55" />
              <path d="M43 46l6 8M21 46l-6 8M26 46v10M38 46v10" {...S} strokeWidth={3.5} />
            </svg>
          </button>
          <span className="tip">{native || iphone ? 'MYRA Mirror puts the pieces you would wear first on brand sites in Safari' : 'MYRA Mirror puts the pieces you would wear first on brand sites in Chrome'}</span>
          <span className="label">Mirror</span>
        </li>
      </ul>

      {mirrorOpen && (
        <div className="mx-auto max-w-[900px] rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-7 py-7 space-y-4 text-center">
          <p className={`${BODY} text-[#2B2B2B]`}>MYRA Mirror</p>
          <p className="text-[clamp(20px,1.15vw,32px)] text-[#4A4E57] leading-snug">
            On a laptop in Chrome, or on an iPhone in Safari, add MYRA Mirror and connect it to you. After that, every brand site you visit shows the pieces you would actually wear first. The site itself stays the same.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            {MIRROR_STORE_URL && <a href={MIRROR_STORE_URL} target="_blank" rel="noopener noreferrer" className={PILL}>Chrome extension</a>}
            {MIRROR_IOS_URL && <a href={MIRROR_IOS_URL} target="_blank" rel="noopener noreferrer" className={PILL}>iPhone TestFlight</a>}
            <a href={`/mirror/connect${previewMemberId ? `?as=${previewMemberId}` : ''}`} target="_blank" rel="noopener noreferrer" className={PILL}>Connect MYRA</a>
          </div>
          <p className="text-[clamp(18px,1vw,26px)] text-[#6E6B65]">On iPhone, install MYRA from TestFlight, enable MYRA Mirror in Safari, and then connect it once.</p>
        </div>
      )}

      {emailChoice && (
        <div className="flex flex-wrap justify-center gap-4">
          {email?.gmailReady
            ? <a href={gmailHref} className={PILL}>{inboxes.length ? 'Another Gmail' : 'Gmail'}</a>
            : <button onClick={() => setMsg('Gmail connect is not switched on yet.')} className={PILL}>Gmail</button>}
          <button onClick={() => { setVirgin(!virgin); setEmailChoice(false) }} className={PILL}>Virgin Media / Blueyonder</button>
        </div>
      )}

      {(inboxes.length > 0 || cals.length > 0 || igs.length > 0) && (
        <p className={`${BODY} myra-guide-text text-center text-[#55534E]`}>
          ✓ {[...igs.map((c) => (c.username ? `@${c.username}` : 'Instagram')), ...inboxes.map((c) => c.email), ...cals.map((c) => `${c.email} calendar`)].join(' · ')}
          {photos > 0 ? ` · ${photos} photo${photos === 1 ? '' : 's'}` : ''}
        </p>
      )}

      {igImport && <InstagramImport testMemberId={previewMemberId} onClose={() => setIgImport(false)} onImported={() => { void refresh() }} />}

      {virgin && (
        <div className="flex justify-center">
          <VirginConnect testMemberId={previewMemberId} secretsReady={!!email?.secretsReady} onConnected={async () => { setVirgin(false); setMsg('Email connected. MYRA is reading your order emails.'); void scanNow().catch(() => undefined); await refresh() }} />
        </div>
      )}

      <p className="text-center text-[clamp(18px,1.05vw,30px)] text-[#6E6B65]">You can connect these any time in your Dressing Room.</p>
    </div>
  )
}
