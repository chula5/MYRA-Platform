import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Both conditions must pass: valid session AND user ID matches ADMIN_USER_ID
  if (!user || user.id !== process.env.ADMIN_USER_ID) {
    redirect('/')
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      {/* Admin navigation bar */}
      <nav className="bg-[#0A0A0A] text-white px-10 h-14 flex items-center justify-between">
        <span className="text-[11px] tracking-[0.25em]">MYRA ADMIN STUDIO</span>
        <div className="flex items-center gap-6">
          <a
            href="/admin"
            className="text-[11px] tracking-[0.20em] text-white/70 hover:text-white transition-colors duration-300"
          >
            DASHBOARD
          </a>
          <a
            href="/admin/items"
            className="text-[11px] tracking-[0.20em] text-white/70 hover:text-white transition-colors duration-300"
          >
            ITEMS
          </a>
          <a
            href="/admin/projects"
            className="text-[11px] tracking-[0.20em] text-white/70 hover:text-white transition-colors duration-300"
          >
            PROJECTS
          </a>
          <a
            href="/admin/runway-search"
            className="text-[11px] tracking-[0.20em] text-white/70 hover:text-white transition-colors duration-300"
          >
            RUNWAY SEARCH
          </a>
          <a
            href="/admin/signups"
            className="text-[11px] tracking-[0.20em] text-white/70 hover:text-white transition-colors duration-300"
          >
            SIGN UPS
          </a>
          <a
            href="/"
            className="text-[11px] tracking-[0.20em] text-white/50 hover:text-white transition-colors duration-300"
          >
            ← FRONT END
          </a>
        </div>
      </nav>

      <div className="max-w-[1440px] mx-auto px-10 py-10">
        {children}
      </div>
    </div>
  )
}
