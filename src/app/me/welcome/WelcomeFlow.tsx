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
// loud. All live on in her Dressing Room. Then: the tour.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import BrandPicker from '@/components/me/BrandPicker'
import VirginConnect from '../dressing-room/VirginConnect'
import InstagramImport from '../dressing-room/InstagramImport'
import { loadEmailPanel, scanNow, type EmailPanelView } from '../dressing-room/email-actions'
import { loadArchivalPanel, syncArchivalInstagram, uploadArchivalPhoto, nudgeArchival, type ArchivalPanelView } from '../dressing-room/archival-actions'
import { loadCalendarPanel, syncMyCalendar, type CalendarPanelView } from '../dressing-room/calendar-actions'
import { startTour } from '@/components/me/MeTour'

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
// The Chrome Web Store listing for the MYRA Mirror extension, once published.
const MIRROR_STORE_URL = process.env.NEXT_PUBLIC_MIRROR_STORE_URL ?? ''
const BODY = 'text-[clamp(22px,1.35vw,40px)]'
const PILL = 'text-[clamp(21px,1.2vw,32px)] inline-block px-[1.3em] py-[0.6em] bg-white text-[#2B2B2B] rounded-full shadow-[0_8px_18px_-12px_rgba(43,43,43,0.5)] hover:bg-[#2B2B2B] hover:text-white transition-colors'

type Phase = 'brands' | 'connect'

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

  const refresh = async () => { const [e, a, c] = await Promise.all([loadEmailPanel(previewMemberId), loadArchivalPanel(previewMemberId), loadCalendarPanel(previewMemberId)]); setEmail(e); setArchival(a); setCalendar(c) }

  useEffect(() => {
    void refresh()
    const q = new URLSearchParams(window.location.search)
    if (q.get('email_connected')) { setMsg('Email connected. MYRA is reading your order emails.'); void scanNow().catch(() => undefined) }
    if (q.get('instagram_connected')) { setMsg('Instagram connected. Your photos are coming in.'); void syncArchivalInstagram().then(() => nudgeArchival()).then(refresh).catch(() => undefined) }
    if (q.get('calendar_connected')) { setMsg('Calendar connected. MYRA is reading what is coming up.'); void syncMyCalendar(previewMemberId).then(refresh).catch(() => undefined) }
    const err = q.get('email_error') || q.get('instagram_error') || q.get('calendar_error')
    if (err) setMsg(err)
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
            Three or four is plenty. MYRA works out the rest from them.
          </p>
          {/* The way past, above the work: nothing here is required, and she
              should never feel stuck on the first screen she is ever shown. */}
          <button
            onClick={() => setPhase('connect')}
            className="text-[clamp(24px,1.5vw,44px)] tracking-[0.1em] px-[1.6em] py-[0.6em] bg-[#2B2B2B] text-white rounded-full hover:opacity-85 transition-opacity"
          >
            {brandCount ? 'NEXT: CONNECT YOUR ACCOUNTS →' : 'SKIP FOR NOW →'}
          </button>
        </header>

        <div className="rounded-[28px] bg-white/80 shadow-[0_18px_40px_-24px_rgba(43,43,43,0.35)] p-6 sm:p-9">
          <BrandPicker bare testMemberId={previewMemberId} onChange={setBrandCount} />
        </div>

        <p className="text-center text-[clamp(18px,1.05vw,30px)] text-[#6E6B65]">
          You can change these any time in YOU.
        </p>
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
        <button onClick={tour} className="text-[clamp(24px,1.5vw,44px)] tracking-[0.1em] px-[1.6em] py-[0.6em] bg-[#2B2B2B] text-white rounded-full hover:opacity-85 transition-opacity">
          {anything ? 'NEXT: SHOW ME AROUND →' : 'SKIP FOR NOW →'}
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
          <button type="button" data-app="mirror" data-on={mirrorOpen} className="btn" aria-label="MYRA for Chrome" onClick={() => setMirrorOpen((v) => !v)}>
            <span className="filled" />
            <svg viewBox="0 0 64 64" aria-hidden>
              <circle cx="32" cy="32" r="22" {...S} strokeWidth={4} />
              <circle cx="32" cy="32" r="8.5" {...S} strokeWidth={4} />
              <path d="M32 23.5h21M24.6 36.3L14 18M39.4 36.3L28.8 54.6" {...S} strokeWidth={4} />
            </svg>
          </button>
          <span className="tip">MYRA for Chrome puts the pieces you would wear first on any brand site</span>
          <span className="label">Chrome</span>
        </li>
      </ul>

      {mirrorOpen && (
        <div className="mx-auto max-w-[900px] rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-7 py-7 space-y-4 text-center">
          <p className={`${BODY} text-[#2B2B2B]`}>MYRA for Chrome</p>
          <p className="text-[clamp(20px,1.15vw,32px)] text-[#4A4E57] leading-snug">
            On a laptop, in Chrome: add MYRA, then connect it to you. After that, every brand site you visit shows the pieces you would actually wear first. The site itself stays the same.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            {MIRROR_STORE_URL
              ? <a href={MIRROR_STORE_URL} target="_blank" rel="noopener noreferrer" className={PILL}>1. Add to Chrome</a>
              : <span className={`${PILL} opacity-60`}>1. Add to Chrome (link coming soon)</span>}
            <a href={`/mirror/connect${previewMemberId ? `?as=${previewMemberId}` : ''}`} target="_blank" rel="noopener noreferrer" className={PILL}>2. Connect it to me</a>
          </div>
          <p className="text-[clamp(18px,1vw,26px)] text-[#6E6B65]">Not on a phone yet. It only reads the brand pages you open.</p>
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
