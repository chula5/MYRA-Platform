import { getAdminStats } from '@/lib/admin-queries'
import { createServerClient } from '@/lib/supabase-server'
import StockSweepButton from '@/components/admin/StockSweepButton'
import { getStylistBySlug, loadAutonomy } from '@/lib/stylist-store'
import { autonomyProgress } from '@/lib/autonomy'
import { getDashboardMetrics, type MetricKey } from '@/lib/dashboard-metrics'
import { getNetworkStatuses } from '@/lib/networks/sync'
import MetricTile from '@/components/admin/charts/MetricTile'
import TrendChart from '@/components/admin/charts/TrendChart'
import { ShareBar } from '@/components/admin/charts/RankBars'
import AreaHealthCard from './AreaHealthCard'
import { SERIES } from '@/components/admin/charts/palette'

export const dynamic = 'force-dynamic'

// Tiles are ordered by what you'd want to know first thing in the morning:
// money made, work produced, quality of that work, then demand.
const HEADLINE: { key: MetricKey; large?: boolean }[] = [
  { key: 'commission' },
  { key: 'outfits-generated' },
  { key: 'swap-rate' },
  { key: 'retailer-clicks' },
  { key: 'saves' },
  { key: 'cost-per-signup' },
]

function gbp0(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function int(n: number): string {
  return Math.round(n).toLocaleString('en-GB')
}

function formatValue(kind: string, v: number): string {
  if (kind === 'gbp0') return gbp0(v)
  if (kind === 'gbp') return `£${v.toFixed(2)}`
  if (kind === 'pct') return pct(v)
  return int(v)
}

export default async function AdminDashboard() {
  const [stats, perf, networks] = await Promise.all([
    getAdminStats(),
    getDashboardMetrics(),
    getNetworkStatuses(),
  ])

  const supabase = await createServerClient()
  const { count: waitlistCount } = await supabase
    .from('waitlist')
    .select('*', { count: 'exact', head: true })

  // Autonomy graduation — the current publishing stage.
  const chloe = await getStylistBySlug('chloe')
  const autonomy = chloe ? autonomyProgress(await loadAutonomy(chloe.stylist_id)) : null

  // Outfits kicked back from the mobile review queue ("none of these").
  const { count: needsDesktopCount } = await supabase
    .from('outfit')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'needs_desktop' as any)

  const { metrics, areas, money, buckets } = perf
  const weekLabels = buckets.map((b) => b.label)
  const lastCompleteLabel = weekLabels[weekLabels.length - 2] ?? weekLabels[weekLabels.length - 1]

  const netThisWeek = money.netThisWeek
  const connectedNetworks = networks.filter((n) => n.network !== 'meta' && n.configured).length
  const anyCommissionData = money.byNetwork.some((n) => n.value > 0)

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-2">MYRA ADMIN STUDIO</p>
            <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57]">DASHBOARD</h1>
            <p className="text-[9px] tracking-[0.14em] text-[#A8A8A4] mt-2">
              PERFORMANCE FOR THE WEEK OF {lastCompleteLabel} · LAST COMPLETE WEEK
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/admin/commissions"
              className="inline-flex items-center gap-2 border border-[#0A0A0A] px-5 py-2.5 rounded-[12px] text-[10px] tracking-[0.14em] text-[#0A0A0A] hover:bg-[#F2F2F0] transition-colors duration-300"
            >
              COMMISSIONS →
            </a>
            <a
              href="/studio/review"
              className="inline-flex items-center gap-2 bg-[#0A0A0A] text-white px-5 py-2.5 rounded-[12px] text-[10px] tracking-[0.09em] hover:opacity-85 transition-opacity"
            >
              ▶ MOBILE REVIEW QUEUE
            </a>
          </div>
        </div>
      </div>

      {/* ── Money ────────────────────────────────────────────────────────────
          Commission and spend are both GBP per week, so they belong on one
          axis in one chart. Anything measured differently gets its own. */}
      <div className="grid grid-cols-12 gap-5 mb-6">
        <div className="col-span-12 lg:col-span-5 bg-[#0A0A0A] text-white rounded-[16px] p-7 flex flex-col justify-between">
          <div>
            <p className="text-[9px] tracking-[0.2em] text-[#C4A882] mb-5">MONEY · WEEK OF {lastCompleteLabel}</p>

            <p className="text-[11px] tracking-[0.14em] text-white/50 mb-1">COMMISSION EARNED</p>
            <p className="text-[46px] leading-none tracking-[0.02em]">{gbp0(money.commissionThisWeek)}</p>
            <p className="text-[9px] tracking-[0.09em] text-white/40 mt-2">
              {money.commissionPrevWeek > 0
                ? `${money.commissionThisWeek >= money.commissionPrevWeek ? '↑' : '↓'} FROM ${gbp0(money.commissionPrevWeek)} THE WEEK BEFORE`
                : 'NO PRIOR WEEK TO COMPARE'}
            </p>

            <div className="grid grid-cols-2 gap-6 mt-8 pt-6 border-t border-white/12">
              <div>
                <p className="text-[9px] tracking-[0.14em] text-white/40 mb-1.5">AD SPEND</p>
                <p className="text-[22px] leading-none tracking-[0.02em]">{gbp0(money.spendThisWeek)}</p>
              </div>
              <div>
                <p className="text-[9px] tracking-[0.14em] text-white/40 mb-1.5">NET</p>
                <p
                  className="text-[22px] leading-none tracking-[0.02em]"
                  style={{ color: netThisWeek >= 0 ? '#C4A882' : '#E8A0A0' }}
                >
                  {netThisWeek >= 0 ? '' : '−'}
                  {gbp0(Math.abs(netThisWeek))}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8 flex items-center gap-3">
            <a
              href="/admin/commissions"
              className="text-[9px] tracking-[0.14em] text-white/60 hover:text-white transition-colors duration-300"
            >
              COMMISSIONS →
            </a>
            <span className="text-white/20">·</span>
            <a
              href="/admin/ad-spend"
              className="text-[9px] tracking-[0.14em] text-white/60 hover:text-white transition-colors duration-300"
            >
              AD SPEND →
            </a>
            <span className="ml-auto text-[8px] tracking-[0.14em] text-white/30">
              {connectedNetworks}/3 NETWORKS CONNECTED
            </span>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-7 bg-white border border-[#E2E0DB] rounded-[16px] p-6">
          <div className="flex items-baseline justify-between mb-4">
            <p className="text-[10px] tracking-[0.14em] text-[#4A4E57]">COMMISSION vs AD SPEND · GBP PER WEEK</p>
            <a href="/admin/metrics/commission" className="text-[9px] tracking-[0.14em] text-[#A8A8A4] hover:text-[#0A0A0A] transition-colors duration-300">
              DETAIL →
            </a>
          </div>

          {money.commissionsTableReady || money.adSpendTableReady ? (
            <TrendChart
              labels={weekLabels}
              series={[
                { name: 'COMMISSION', values: money.commissionSeries, colour: SERIES[0] },
                { name: 'AD SPEND', values: money.spendSeries, colour: SERIES[2] },
              ]}
              height={190}
              format="gbp0"
            />
          ) : (
            <NotMigrated />
          )}

          <div className="mt-6 pt-5 border-t border-[#F2F2F0]">
            <p className="text-[9px] tracking-[0.14em] text-[#A8A8A4] mb-3">
              COMMISSION BY NETWORK · LAST {weekLabels.length} WEEKS
            </p>
            {anyCommissionData ? (
              <ShareBar parts={money.byNetwork} format={(n) => gbp0(n)} />
            ) : (
              <p className="text-[9px] tracking-[0.09em] text-[#C9C7C2]">
                NO COMMISSION SYNCED YET · CONNECT A NETWORK ON THE COMMISSIONS PAGE
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Alerts ───────────────────────────────────────────────────────── */}
      {metrics['swap-rate'].alert && (
        <a
          href="/admin/outfit-review"
          className="block mb-4 p-4 border border-[#E8B4B4] bg-[#FDECEC] rounded-[12px] hover:border-[#B83A3A] transition-colors duration-300"
        >
          <p className="text-[10px] tracking-[0.09em] text-[#B83A3A]">
            SWAP RATE {pct(metrics['swap-rate'].current)} · {metrics['swap-rate'].alert} · REVIEW →
          </p>
        </a>
      )}

      {(needsDesktopCount ?? 0) > 0 && (
        <a
          href="/admin/outfit-review"
          className="block mb-4 p-4 border border-[#E2D6B8] bg-[#FBF6E9] rounded-[12px] hover:border-[#C4A882] transition-colors duration-300"
        >
          <p className="text-[10px] tracking-[0.09em] text-[#8A6D3B]">
            {needsDesktopCount} OUTFIT{(needsDesktopCount ?? 0) === 1 ? '' : 'S'} FLAGGED “NEEDS DESKTOP” FROM MOBILE REVIEW · OPEN →
          </p>
        </a>
      )}

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

      {/* ── Headline metrics ─────────────────────────────────────────────────
          Every tile opens the same metric in full: the whole series, how it is
          defined, and the breakdown behind it. */}
      <div className="flex items-baseline justify-between mb-4 mt-8">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B]">PERFORMANCE · WEEK ON WEEK</p>
        <p className="text-[9px] tracking-[0.09em] text-[#C9C7C2]">CLICK ANY METRIC FOR THE FULL SERIES</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
        {HEADLINE.map(({ key }) => {
          const m = metrics[key]
          return (
            <MetricTile
              key={key}
              label={m.label}
              value={formatValue(m.format, m.current)}
              sub={m.sub}
              href={`/admin/metrics/${m.key}`}
              delta={m.delta}
              deltaInverted={m.inverted}
              series={m.series}
              colour={m.colour}
              tone={m.alert ? 'critical' : undefined}
            />
          )
        })}
      </div>

      {/* ── Area health ─────────────────────────────────────────────────────
          Each studio area reduced to the one number that says whether it needs
          you today. */}
      <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-4">AREA HEALTH</p>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-10">
        {areas.map((a) => (
          <AreaHealthCard key={a.label} area={a} />
        ))}
      </div>

      {/* ── Autonomy graduation ─────────────────────────────────────────── */}
      {autonomy && (
        <div className="mb-10 border border-[#0A0A0A] bg-white rounded-[14px] p-6">
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
          <div className="mt-4 h-[5px] bg-[#F2F2F0] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#C4A882] rounded-full transition-all"
              style={{ width: `${Math.min(100, (autonomy.streak / autonomy.streakTarget) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Library ─────────────────────────────────────────────────────────
          Counts, not performance — the standing size of the operation. */}
      <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-4">LIBRARY</p>
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard label="ITEMS" value={stats.totalItems} breakdown={`${stats.draftItems} DRAFT / ${stats.readyItems} READY / ${stats.liveItems} LIVE`} href="/admin/items" />
        <StatCard label="OUTFITS" value={stats.totalOutfits} breakdown={`${stats.draftOutfits} DRAFT / ${stats.liveOutfits} LIVE`} href="/admin/projects" />
        <StatCard label="PROJECTS" value={stats.totalProjects} breakdown={`${stats.draftProjects} DRAFT / ${stats.liveProjects} LIVE`} href="/admin/projects" />
        <StatCard label="STOCK FLAGS" value={stats.outOfStockItems + stats.lowStockItems} breakdown={`${stats.outOfStockItems} OUT / ${stats.lowStockItems} LOW`} href="/admin/items?stock=flagged" />
        <StatCard label="PUBLISHED TODAY" value={stats.publishedToday} breakdown="OUTFITS PUBLISHED" href="/admin/the-edit" />
        <StatCard label="WAITLIST" value={waitlistCount ?? 0} breakdown="SIGNUPS" href="/admin/signups" />
      </div>

      <div className="mb-12">
        <StockSweepButton />
      </div>

      {/* ── Closed loop ─────────────────────────────────────────────────── */}
      <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-4">CLOSED LOOP</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-10">
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
          description="Paste product URLs — each is scraped, scored, saved, and instantly composed into outfit options anchored on the new piece. Approve looks straight to drafts."
          href="/admin/ingest-compose"
        />
        <StudioCard
          title="DRAFT COLLECTIONS"
          description="Click a brand you've added and an agent checks its site for a new collection (or Scan All). Accept the pieces you like — each is added and composed into outfits."
          href="/admin/collections"
        />
      </div>

      {/* ── Everywhere else ─────────────────────────────────────────────────
          Compact, because this is navigation — the numbers above are the page. */}
      <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-4">STUDIO &amp; TOOLS</p>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="
              group block border border-[#E2E0DB] bg-white p-5 rounded-[12px]
              transition-all duration-300 hover:border-[#0A0A0A] hover:shadow-[0_2px_16px_rgba(0,0,0,0.05)]
            "
          >
            <p className="text-[11px] tracking-[0.081em] text-[#4A4E57] mb-2">{l.title}</p>
            <p className="text-[9px] tracking-[0.054em] text-[#A8A8A4] leading-relaxed">{l.blurb}</p>
            <p className="mt-4 text-[9px] tracking-[0.14em] text-[#C9C7C2] group-hover:text-[#0A0A0A] transition-colors duration-300">
              OPEN →
            </p>
          </a>
        ))}
      </div>
    </div>
  )
}

const LINKS: { title: string; blurb: string; href: string }[] = [
  { title: 'THE EDIT — PREVIEW', blurb: 'Your live outfits exactly as users see them, before it goes public.', href: '/admin/the-edit' },
  { title: 'EARLY ACCESS', blurb: 'Email + password logins for invited people to browse The Edit.', href: '/admin/early-access' },
  { title: 'ITEM LIBRARY', blurb: 'Upload, score and manage individual items.', href: '/admin/items' },
  { title: 'OUTFIT PROJECTS', blurb: 'Build, review and publish outfit collections.', href: '/admin/projects' },
  { title: 'OUTFIT REVIEW', blurb: 'Approve, adjust or reject each look before it goes live.', href: '/admin/outfit-review' },
  { title: 'PIPELINE', blurb: 'Vector-scored, confidence-gated composer queue.', href: '/admin/pipeline' },
  { title: 'STYLE BRAIN', blurb: 'What you approve, learned and fed back into ranking.', href: '/admin/style-brain' },
  { title: 'TASTE BRAIN', blurb: 'Aggregated signal from every item you have logged.', href: '/admin/taste' },
  { title: 'STYLISTS', blurb: 'Lenses over one shared library, each with its own constitution.', href: '/admin/stylists' },
  { title: 'AUDIT', blurb: 'Auto-published looks, with one-tap pull.', href: '/admin/audit' },
  { title: 'EXTRA STYLE OUTFITS', blurb: 'Pieces styled into only one outfit so far.', href: '/admin/extra-styles' },
  { title: 'VECTORS', blurb: 'Inspect and backfill the taste vectors behind every score.', href: '/admin/vectors' },
  { title: 'STOCK IMPACT', blurb: 'Outfits carrying low or out-of-stock items.', href: '/admin/stock-impact' },
  { title: 'DISCOVERIES', blurb: 'Similar pieces surfaced from what you have added.', href: '/admin/discoveries' },
  { title: 'PEOPLE', blurb: 'Every account and what they saved, liked and clicked through to.', href: '/admin/people' },
  { title: 'COMMISSIONS', blurb: 'Awin, Rakuten and CJ earnings in one ledger.', href: '/admin/commissions' },
  { title: 'AD SPEND', blurb: 'Meta spend against sign-ups, clicks and commission.', href: '/admin/ad-spend' },
  { title: 'BRAND LOGOS', blurb: 'Stored brand marks — audit, refetch and replace.', href: '/admin/brand-logos' },
  { title: 'PRIVATE STYLIST', blurb: 'One house, three rooms — the soft-weighted pilot.', href: '/admin/private-stylist' },
  { title: 'BRAND WATCH', blurb: 'Watched brands scanned weekly for on-taste new pieces.', href: '/admin/brand-watch' },
  { title: 'MERCHANTS', blurb: 'Commercial partners, link modes and connection state.', href: '/admin/merchants' },
  { title: 'APPLICATIONS', blurb: 'Brands applying to join MYRA.', href: '/admin/applications' },
  { title: 'LEDGER', blurb: 'The money ledger behind merchant billing.', href: '/admin/ledger' },
  { title: 'RECONCILIATION', blurb: 'Match network-reported sales against our own click log.', href: '/admin/reconciliation' },
  { title: 'WEBHOOK LOG', blurb: 'Inbound webhook deliveries and their outcomes.', href: '/admin/webhook-log' },
  { title: 'ANALYTICS', blurb: 'Traffic, sign-ups, retention, location, repeat use.', href: '/admin/analytics' },
  { title: 'PREFERENCES', blurb: 'What sign-ups are into — picks, clicks, searches, feedback.', href: '/admin/signup-preferences' },
  { title: 'SOCIAL', blurb: 'Turn live outfits into social posts.', href: '/admin/social' },
  { title: 'RUNWAY SEARCH', blurb: 'Search runway looks to source inspiration.', href: '/admin/runway-search' },
  { title: 'WAITLIST SIGNUPS', blurb: 'Everyone who joined from the public site.', href: '/admin/signups' },
  { title: 'PRODUCT VIEW', blurb: 'Live previews of MYRA’s key flows, for a product reel.', href: '/admin/product-view' },
  { title: 'ARCHIVE', blurb: 'Retired projects and outfits.', href: '/admin/projects?filter=archived' },
]

function NotMigrated() {
  return (
    <div className="border border-[#E2D6B8] bg-[#FBF6E9] rounded-[10px] p-4">
      <p className="text-[10px] tracking-[0.09em] text-[#8A6D3B] mb-1">MEASUREMENT TABLES NOT CREATED YET</p>
      <p className="text-[9px] tracking-[0.054em] text-[#8A6D3B]/80 leading-relaxed">
        RUN MIGRATION 0024_performance_dashboard.sql IN SUPABASE TO START RECORDING COMMISSION AND AD SPEND.
      </p>
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
      <p className="text-[#4A4E57] mb-1 tracking-[0.036em]" style={{ fontSize: '28px', lineHeight: 1 }}>
        {value}
      </p>
      <p className="text-[10px] tracking-[0.09em] text-[#4A4E57] mb-3">{label}</p>
      <p className="text-[9px] tracking-[0.054em] text-[#A8A8A4]">{breakdown}</p>
    </>
  )

  if (href) {
    return (
      <a href={href} className="block bg-white border border-[#E2E0DB] p-5 rounded-[12px] hover:border-[#0A0A0A] transition-colors duration-300">
        {inner}
      </a>
    )
  }
  return <div className="bg-white border border-[#E2E0DB] p-5 rounded-[12px]">{inner}</div>
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
        group block border border-[#E2E0DB] bg-white p-7 rounded-[12px]
        transition-all duration-400
        hover:border-[#0A0A0A] hover:shadow-[0_2px_16px_rgba(0,0,0,0.06)]
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
