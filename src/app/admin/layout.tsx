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
        <a href="/admin" className="text-[11px] tracking-[0.113em] hover:text-white/70 transition-colors duration-300">MYRA ADMIN STUDIO</a>
        <div className="flex items-center gap-6">
          <a
            href="/admin"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            DASHBOARD
          </a>
          <a
            href="/admin/items"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            ITEMS
          </a>
          <a
            href="/admin/projects"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            PROJECTS
          </a>
          <a
            href="/admin/composer"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            COMPOSER
          </a>
          <a
            href="/admin/outfit-review"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            OUTFIT REVIEW
          </a>
          <a
            href="/admin/vectors"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            VECTORS
          </a>
          <a
            href="/admin/style-brain"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            STYLE BRAIN
          </a>
          <a
            href="/admin/the-edit"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            THE EDIT
          </a>
          <a
            href="/admin/social"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            SOCIAL
          </a>
          <a
            href="/admin/early-access"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            EARLY ACCESS
          </a>
          <a
            href="/admin/ingest"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            INGEST
          </a>
          <a
            href="/admin/ingest-compose"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            ADD &amp; COMPOSE
          </a>
          <a
            href="/admin/collections"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            COLLECTIONS
          </a>
          <a
            href="/admin/runway-search"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            RUNWAY SEARCH
          </a>
          <a
            href="/admin/signups"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            SIGN UPS
          </a>
          <a
            href="/admin/analytics"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            ANALYTICS
          </a>
          <a
            href="/admin/signup-preferences"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            PREFERENCES
          </a>
          <a
            href="/admin/product-view"
            className="text-[11px] tracking-[0.09em] text-white/70 hover:text-white transition-colors duration-300"
          >
            PRODUCT VIEW
          </a>
          <a
            href="/"
            className="text-[11px] tracking-[0.09em] text-white/50 hover:text-white transition-colors duration-300"
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
