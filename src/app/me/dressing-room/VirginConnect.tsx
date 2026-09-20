'use client'

// CONNECT VIRGIN MEDIA / BLUEYONDER — shared by the Dressing Room and her
// welcome. Virgin Media has no one-click sign-in (no OAuth), so the nearest
// honest thing: send her to Virgin's own site to make an app password, and pick
// up where she left off the moment she comes back to this tab.

import { useEffect, useRef, useState } from 'react'
import { connectVirginMedia } from './email-actions'

const VIRGIN_HELP = 'https://www.virginmedia.com/help/broadband/manage-email-settings'
// Where she signs in — on Virgin's own site, never on ours.
const VIRGIN_ACCOUNT = 'https://www.virginmedia.com/my-virgin-media'

const BODY = 'text-[22px] xl:text-[25px] 2xl:text-[29px]'
const STEP = 'text-[20px] xl:text-[23px] 2xl:text-[27px]'
const SMALL = 'text-[18px] xl:text-[21px] 2xl:text-[25px]'

export default function VirginConnect({ testMemberId, secretsReady, onConnected }: { testMemberId?: string; secretsReady: boolean; onConnected: () => void }) {
  const [step, setStep] = useState<1 | 2>(1)
  const [email, setEmail] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const awaitingReturn = useRef(false)

  useEffect(() => {
    const back = () => {
      if (!awaitingReturn.current || document.visibilityState !== 'visible') return
      awaitingReturn.current = false
      setStep(2)
    }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back) }
  }, [])

  function goToVirgin() {
    awaitingReturn.current = true
    window.open(VIRGIN_ACCOUNT, '_blank', 'noopener,noreferrer')
  }

  async function paste() {
    try {
      const t = (await navigator.clipboard.readText()).trim()
      if (t) setAppPassword(t)
    } catch { setMsg('Your browser would not share the clipboard — paste it into the box instead.') }
  }

  async function connect() {
    setBusy(true)
    setMsg('Checking the app password with Virgin Media…')
    const r = await connectVirginMedia(email, appPassword, testMemberId)
    setBusy(false)
    setAppPassword('')
    if (r.error) { setMsg(r.error); return }
    setMsg(null)
    onConnected()
  }

  const card = 'border border-[#C3BFB8] bg-[rgba(255,255,255,0.35)] px-6 py-6 space-y-5 max-w-2xl rounded-3xl text-left'
  const field = `${STEP} bg-white border border-[#6E6B65] px-5 py-3 focus:outline-none focus:border-[#2B2B2B] rounded-full`

  if (step === 1) {
    return (
      <div className={card}>
        <p className="myra-section-note 2xl:!text-[28px]">STEP 1 OF 2 · ON VIRGIN MEDIA&rsquo;S SITE</p>
        <p className={`${BODY} leading-snug text-[#2B2B2B]`}>
          Virgin Media doesn&rsquo;t offer a one-click sign-in the way Google does, so there is one short detour. You sign in on <b>their</b> site, make an <b>app password</b>, and come back — about two minutes.
        </p>
        <button onClick={goToVirgin} className={`${BODY} px-7 py-3.5 bg-[#2B2B2B] text-white rounded-full`}>Open My Virgin Media →</button>
        <ol className={`${STEP} text-[#2B2B2B] list-decimal pl-6 space-y-1`}>
          <li>Sign in, then go to <b>Account settings → Account details</b>.</li>
          <li>Under <b>Virgin Media Mail</b>, choose <b>Manage</b> next to app password, then <b>Generate new app password</b>.</li>
          <li>Copy it and come back to this tab — MYRA will be waiting.</li>
        </ol>
        <p className={`${SMALL} text-[#55534E]`}>MYRA never sees your Virgin Media password. The app password only opens your mail, and you can cancel it there any time.</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <button onClick={() => setStep(2)} className={`${SMALL} underline underline-offset-4 text-[#2B2B2B]`}>I already have my app password</button>
          <a href={VIRGIN_HELP} target="_blank" rel="noopener noreferrer" className={`${SMALL} underline underline-offset-4 text-[#2B2B2B]`}>Virgin Media&rsquo;s help page →</a>
        </div>
      </div>
    )
  }

  return (
    <div className={card}>
      <p className="myra-section-note 2xl:!text-[28px]">STEP 2 OF 2 · BACK IN MYRA</p>
      <p className={`${BODY} leading-snug text-[#2B2B2B]`}>Welcome back. Paste the app password Virgin Media just gave you.</p>
      {msg && <p className={`${STEP} text-[#2B2B2B]`}>{msg}</p>}
      <div className="flex flex-col gap-3">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email, e.g. name@blueyonder.co.uk" autoComplete="email" className={field} />
        <div className="flex gap-3">
          <input value={appPassword} onChange={(e) => setAppPassword(e.target.value)} placeholder="App password" type="password" autoComplete="off" className={`flex-1 min-w-0 ${field}`} />
          <button type="button" onClick={paste} className={`${STEP} px-6 py-3 border border-[#2B2B2B] text-[#2B2B2B] rounded-full`}>Paste</button>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <button disabled={busy || !email.trim() || !appPassword || !secretsReady} onClick={connect} className={`${BODY} px-7 py-3.5 bg-[#2B2B2B] text-white disabled:opacity-40 rounded-full`}>
            {busy ? 'Checking with Virgin Media…' : 'Connect'}
          </button>
          <button onClick={() => setStep(1)} className={`${SMALL} underline underline-offset-4 text-[#2B2B2B]`}>← I still need to make one</button>
        </div>
      </div>
    </div>
  )
}
