import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { earlyAccessSignUp } from '../actions'
import { EARLY_ACCESS_INVITE_CODE } from '../invite'

export const dynamic = 'force-dynamic'

const inputClass =
  'w-full border border-[#E2E0DB] bg-white px-4 py-3 text-[12px] tracking-[0.12em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors'

export default async function EarlyAccessJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; error?: string }>
}) {
  const { key, error } = await searchParams

  // Already signed in → straight to the edit.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/edit')

  const validKey = (key ?? '') === EARLY_ACCESS_INVITE_CODE

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-10">
          <p className="text-[11px] tracking-[0.35em] text-[#A8A8A4] mb-3">MYRA</p>
          <h1 className="text-[clamp(22px,4vw,32px)] tracking-[0.12em] text-[#4A4E57]">EARLY ACCESS</h1>
          <p className="mt-3 text-[11px] tracking-[0.18em] text-[#6B6B6B] leading-relaxed">
            {validKey
              ? 'Create your login to preview The Edit.'
              : 'This sign-up link is invalid or expired.'}
          </p>
        </div>

        {validKey ? (
          <>
            <form action={earlyAccessSignUp} className="flex flex-col gap-3">
              <input type="hidden" name="key" value={key} />
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="EMAIL"
                className={inputClass}
              />
              <input
                type="password"
                name="password"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="CREATE A PASSWORD (MIN 8 CHARS)"
                className={inputClass}
              />
              <input
                type="password"
                name="confirm"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="CONFIRM PASSWORD"
                className={inputClass}
              />

              {error && (
                <p className="text-[10px] tracking-[0.15em] text-[#B83A3A]">{error.toUpperCase()}</p>
              )}

              <button
                type="submit"
                className="mt-2 bg-[#0A0A0A] text-white py-3 text-[11px] tracking-[0.22em] hover:bg-[#333] transition-colors duration-300"
              >
                CREATE ACCOUNT
              </button>
            </form>

            <p className="mt-6 text-center text-[10px] tracking-[0.16em] text-[#A8A8A4]">
              ALREADY HAVE A LOGIN?{' '}
              <Link href="/earlyaccess" className="text-[#4A4E57] underline underline-offset-2">
                SIGN IN
              </Link>
            </p>
          </>
        ) : (
          <p className="text-center text-[10px] tracking-[0.18em] text-[#A8A8A4]">
            PLEASE USE THE INVITATION LINK YOU WERE SENT.
          </p>
        )}
      </div>
    </main>
  )
}
