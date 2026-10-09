import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import MeChrome from './MeChrome'
import MeTour from '@/components/me/MeTour'
import ClientJourneyTracker from '@/components/analytics/ClientJourneyTracker'
import StylistChat from './StylistChat'
import { resolveClientMember } from '@/lib/client-member'
import NativeShareBridge from '@/components/me/NativeShareBridge'

export const dynamic = 'force-dynamic'

// The client area. Signed-in clients only — and note what this ISN'T: the
// client role grants nothing in /admin, which stays locked to the single
// hardcoded admin user id. Admin can look in here to see what she sees.
export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const isAdmin = user.id === process.env.ADMIN_USER_ID
  if (!isAdmin && !(await resolveClientMember())) redirect('/')

  return (
    <div className="min-h-screen myra-pearl myra-safe-top-pad">
      <div className="myra-safe-top" aria-hidden />
      <MeChrome />
      {/* pb-28 on a phone keeps the last of the page clear of the tab bar. */}
      <main className="w-full px-6 sm:pl-[232px] sm:pr-10 pt-10 pb-28 sm:pb-10">{children}</main>
      <MeTour />
      {/* The house of stylists, one button away on every page. */}
      <StylistChat />
      {/* Her visit, recorded for the JOURNEY tab. Mounted for clients only:
          admin reaches these pages to check what she sees, and Chloe's own
          browsing is not a client's journey. The tracker refuses to write for
          her anyway — this is the first of the two gates, not the only one. */}
      {!isAdmin && <ClientJourneyTracker />}
      {/* Inside the iPhone app: hand her sign-in to the share sheet, so
          "share to MYRA" from Safari works without the Safari extension. */}
      <NativeShareBridge />
    </div>
  )
}
