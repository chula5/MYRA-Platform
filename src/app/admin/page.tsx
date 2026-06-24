import { getAdminStats } from '@/lib/admin-queries'
import { createServerClient } from '@/lib/supabase-server'
import StockSweepButton from '@/components/admin/StockSweepButton'

export default async function AdminDashboard() {
  const stats = await getAdminStats()

  const supabase = await createServerClient()
  const { count: waitlistCount } = await supabase
    .from('waitlist')
    .select('*', { count: 'exact', head: true })

  return (
    <div>
      {/* Header */}
      <div className="mb-10">
        <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">MYRA ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.10em] text-[#4A4E57]">DASHBOARD</h1>
      </div>

      {/* Stock alert — only shown when there's something to fix */}
      {stats.outOfStockItems + stats.lowStockItems > 0 && (
        <a
          href="/admin/items?stock=flagged"
          className="block mb-6 p-4 border border-[#E8B4B4] bg-[#FDECEC] rounded-[3px] hover:border-[#B83A3A] transition-colors duration-300"
        >
          <p className="text-[10px] tracking-[0.20em] text-[#B83A3A]">
            {stats.outOfStockItems} OUT OF STOCK
            {stats.lowStockItems > 0 ? ` · ${stats.lowStockItems} LOW STOCK` : ''} · REVIEW →
          </p>
        </a>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-6 gap-4 mb-12">
        <StatCard
          label="ITEMS"
          value={stats.totalItems}
          breakdown={`${stats.draftItems} DRAFT / ${stats.readyItems} READY / ${stats.liveItems} LIVE`}
        />
        <StatCard
          label="OUTFITS"
          value={stats.totalOutfits}
          breakdown={`${stats.draftOutfits} DRAFT / ${stats.liveOutfits} LIVE`}
        />
        <StatCard
          label="PROJECTS"
          value={stats.totalProjects}
          breakdown={`${stats.draftProjects} DRAFT / ${stats.liveProjects} LIVE`}
        />
        <StatCard
          label="STOCK FLAGS"
          value={stats.outOfStockItems + stats.lowStockItems}
          breakdown={`${stats.outOfStockItems} OUT / ${stats.lowStockItems} LOW`}
          href="/admin/items?stock=flagged"
        />
        <StatCard
          label="PUBLISHED TODAY"
          value={stats.publishedToday}
          breakdown="OUTFITS PUBLISHED"
        />
        <StatCard
          label="WAITLIST"
          value={waitlistCount ?? 0}
          breakdown="SIGNUPS"
          href="/admin/signups"
        />
      </div>

      {/* Stock sweep */}
      <div className="mb-12">
        <StockSweepButton />
      </div>

      {/* Closed-loop studio — composition + ingest, the scale layer */}
      <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-4">CLOSED LOOP</p>
      <div className="grid grid-cols-2 gap-6 mb-10">
        <StudioCard
          title="OUTFIT COMPOSER"
          description="Pick any item as anchor. The composer assembles coherent outfit candidates from your existing library, ranked by compositional fit. Approve to drop straight into a draft project."
          href="/admin/composer"
        />
        <StudioCard
          title="BATCH INGEST"
          description="Paste a list of product URLs or a single collection page. Each item is scraped, pre-scored against the MYRA taxonomy, and queued for one-click bulk approval into the library."
          href="/admin/ingest"
        />
      </div>

      {/* Studio areas */}
      <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-4">STUDIO</p>
      <div className="grid grid-cols-4 gap-6">
        <StudioCard
          title="THE EDIT — PREVIEW"
          description="See your LIVE outfits exactly as users will in The Edit, and click through to test the experience — privately, before it goes public. Includes a (locked) Go Live button."
          href="/admin/the-edit"
        />
        <StudioCard
          title="EARLY ACCESS"
          description="Create email + password logins for people to preview The Edit at /earlyaccess. They can search occasions and browse outfits only — no admin access."
          href="/admin/early-access"
        />
        <StudioCard
          title="ITEM LIBRARY"
          description="Upload, score, and manage individual items before adding them to outfits."
          href="/admin/items"
        />
        <StudioCard
          title="OUTFIT PROJECTS"
          description="Build, review, and publish outfit collections. Projects contain one or more outfits."
          href="/admin/projects"
        />
        <StudioCard
          title="TASTE BRAIN"
          description="Aggregated signal from every item you've logged. Top brands, recurring colours, price tiers, recent activity."
          href="/admin/taste"
        />
        <StudioCard
          title="DISCOVERIES"
          description="Similar pieces surfaced by AI based on items you've added. Review and save the ones you like."
          href="/admin/discoveries"
        />
        <StudioCard
          title="WAITLIST SIGNUPS"
          description="View everyone who has joined the waitlist from the public site."
          href="/admin/signups"
        />
        <StudioCard
          title="ARCHIVE"
          description="Retired projects and outfits. Items within archived projects remain visible in history."
          href="/admin/projects?filter=archived"
        />
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  breakdown,
  href,
}: {
  label: string
  value: number
  breakdown: string
  href?: string
}) {
  const inner = (
    <>
      <p
        className="text-[#4A4E57] mb-1 tracking-[0.08em]"
        style={{ fontSize: '32px', lineHeight: 1 }}
      >
        {value}
      </p>
      <p className="text-[10px] tracking-[0.20em] text-[#4A4E57] mb-3">{label}</p>
      <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4]">{breakdown}</p>
    </>
  )

  if (href) {
    return (
      <a href={href} className="block bg-white border border-[#E2E0DB] p-6 rounded-[3px] hover:border-[#0A0A0A] transition-colors duration-300">
        {inner}
      </a>
    )
  }

  return (
    <div className="bg-white border border-[#E2E0DB] p-6 rounded-[3px]">
      {inner}
    </div>
  )
}

function StudioCard({
  title,
  description,
  href,
}: {
  title: string
  description: string
  href: string
}) {
  return (
    <a
      href={href}
      className="
        block border border-[#E2E0DB] bg-white p-8 rounded-[3px]
        transition-all duration-400
        hover:border-[#0A0A0A] hover:shadow-[0_2px_16px_rgba(0,0,0,0.06)]
        group
      "
    >
      <p className="text-[13px] tracking-[0.18em] text-[#4A4E57] mb-3">{title}</p>
      <p className="text-[11px] tracking-[0.12em] text-[#6B6B6B] leading-relaxed">{description}</p>
      <p className="mt-6 text-[11px] tracking-[0.18em] text-[#A8A8A4] group-hover:text-[#4A4E57] transition-colors duration-300">
        OPEN →
      </p>
    </a>
  )
}
