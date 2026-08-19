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
      <header className="sticky top-0 z-30 flex items-center justify-between px-5 h-14 border-b border-[#E2E0DB] bg-white">
        <Link href="/me" className="text-[13px] tracking-[0.135em] text-[#4A4E57]">MYRA</Link>
        <nav className="flex items-center gap-4">
          <Link href="/me" className="text-[10px] tracking-[0.12em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">PROFILE</Link>
          <Link href="/me/inspiration" className="text-[10px] tracking-[0.12em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">INSPIRATION</Link>
          <form action={earlyAccessSignOut}>
            <button type="submit" className="text-[10px] tracking-[0.12em] text-[#A8A8A4] hover:text-[#4A4E57] transition-colors">OUT</button>
          </form>
        </nav>
      </header>
      <main className="max-w-[720px] mx-auto px-5 py-8">{children}</main>
    </div>
  )
}
