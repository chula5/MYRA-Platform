'use client'

// CONNECT SAFARI — at the top of For You until MYRA Mirror has checked in.
//
// Chloe, 2026-11-19: For You is what MYRA did while she shopped, so a member
// without the Mirror sees very little here and is never told why. A button at
// the top says it — connect Safari to see more — and opens an explainer that
// shows, with the icons, exactly where to go: Settings → Apps → Safari →
// Extensions → MYRA Mirror on → All Websites: Allow, then CONNECT MYRA once.
// Inside the iPhone app the button can also open Settings itself. On a
// computer the same card says Chrome. Gone the moment the Mirror is connected.

import { useEffect, useState } from 'react'
import { inNativeApp } from '@/components/me/AppFirstOpen'

const MIRROR_STORE_URL = process.env.NEXT_PUBLIC_MIRROR_STORE_URL ?? ''
const MIRROR_IOS_URL = process.env.NEXT_PUBLIC_MIRROR_IOS_URL ?? ''
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.myraassistant.co.uk').replace(/\/+$/, '')

const T = 'text-[17px] xl:text-[21px]'
const T_SMALL = 'text-[15px] xl:text-[19px]'
const DARK = `${T_SMALL} tracking-[0.06em] inline-flex items-center justify-center rounded-full bg-[#2B2B2B] text-white px-7 py-3.5 hover:opacity-85 transition-opacity`
const PILL = `${T_SMALL} tracking-[0.06em] inline-flex items-center justify-center rounded-full border border-[#2B2B2B] text-[#2B2B2B] px-7 py-3.5 hover:bg-[#2B2B2B] hover:text-white transition-colors`

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** The iPhone's Settings gear. */
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" {...S} aria-hidden>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
      <path d="M8.2 3.6l.9 2.1M14.9 18.3l.9 2.1M3.6 8.2l2.1.9M18.3 14.9l2.1.9M3.6 15.8l2.1-.9M18.3 9.1l2.1-.9M8.2 20.4l.9-2.1M14.9 5.7l.9-2.1" />
    </svg>
  )
}

/** The grid of apps. */
function AppsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" {...S} aria-hidden>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </svg>
  )
}

/** Safari's puzzle piece for Extensions. */
function PuzzleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" {...S} aria-hidden>
      <path d="M9.5 4.5a2 2 0 1 1 4 0h3.5a1.5 1.5 0 0 1 1.5 1.5v3.5a2 2 0 1 1 0 4V17a1.5 1.5 0 0 1-1.5 1.5H13.5a2 2 0 1 1-4 0H6A1.5 1.5 0 0 1 4.5 17v-3.5a2 2 0 1 1 0-4V6A1.5 1.5 0 0 1 6 4.5h3.5Z" />
    </svg>
  )
}

/** MYRA's standing mirror: the extension's own mark. */
function MirrorIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" {...S} aria-hidden>
      <rect x="7" y="2.5" width="10" height="15" rx="5" />
      <path d="M12 17.5v4M9 21.5h6" />
    </svg>
  )
}

/** iOS's green switch, on. */
function Toggle({ on }: { on: boolean }) {
  return (
    <span className={`inline-flex h-[1.5em] w-[2.6em] items-center rounded-full px-[0.15em] transition-colors ${on ? 'bg-[#34C759]' : 'bg-[#D9D9D6]'}`} aria-hidden>
      <span className={`h-[1.2em] w-[1.2em] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform ${on ? 'translate-x-[1.1em]' : ''}`} />
    </span>
  )
}

/** One stop on the path through Settings, drawn like the row she will see. */
function Stop({ icon, label, note }: { icon: React.ReactNode; label: string; note?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-3 rounded-[16px] bg-white px-3.5 py-2.5 shadow-[0_2px_8px_rgba(43,43,43,0.10)]">
      <span className="grid h-[2em] w-[2em] shrink-0 place-items-center rounded-[9px] bg-[#F4F4F2] p-[0.35em] text-[#4A4E57]">{icon}</span>
      <span className={`${T_SMALL} text-[#2B2B2B] whitespace-nowrap`}>{label}</span>
      {note}
    </span>
  )
}

const Arrow = () => <span className="text-[#7C838B] text-[20px] leading-none" aria-hidden>→</span>

