import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase-server'
import { loadUserSizeProfile } from '@/lib/size-availability'
import SizeSettings from './SizeSettings'

export const dynamic = 'force-dynamic'

// Sizes and the pre-loved answer are editable at ANY time, not only at signup.
// Both change what she is shown rather than merely how it's ordered, so leaving
// them locked behind onboarding would mean the only way to correct a wrong
// answer is to be shown the wrong clothes forever.
export default async function SizeSettingsPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const ctx = await loadUserSizeProfile(user.id)

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 flex items-center justify-between px-5 h-14 border-b border-[#E2E0DB] bg-white">
        <Link href="/edit" className="text-[13px] tracking-[0.135em] text-[#4A4E57]">MYRA</Link>
        <Link
          href="/edit"
          className="text-[13px] tracking-[0.1em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors"
        >
          DONE
        </Link>
      </header>

      <main className="max-w-[620px] mx-auto px-5 py-10">
        <p className="text-[13px] tracking-[0.16em] text-[#A8A8A4] mb-2">YOUR SIZES</p>
        <h1 className="text-[clamp(24px,5vw,34px)] tracking-[0.04em] text-[#4A4E57] leading-tight mb-3">
          WHAT FITS YOU
        </h1>
        <p className="text-[15px] sm:text-[17px] text-[#6B6B6B] leading-relaxed mb-9 max-w-[520px]">
          We only style you in pieces you can buy. One-of-a-kind pieces outside your size are never
          shown — there&rsquo;s no restock coming. Everything else is simply sorted below what fits.
        </p>

        <SizeSettings
          initial={{
            tops: ctx.profile.tops ?? undefined,
            bottoms: ctx.profile.bottoms ?? undefined,
            outerwear: ctx.profile.outerwear ?? undefined,
            shoes: ctx.profile.shoes ?? undefined,
            acceptsSecondHand: ctx.acceptsSecondHand,
          }}
        />
      </main>
    </div>
  )
}
