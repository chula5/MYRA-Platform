'use client'

// EMAIL → CODE → (FIRST TIME) PASSWORD. The door's own three steps; the
// server actions decide everything, this only asks and moves on.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { requestSignInCode, verifySignInCode, setFirstPassword } from './code-actions'

const INPUT =
  'w-full border border-[#E2E0DB] bg-white rounded-[14px] px-4 py-3.5 text-[17px] tracking-[0.03em] text-[#2B2B2B] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors'
const BUTTON =
  'mt-2 bg-[#0A0A0A] text-white rounded-[14px] py-3.5 text-[15px] tracking-[0.12em] hover:bg-[#333] transition-colors duration-300 disabled:opacity-60'
const LINK = 'mt-1 text-center text-[15px] tracking-[0.1em] text-[#7C838B] hover:text-[#4A4E57]'
const NOTE = 'text-[15px] leading-relaxed text-[#4A4E57]'
const ERR = 'text-[15px] leading-relaxed text-[#B83A3A]'

type Step = 'email' | 'code' | 'password'

export default function CodeSignIn({ next, onPassword }: { next?: string | null; onPassword?: () => void }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    if (busy) return
    setBusy(true); setMsg(null); setNote(null)
    try {
      const r = await requestSignInCode({ email })
      if (!r.ok) { setMsg(r.message); return }
      setEmail(r.email); setCode(''); setStep('code')
    } catch {
      setMsg('Could not send the code — please try again')
    } finally { setBusy(false) }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setMsg(null)
    try {
      const r = await verifySignInCode({ email, code, next: next ?? undefined })
      if (!r.ok) { setMsg(r.message); setBusy(false); return }
      if (r.next === 'password') { setStep('password'); setBusy(false); return }
      router.replace(r.next)
      router.refresh()
    } catch {
      setMsg("That code didn't work — check it, or ask for a new one"); setBusy(false)
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setMsg(null)
    try {
      const r = await setFirstPassword({ password, confirm })
      if (!r.ok) { setMsg(r.message); setBusy(false); return }
      router.replace('/me/welcome')
      router.refresh()
    } catch {
      setMsg('Could not save that password — please try again'); setBusy(false)
    }
  }

  if (step === 'password') {
    return (
      <form onSubmit={savePassword} className="flex flex-col gap-3">
        <p className={`${NOTE} text-center mb-1`}>You&rsquo;re in. Choose a password for next time — or sign in with a code again whenever you like.</p>
        <input type="email" value={email} readOnly autoComplete="username" className="sr-only" tabIndex={-1} aria-hidden />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" placeholder="PASSWORD (8+ CHARACTERS)" className={INPUT} />
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" placeholder="TYPE IT ONCE MORE" className={INPUT} />
        {msg && <p className={ERR}>{msg}</p>}
        <button type="submit" disabled={busy} className={BUTTON}>{busy ? 'SAVING…' : 'SAVE AND COME IN'}</button>
      </form>
    )
  }

  if (step === 'code') {
    return (
      <form onSubmit={verify} className="flex flex-col gap-3">
        <p className={`${NOTE} text-center mb-1`}>
          We&rsquo;ve sent a code to <span className="text-[#0A0A0A]">{email}</span>. Type it here.
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          required
          autoFocus
          placeholder="CODE"
          className={`${INPUT} text-center tracking-[0.3em]`}
        />
        {msg && <p className={ERR}>{msg}</p>}
        {note && <p className={NOTE}>{note}</p>}
        <button type="submit" disabled={busy || code.length < 6} className={BUTTON}>{busy ? 'CHECKING…' : 'ENTER'}</button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => { await sendCode(); setNote('A new code is on its way.') }}
          className={LINK}
        >
          SEND A NEW CODE
        </button>
        <button type="button" onClick={() => { setStep('email'); setMsg(null); setNote(null) }} className={LINK}>
          ← DIFFERENT EMAIL
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={sendCode} className="flex flex-col gap-3">
      <input
        type="email"
        name="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
        autoCapitalize="none"
        placeholder="EMAIL"
        className={INPUT}
      />
      {msg && <p className={ERR}>{msg}</p>}
      <button type="submit" disabled={busy} className={BUTTON}>{busy ? 'SENDING…' : 'SEND ME A CODE'}</button>
      {onPassword && (
        <button type="button" onClick={onPassword} className={LINK}>
          SIGN IN WITH PASSWORD
        </button>
      )}
    </form>
  )
}
