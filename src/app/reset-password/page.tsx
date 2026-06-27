'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

const INPUT =
  'w-full border border-[#E2E0DB] bg-white rounded-[14px] px-4 py-3 text-[12px] tracking-[0.054em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'verifying' | 'ready' | 'invalid'>('verifying')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // The email link lands here with a one-time code — exchange it for a
  // (recovery) session so we can update the password.
  useEffect(() => {
    const supabase = createClient()
    const code = new URLSearchParams(window.location.search).get('code')
    ;(async () => {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) { setStatus('ready'); return }
      }
      // Some Supabase configs deliver an already-established recovery session.
      const { data } = await supabase.auth.getSession()
      setStatus(data.session ? 'ready' : 'invalid')
    })()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (password.length < 8) { setErr('Password must be at least 8 characters'); return }
    if (password !== confirm) { setErr('Passwords do not match'); return }
    setBusy(true)
    setErr(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setErr('Could not update your password — the link may have expired'); setBusy(false); return }
    router.push('/edit')
  }

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-[360px] text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/myra-mirror-transparent.png" alt="MYRA" className="h-14 w-auto mx-auto mb-4" />
        <h1 className="text-[clamp(20px,4vw,28px)] tracking-[0.05em] text-[#4A4E57]">SET A NEW PASSWORD</h1>

        {status === 'verifying' && (
          <p className="mt-6 text-[11px] tracking-[0.1em] text-[#A8A8A4]">VERIFYING YOUR LINK…</p>
        )}

        {status === 'invalid' && (
          <>
            <p className="mt-5 text-[11px] tracking-[0.06em] text-[#6B6B6B] leading-relaxed">
              This reset link is invalid or has expired. Request a new one from the sign-in page.
            </p>
            <Link href="/signin" className="inline-block mt-6 text-[10px] tracking-[0.1em] text-[#4A4E57] underline">
              ← BACK TO SIGN IN
            </Link>
          </>
        )}

        {status === 'ready' && (
          <form onSubmit={submit} className="flex flex-col gap-3 mt-6 text-left">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" placeholder="NEW PASSWORD (MIN 8 CHARS)" className={INPUT} />
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" placeholder="CONFIRM NEW PASSWORD" className={INPUT} />
            {err && <p className="text-[10px] tracking-[0.068em] text-[#B83A3A]">{err.toUpperCase()}</p>}
            <button type="submit" disabled={busy} className="mt-2 bg-[#0A0A0A] text-white rounded-[14px] py-3 text-[11px] tracking-[0.099em] hover:bg-[#333] transition-colors duration-300 disabled:opacity-50">
              {busy ? 'SAVING…' : 'UPDATE PASSWORD'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
