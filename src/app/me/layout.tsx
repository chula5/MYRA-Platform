import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { earlyAccessSignOut } from '@/app/earlyaccess/actions'
import MeChrome from './MeChrome'
import MeTour from '@/components/me/MeTour'

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
    <div className="min-h-screen myra-pearl">
      <MeChrome
        signOut={
          <form action={earlyAccessSignOut}>
            <button type="submit" className="text-[20px] tracking-[0.1em] text-[#A8A8A4] hover:text-[#4A4E57] transition-colors">OUT</button>
          </form>
        }
      />
      <main className="w-full px-6 sm:px-10 py-10">{children}</main>
      <MeTour />
    </div>
  )
}
