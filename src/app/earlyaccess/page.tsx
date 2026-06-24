import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { earlyAccessSignIn } from './actions'

export const dynamic = 'force-dynamic'

export default async function EarlyAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  // Already signed in → straight to the edit.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/edit')

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-10">
          <p className="text-[11px] tracking-[0.158em] text-[#A8A8A4] mb-3">MYRA</p>
          <h1 className="text-[clamp(22px,4vw,32px)] tracking-[0.054em] text-[#4A4E57]">EARLY ACCESS</h1>
          <p className="mt-3 text-[11px] tracking-[0.081em] text-[#6B6B6B] leading-relaxed">
            Sign in with the details you were given to preview The Edit.
          </p>
        </div>

        <form action={earlyAccessSignIn} className="flex flex-col gap-3">
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="EMAIL"
            className="w-full border border-[#E2E0DB] bg-white px-4 py-3 text-[12px] tracking-[0.054em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors"
          />
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="PASSWORD"
            className="w-full border border-[#E2E0DB] bg-white px-4 py-3 text-[12px] tracking-[0.054em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors"
          />

          {error && (
            <p className="text-[10px] tracking-[0.068em] text-[#B83A3A]">{error.toUpperCase()}</p>
          )}

          <button
            type="submit"
            className="mt-2 bg-[#0A0A0A] text-white py-3 text-[11px] tracking-[0.099em] hover:bg-[#333] transition-colors duration-300"
          >
            ENTER
          </button>
        </form>

        <p className="mt-8 text-center text-[9px] tracking-[0.081em] text-[#A8A8A4]">
          ACCESS BY INVITATION ONLY
        </p>
      </div>
    </main>
  )
}
