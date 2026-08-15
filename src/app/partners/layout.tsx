import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getPartnerContext } from '@/lib/partners/auth'

export const dynamic = 'force-dynamic'

// Brand partner area (Part 4). Completely separate context from shoppers AND
// from /admin: access requires a merchant_user mapping, every view is scoped
// to that one merchant, and financial tables are additionally protected by
// row-level security keyed to the same mapping.
export default async function PartnersLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const path = h.get('x-invoke-path') ?? ''
  const ctx = await getPartnerContext()

  // Public sub-pages (login / join / apply) handle their own flow.
  if (!ctx) {
    // Next doesn't give layouts the path reliably; public pages below render
    // their own shell, so only gate here when we KNOW there's no context and
    // let the page-level checks handle redirects for protected pages.
    return <>{children}</>
  }

  const nav = [
    ['/partners', 'OVERVIEW'],
    ['/partners/products', 'PRODUCTS'],
    ['/partners/orders', 'ORDERS'],
    ['/partners/statements', 'STATEMENTS'],
    ['/partners/settings', 'SETTINGS'],
  ] as const

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <nav className="bg-[#0A0A0A] text-white">
        <div className="max-w-[1200px] mx-auto px-6 py-4 flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-[12px] tracking-[0.14em]">MYRA PARTNERS</span>
            <span className="text-[9px] tracking-[0.1em] text-[#C4A882] border border-[#C4A882]/40 rounded-full px-2.5 py-0.5">
              {ctx.merchantName.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-5 flex-wrap">
            {nav.map(([href, label]) => (
              <a key={href} href={href} className="text-[10px] tracking-[0.1em] text-white/70 hover:text-white transition-colors">
                {label}
              </a>
            ))}
            <form action="/partners/login/signout" method="post">
              <button className="text-[10px] tracking-[0.1em] text-white/40 hover:text-white transition-colors">SIGN OUT</button>
            </form>
          </div>
        </div>
      </nav>
      <div className="max-w-[1200px] mx-auto px-6 py-10">{children}</div>
    </div>
  )
}
