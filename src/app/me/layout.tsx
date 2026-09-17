import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase-server'
import { earlyAccessSignOut } from '@/app/earlyaccess/actions'

export const dynamic = 'force-dynamic'

// The client area. Signed-in clients only — and note what this ISN'T: the
// client role grants nothing in /admin, which stays locked to the single
// hardcoded admin user id. Admin can look in here to see what she sees.
export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const role = (user.user_metadata as any)?.role
  const isAdmin = user.id === process.env.ADMIN_USER_ID
  if (role !== 'client' && !isAdmin) redirect('/edit')

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 flex items-center justify-between px-6 sm:px-10 h-16 border-b border-[#E2E0DB] bg-white">
        <Link href="/me" className="text-[20px] tracking-[0.2em] text-[#4A4E57]">MYRA</Link>
        {/* Her four rooms. Scrolls sideways on a phone rather than wrapping. */}
        <nav data-lenis-prevent className="flex items-center gap-5 sm:gap-8 overflow-x-auto whitespace-nowrap">
          <Link href="/me" className="text-[16px] sm:text-[18px] tracking-[0.1em] text-[#0A0A0A] hover:opacity-70 transition-opacity">FOR YOU</Link>
          <Link href="/me/looks" className="text-[16px] sm:text-[18px] tracking-[0.1em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">ALL LOOKS</Link>
          <Link href="/me/dressing-room" className="text-[16px] sm:text-[18px] tracking-[0.1em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">DRESSING ROOM</Link>
          <Link href="/me/magazine" className="text-[16px] sm:text-[18px] tracking-[0.1em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">MAGAZINE</Link>
          <Link href="/me/inspiration" className="text-[16px] sm:text-[18px] tracking-[0.1em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">INSPIRATION</Link>
          <Link href="/me/profile" className="text-[16px] sm:text-[18px] tracking-[0.1em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">PROFILE</Link>
          <form action={earlyAccessSignOut}>
            <button type="submit" className="text-[16px] sm:text-[18px] tracking-[0.1em] text-[#A8A8A4] hover:text-[#4A4E57] transition-colors">OUT</button>
          </form>
        </nav>
      </header>
      <main className="w-full px-6 sm:px-10 py-10">{children}</main>
    </div>
  )
}
