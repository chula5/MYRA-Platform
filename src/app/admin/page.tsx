import { getAdminStats } from '@/lib/admin-queries'
import { createServerClient } from '@/lib/supabase-server'
import StockSweepButton from '@/components/admin/StockSweepButton'
import { getStylistBySlug, loadAutonomy } from '@/lib/stylist-store'
import { autonomyProgress } from '@/lib/autonomy'

export default async function AdminDashboard() {
  const stats = await getAdminStats()

  const supabase = await createServerClient()
  const { count: waitlistCount } = await supabase
    .from('waitlist')
    .select('*', { count: 'exact', head: true })

  // Autonomy graduation — shown prominently: the current publishing stage.
  const chloe = await getStylistBySlug('chloe')
  const autonomy = chloe ? autonomyProgress(await loadAutonomy(chloe.stylist_id)) : null

  // Outfits kicked back from the mobile review queue ("none of these").
  const { count: needsDesktopCount } = await supabase
    .from('outfit')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'needs_desktop' as any)

  return (
    <div>
      {/* Header */}
      <div className="mb-10">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-2">MYRA ADMIN STUDIO</p>
            <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57]">DASHBOARD</h1>
          </div>
          <a
            href="/studio/review"
            className="inline-flex items-center gap-2 bg-[#0A0A0A] text-white px-5 py-2.5 rounded-[12px] text-[10px] tracking-[0.09em] hover:opacity-85 transition-opacity"
          >
            ▶ MOBILE REVIEW QUEUE
          </a>
        </div>
      </div>

      {/* Autonomy graduation tracker */}
      {autonomy && (
        <div className="mb-8 border border-[#0A0A0A] bg-white rounded-[14px] p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[9px] tracking-[0.2em] text-[#C4A882] mb-1">AUTONOMY · STAGE {autonomy.stage} OF 3</p>
              <p className="text-[20px] tracking-[0.06em] text-[#0A0A0A]">{autonomy.stageLabel}</p>
              <p className="text-[10px] tracking-[0.05em] text-[#6B6B6B] mt-1 max-w-xl leading-relaxed">{autonomy.nextTrigger}</p>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-center">
                <p className="text-[24px] tracking-[0.03em] text-[#4A4E57] leading-none">
                  {autonomy.streak}<span className="text-[#A8A8A4]">/{autonomy.streakTarget}</span>
                </p>
                <p className="text-[8px] tracking-[0.14em] text-[#A8A8A4] mt-1">CLEAN STREAK</p>
              </div>
              <div className="text-center">
                <p className={`text-[24px] tracking-[0.03em] leading-none ${autonomy.swapRate >= autonomy.swapRateCeiling ? 'text-[#B83A3A]' : 'text-[#4A4E57]'}`}>
                  {Math.round(autonomy.swapRate * 100)}%
                </p>
                <p className="text-[8px] tracking-[0.14em] text-[#A8A8A4] mt-1">TRAILING SWAP RATE</p>
              </div>
              {autonomy.stage >= 2 && (
                <a href="/admin/audit" className="bg-[#0A0A0A] text-white px-5 py-2.5 text-[10px] tracking-[0.14em] rounded-full hover:opacity-85 transition-opacity">
                  OPEN AUDIT →
                </a>
              )}
            </div>
          </div>
          {/* Streak progress bar */}
          <div className="mt-4 h-[5px] bg-[#F2F2F0] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#C4A882] rounded-full transition-all"
              style={{ width: `${Math.min(100, (autonomy.streak / autonomy.streakTarget) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Kicked back from mobile — needs the desktop studio */}
      {(needsDesktopCount ?? 0) > 0 && (
        <a
          href="/admin/outfit-review"
          className="block mb-6 p-4 border border-[#E2D6B8] bg-[#FBF6E9] rounded-[12px] hover:border-[#C4A882] transition-colors duration-300"
        >
          <p className="text-[10px] tracking-[0.09em] text-[#8A6D3B]">
            {needsDesktopCount} OUTFIT{(needsDesktopCount ?? 0) === 1 ? '' : 'S'} FLAGGED “NEEDS DESKTOP” FROM MOBILE REVIEW · OPEN →
          </p>
        </a>
      )}

      {/* Stock alert — only shown when there's something to fix */}
      {stats.outOfStockItems + stats.lowStockItems > 0 && (
        <a
          href="/admin/items?stock=flagged"
          className="block mb-6 p-4 border border-[#E8B4B4] bg-[#FDECEC] rounded-[12px] hover:border-[#B83A3A] transition-colors duration-300"
        >
          <p className="text-[10px] tracking-[0.09em] text-[#B83A3A]">
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
      <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-4">CLOSED LOOP</p>
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
        <StudioCard
          title="ADD & COMPOSE"
          description="Paste product URLs — each is scraped, scored, saved, and instantly composed into outfit options anchored on the new piece (like the Composer). Approve looks straight to drafts."
          href="/admin/ingest-compose"
        />
        <StudioCard
          title="DRAFT COLLECTIONS"
          description="Click a brand you've added and an agent checks its site for a new collection (or Scan All). Accept the pieces you like — each is added and composed into outfits; YES fires the refined shoot and trains the Style Brain."
          href="/admin/collections"
        />
      </div>

      {/* Studio areas */}
      <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-4">STUDIO</p>
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

      {/* Insights & tools — the remaining sections from the top bar */}
      <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-4 mt-12">INSIGHTS &amp; TOOLS</p>
      <div className="grid grid-cols-4 gap-6">
        <StudioCard
          title="STYLE BRAIN"
          description="Learns which combinations you approve in the Composer + Outfit Review, and re-ranks future suggestions toward your taste. Shows your learned house style."
          href="/admin/style-brain"
        />
        <StudioCard
          title="OUTFIT REVIEW"
          description="Review composed outfits before they go live — approve, adjust, or reject each look."
          href="/admin/outfit-review"
        />
        <StudioCard
          title="PIPELINE"
          description="Self-critiquing composer queue — outfits are vector-scored and confidence-gated before review. Fast lane for one-tap approvals, standard lane with reasons."
          href="/admin/pipeline"
        />
        <StudioCard
          title="EXTRA STYLE OUTFITS"
          description="Pieces styled into just one outfit so far. Propose fresh looks for each — swap/add, approve to a draft with a Higgsfield shoot, and train the Style Brain."
          href="/admin/extra-styles"
        />
        <StudioCard
          title="VECTORS"
          description="Inspect and backfill the AI taste vectors that score and rank every outfit."
          href="/admin/vectors"
        />
        <StudioCard
          title="SOCIAL"
          description="Turn live outfits into social-media posts and manage what goes out."
          href="/admin/social"
        />
        <StudioCard
          title="RUNWAY SEARCH"
          description="Search runway looks to source inspiration and build new outfits."
          href="/admin/runway-search"
        />
        <StudioCard
          title="ANALYTICS"
          description="Landing-page traffic, account sign-ups, retention, location, and repeat-use stats."
          href="/admin/analytics"
        />
        <StudioCard
          title="PREFERENCES"
          description="What sign-ups are into — onboarding picks, most-clicked items, top searches, plus brand requests and feedback."
          href="/admin/signup-preferences"
        />
        <StudioCard
          title="PRODUCT VIEW"
          description="Live, interactive previews of MYRA's key flows — the screens to capture for a product reel."
          href="/admin/product-view"
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
        className="text-[#4A4E57] mb-1 tracking-[0.036em]"
        style={{ fontSize: '32px', lineHeight: 1 }}
      >
        {value}
      </p>
      <p className="text-[10px] tracking-[0.09em] text-[#4A4E57] mb-3">{label}</p>
      <p className="text-[9px] tracking-[0.054em] text-[#A8A8A4]">{breakdown}</p>
    </>
  )

  if (href) {
    return (
      <a href={href} className="block bg-white border border-[#E2E0DB] p-6 rounded-[12px] hover:border-[#0A0A0A] transition-colors duration-300">
        {inner}
      </a>
    )
  }

  return (
    <div className="bg-white border border-[#E2E0DB] p-6 rounded-[12px]">
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
        block border border-[#E2E0DB] bg-white p-8 rounded-[12px]
        transition-all duration-400
        hover:border-[#0A0A0A] hover:shadow-[0_2px_16px_rgba(0,0,0,0.06)]
        group
      "
    >
      <p className="text-[13px] tracking-[0.081em] text-[#4A4E57] mb-3">{title}</p>
      <p className="text-[11px] tracking-[0.054em] text-[#6B6B6B] leading-relaxed">{description}</p>
      <p className="mt-6 text-[11px] tracking-[0.081em] text-[#A8A8A4] group-hover:text-[#4A4E57] transition-colors duration-300">
        OPEN →
      </p>
    </a>
  )
}
