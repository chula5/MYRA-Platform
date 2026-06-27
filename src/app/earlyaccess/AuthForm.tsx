'use client'

import { useState } from 'react'
import { earlyAccessSignIn, publicSignUp } from './actions'

const INPUT =
  'w-full border border-[#E2E0DB] bg-white rounded-[14px] px-4 py-3 text-[12px] tracking-[0.054em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors'

export default function AuthForm({ initialMode = 'signin', error }: { initialMode?: 'signin' | 'signup'; error?: string }) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode)
  const isSignup = mode === 'signup'

  return (
    <div className="w-full max-w-[360px]">
      <div className="text-center mb-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/myra-mirror-icon.png" alt="MYRA" className="h-14 w-auto mx-auto mb-4" />
        <h1 className="text-[clamp(20px,4vw,28px)] tracking-[0.05em] text-[#4A4E57]">
          {isSignup ? 'CREATE YOUR LOGIN' : 'WELCOME BACK'}
        </h1>
        <p className="mt-3 text-[11px] tracking-[0.081em] text-[#6B6B6B] leading-relaxed">
          {isSignup
            ? 'Save outfits and we’ll learn your taste to recommend looks made for you.'
            : 'Sign in to your wardrobe and personalised edit.'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-[#F2F2F2] rounded-full mb-5">
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 py-2 text-[10px] tracking-[0.1em] rounded-full transition-colors ${
              mode === m ? 'bg-white text-[#4A4E57] shadow-sm' : 'text-[#A8A8A4]'
            }`}
          >
            {m === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}
          </button>
        ))}
      </div>

      {isSignup ? (
        <form action={publicSignUp} className="flex flex-col gap-3">
          <input type="email" name="email" required autoComplete="email" placeholder="EMAIL" className={INPUT} />
          <input type="password" name="password" required autoComplete="new-password" placeholder="PASSWORD (MIN 8 CHARS)" className={INPUT} />
          <input type="password" name="confirm" required autoComplete="new-password" placeholder="CONFIRM PASSWORD" className={INPUT} />
          {error && <p className="text-[10px] tracking-[0.068em] text-[#B83A3A]">{error.toUpperCase()}</p>}
          <button type="submit" className="mt-2 bg-[#0A0A0A] text-white rounded-[14px] py-3 text-[11px] tracking-[0.099em] hover:bg-[#333] transition-colors duration-300">
            CREATE ACCOUNT
          </button>
        </form>
      ) : (
        <form action={earlyAccessSignIn} className="flex flex-col gap-3">
          <input type="email" name="email" required autoComplete="email" placeholder="EMAIL" className={INPUT} />
          <input type="password" name="password" required autoComplete="current-password" placeholder="PASSWORD" className={INPUT} />
          {error && <p className="text-[10px] tracking-[0.068em] text-[#B83A3A]">{error.toUpperCase()}</p>}
          <button type="submit" className="mt-2 bg-[#0A0A0A] text-white rounded-[14px] py-3 text-[11px] tracking-[0.099em] hover:bg-[#333] transition-colors duration-300">
            ENTER
          </button>
        </form>
      )}
    </div>
  )
}