export default function ConnectSafari({ connected, testMemberId }: { connected: boolean; testMemberId?: string }) {
  const [open, setOpen] = useState(false)
  // The device in her hand decides what the card says: the app and iPhone
  // Safari get Safari; a computer gets Chrome.
  const [native, setNative] = useState(false)
  const [iphone, setIphone] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    setNative(inNativeApp() || (!!testMemberId && q.get('app') === '1'))
    setIphone(/iPhone|iPad/.test(navigator.userAgent))
  }, [testMemberId])

  // Shut with the page's back gesture / Escape, and never scroll the page beneath.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])

  if (connected) return null
  const safari = native || iphone
  const browser = safari ? 'Safari' : 'Chrome'

  // Connecting means opening /mirror/connect IN THE BROWSER THAT HAS THE
  // EXTENSION — inside the app that is Safari, so the app hands the page to
  // Safari itself (the same door the welcome and YOU use).
  const connectPath = `/mirror/connect${testMemberId ? `?as=${testMemberId}` : ''}`
  const connectHref = `${SITE}${connectPath}`
  function connectMirror() {
    if (inNativeApp()) { window.location.href = `x-safari-${connectHref}`; return }
    window.open(connectPath, '_blank', 'noopener')
  }
  // The app can open the Settings app at its own page; from there it is
  // Apps → Safari → Extensions. iOS gives an app no deeper door than that.
  function openSettings() { window.location.href = 'app-settings:' }
  async function copyLink() {
    try { await navigator.clipboard.writeText(connectHref); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { /* she can type it */ }
  }

  return (
    <>
      <div className="flex flex-col items-center gap-3 mt-7" data-tour="connect-safari">
        <button type="button" onClick={() => setOpen(true)} className={DARK}>
          <span className="grid h-[1.5em] w-[1.5em] place-items-center rounded-[6px] bg-white p-[2px] mr-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={safari ? '/logos/safari.svg' : '/logos/chrome.svg'} alt="" className="h-full w-full object-contain" />
          </span>
          CONNECT {browser.toUpperCase()} TO SEE MORE HERE
        </button>
        <p className={`${T_SMALL} myra-guide-text normal-case text-[#6E6B65] text-center max-w-[520px]`}>
          This page fills with what you look at in the shops. MYRA Mirror in {browser} is how it sees that.
        </p>
      </div>

      {open && (
        <div className="fixed inset-0 z-[120] bg-[rgba(43,43,43,0.4)] backdrop-blur-[3px] overflow-y-auto" data-lenis-prevent>
          <div className="min-h-full flex items-end sm:items-center justify-center sm:px-4 sm:py-8" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
            <div role="dialog" aria-modal="true" aria-label={`Put MYRA in ${browser}`}
              className="w-full sm:max-w-[820px] bg-[#F7F6F3] rounded-t-[28px] sm:rounded-[28px] shadow-[0_30px_60px_-30px_rgba(43,43,43,0.55)] px-6 sm:px-10 pt-7 pb-[calc(96px+env(safe-area-inset-bottom))] sm:pb-10 space-y-7">
              <div className="flex items-start justify-between gap-5">
                <div className="flex items-center gap-4">
                  <span className="grid h-[56px] w-[56px] shrink-0 place-items-center rounded-[14px] bg-white p-[10px] shadow-[0_2px_8px_rgba(43,43,43,0.12)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={safari ? '/logos/safari.svg' : '/logos/chrome.svg'} alt={browser} className="h-full w-full object-contain" />
                  </span>
                  <div>
                    <h2 className="text-[clamp(26px,2vw,42px)] leading-none text-[#1a1a1a]">Put MYRA in {browser}</h2>
                    <p className={`${T_SMALL} myra-guide-text normal-case text-[#6E6B65] mt-2`}>
                      {native
                        ? 'MYRA Mirror came with this app. Turn it on once, and every shop you open in Safari shows the pieces you would wear first — keep one, or ask what to wear with it, without leaving the shop. That is what fills this page.'
                        : safari
                          ? 'MYRA Mirror lives inside the MYRA app. Install the app, turn the extension on in Settings, and every shop you open in Safari is in your order. That is what fills this page.'
                          : 'Add MYRA Mirror to Chrome and every brand site you open is in your order — keep a piece, or ask what to wear with it, without leaving the shop. That is what fills this page.'}
                    </p>
                  </div>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                  className="shrink-0 w-[48px] h-[48px] rounded-full bg-white text-[24px] text-[#2B2B2B] hover:bg-[#E9E9E6]">×</button>
              </div>

              {safari ? (
                <ol className="space-y-6">
                  {!native && (
                    <li className="space-y-3">
                      <p className={`${T} text-[#2B2B2B]`}><span className="text-[#7C838B] mr-3">1</span>Install the MYRA app. The Safari extension comes inside it.</p>
                      {MIRROR_IOS_URL && <a href={MIRROR_IOS_URL} target="_blank" rel="noopener noreferrer" className={DARK}>GET THE MYRA APP</a>}
                    </li>
                  )}
                  <li className="space-y-3">
                    <p className={`${T} text-[#2B2B2B]`}><span className="text-[#7C838B] mr-3">{native ? 1 : 2}</span>Open Settings and go to Apps, then Safari, then Extensions.</p>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Stop icon={<GearIcon />} label="Settings" /><Arrow />
                      <Stop icon={<AppsIcon />} label="Apps" /><Arrow />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <Stop icon={<img src="/logos/safari.svg" alt="" className="h-full w-full object-contain" />} label="Safari" /><Arrow />
                      <Stop icon={<PuzzleIcon />} label="Extensions" />
                    </div>
                    {native && <button type="button" onClick={openSettings} className={PILL}>OPEN SETTINGS</button>}
                  </li>
                  <li className="space-y-3">
                    <p className={`${T} text-[#2B2B2B]`}><span className="text-[#7C838B] mr-3">{native ? 2 : 3}</span>Tap MYRA Mirror. Turn it on, and set All Websites to Allow.</p>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Stop icon={<MirrorIcon />} label="MYRA Mirror" note={<Toggle on />} /><Arrow />
                      <Stop icon={<span className={`${T_SMALL} text-[#7C838B]`}>🌐</span>} label="All Websites" note={<span className={`${T_SMALL} text-[#7C838B]`}>Allow ✓</span>} />
                    </div>
                  </li>
                  <li className="space-y-3">
                    <p className={`${T} text-[#2B2B2B]`}><span className="text-[#7C838B] mr-3">{native ? 3 : 4}</span>Come back here and tap CONNECT MYRA. It opens in Safari once, and MYRA knows it is you.</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={connectMirror} className={DARK}>CONNECT MYRA IN SAFARI</button>
                      <button type="button" onClick={copyLink} className={PILL}>{copied ? 'COPIED' : 'COPY THE LINK'}</button>
                    </div>
                    <p className={`${T_SMALL} myra-guide-text normal-case text-[#6E6B65] [overflow-wrap:anywhere]`}>
                      If Safari does not open, go to {connectHref.replace(/^https?:\/\//, '')} in Safari yourself.
                    </p>
                  </li>
                </ol>
              ) : (
                <ol className="space-y-6">
                  <li className="space-y-3">
                    <p className={`${T} text-[#2B2B2B]`}><span className="text-[#7C838B] mr-3">1</span>Add MYRA Mirror to Chrome.</p>
                    <div className="flex flex-wrap items-center gap-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <Stop icon={<img src="/logos/chrome.svg" alt="" className="h-full w-full object-contain" />} label="Chrome" /><Arrow />
                      <Stop icon={<PuzzleIcon />} label="Extensions" /><Arrow />
                      <Stop icon={<MirrorIcon />} label="MYRA Mirror" note={<Toggle on />} />
                    </div>
                    {MIRROR_STORE_URL
                      ? <a href={MIRROR_STORE_URL} target="_blank" rel="noopener noreferrer" className={DARK}>ADD MYRA TO CHROME</a>
                      : <p className={`${T_SMALL} myra-guide-text normal-case text-[#6E6B65]`}>The Chrome listing is nearly ready; the link will be waiting in YOU.</p>}
                  </li>
                  <li className="space-y-3">
                    <p className={`${T} text-[#2B2B2B]`}><span className="text-[#7C838B] mr-3">2</span>Tap CONNECT MYRA once, and MYRA knows it is you.</p>
                    <button type="button" onClick={connectMirror} className={DARK}>CONNECT MYRA</button>
                  </li>
                  <li>
                    <p className={`${T} text-[#2B2B2B]`}><span className="text-[#7C838B] mr-3">3</span>Open any brand site. The pieces you would wear come first; save one to MYRA for later, or tap it to style it.</p>
                  </li>
                </ol>
              )}

              <p className={`${T_SMALL} myra-guide-text normal-case text-[#7C838B]`}>
                {safari ? 'On a laptop, MYRA Mirror is for Chrome — add it from YOU any time.' : 'On your iPhone, MYRA Mirror comes inside the MYRA app: Settings → Apps → Safari → Extensions.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
