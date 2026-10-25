'use client'

// WHAT SHE SEES.
//
// Her real pages — /me itself, framed — opened AS her. Not a copy of her
// rooms: a copy drifts (a new room, a new header, a tab bar) and then what
// Chloe checks stops being what she sees. The member rides on an admin-only
// cookie scoped to /me, so every page and every action resolves her, in test
// mode: outfits are composed and checked for real, but nothing she would
// record is saved. IPHONE is the app's own width; COMPUTER is her browser.

import InviteLink from './InviteLink'
import { useEffect, useRef, useState } from 'react'
import { setHerView } from './her-view-actions'
import { MirrorLoading } from '@/components/ArchiveCard'

type Device = 'iphone' | 'computer'

// iPhone 15/16 in points: the screen the app is drawn on.
const PHONE = { w: 393, h: 852 }

export default function HerViewTab({
  members, memberId, setMemberId,
}: {
  members: { member_id: string; name: string }[]
  memberId: string
  setMemberId: (id: string) => void
}) {
  const [device, setDevice] = useState<Device>('iphone')
  // The cookie must be set before her page is asked for; the frame waits on it.
  const [readyFor, setReadyFor] = useState('')
  const [reload, setReload] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!memberId) return
    let live = true
    setReadyFor('')
    void setHerView(memberId).then(() => { if (live) setReadyFor(memberId) })
    return () => { live = false }
  }, [memberId])

  // Leaving HER VIEW gives Chloe her own /me back.
  useEffect(() => () => { void setHerView(null) }, [])

  const name = members.find((m) => m.member_id === memberId)?.name ?? ''
  const first = name.split(' ')[0]
  const ready = readyFor === memberId && !!memberId
  const src = '/me'

  function home() {
    if (frame.current) frame.current.src = src
  }

  const btn = (on: boolean) =>
    `text-[13px] tracking-[0.14em] px-4 py-2.5 border transition-colors ${on ? 'border-[#2B2B2B] bg-[#2B2B2B] text-white' : 'border-[#C3BFB8] text-[#2B2B2B]'}`

  return (
    <div className="space-y-6">
      <div className="flex gap-1.5 flex-wrap">
        {members.map((m) => (
          <button
            key={m.member_id}
            onClick={() => setMemberId(m.member_id)}
            className={`text-[20px] tracking-[0.1em] px-4 py-2 border transition-colors ${memberId === m.member_id ? 'border-[#0A0A0A] text-[#0A0A0A]' : 'border-[#E2E0DB] text-[#6B6B6B]'}`}
          >
            {m.name}
          </button>
        ))}
      </div>

      {/* The test label belongs to Chloe, not to her screen: it sits above it. */}
      <p className="text-[20px] tracking-[0.1em] text-[#7C838B] px-1 pb-3">
        TESTING AS {name.toUpperCase()} — HER REAL APP. TAPS HERE ARE TESTS: NOTHING IS SENT TO HER OR SAVED
      </p>
      <InviteLink memberId={memberId} name={name} />

      <div className="flex flex-wrap items-center gap-3 px-1">
        <button onClick={() => setDevice('iphone')} className={btn(device === 'iphone')}>IPHONE APP</button>
        <button onClick={() => setDevice('computer')} className={btn(device === 'computer')}>COMPUTER</button>
        <span className="w-4" />
        <button onClick={home} className={btn(false)}>BACK TO FOR YOU</button>
        <button onClick={() => setReload((n) => n + 1)} className={btn(false)}>RELOAD</button>
        <button onClick={() => window.open(src, '_blank', 'noopener')} className={btn(false)}>
          OPEN AS {first.toUpperCase()} IN A NEW TAB
        </button>
      </div>

      {!ready && <MirrorLoading label={`OPENING ${name.toUpperCase()}'S APP`} />}

      {ready && device === 'iphone' && (
        <div className="flex justify-center py-6">
          {/* The phone: a bezel round the app's own width, the clock above it
              as on her screen. Inside is exactly what the app loads. */}
          <div className="rounded-[56px] bg-[#0A0A0A] p-[14px] shadow-[0_30px_80px_rgba(0,0,0,0.25)]">
            <div className="overflow-hidden rounded-[44px] bg-white" style={{ width: PHONE.w }}>
              <div className="relative flex h-[47px] items-center justify-between px-8 text-[15px] font-semibold text-[#0A0A0A] myra-pearl">
                <span>9:41</span>
                <span className="absolute left-1/2 top-[11px] h-[30px] w-[118px] -translate-x-1/2 rounded-full bg-[#0A0A0A]" aria-hidden />
                <span className="tracking-[0.1em] text-[12px]">●●● ▮</span>
              </div>
              <iframe
                ref={frame}
                key={`${memberId}-${reload}-phone`}
                src={src}
                title={`${name}'s app`}
                style={{ width: PHONE.w, height: PHONE.h - 47, border: 0, display: 'block' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Her browser, full width of the screen — a front-end view, so it
          breaks out of the admin's column exactly as her browser shows it. */}
      {ready && device === 'computer' && (
        <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen border-y border-[#DCDEE1]">
          <iframe
            ref={frame}
            key={`${memberId}-${reload}-computer`}
            src={src}
            title={`${name}'s MYRA`}
            style={{ width: '100%', height: '88vh', border: 0, display: 'block' }}
          />
        </div>
      )}
    </div>
  )
}
