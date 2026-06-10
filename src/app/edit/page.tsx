import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import FeedClient from '@/app/feed/FeedClient'
import { earlyAccessSignOut } from '@/app/earlyaccess/actions'

export const dynamic = 'force-dynamic'

export default async function EditPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Early-access (or admin) sign-in required.
  if (!user) redirect('/earlyaccess')

  return (
    <div className="min-h-screen bg-white">
      {/* Minimal header */}
      <header className="flex items-center justify-between px-8 h-14 border-b border-[#E2E0DB]">
        <p className="text-[13px] tracking-[0.30em] text-[#0A0A0A]">MYRA</p>
        <div className="flex items-center gap-5">
          <span className="text-[10px] tracking-[0.20em] text-[#A8A8A4]">THE EDIT · EARLY ACCESS</span>
          <form action={earlyAccessSignOut}>
            <button
              type="submit"
              className="text-[10px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#0A0A0A] border border-[#E2E0DB] hover:border-[#0A0A0A] px-4 py-2 transition-colors duration-300"
            >
              SIGN OUT
            </button>
          </form>
        </div>
      </header>

      {/* The Edit — occasion search + browse (read-only). Reads live outfits. */}
      <FeedClient showAllOption />
    </div>
  )
}
