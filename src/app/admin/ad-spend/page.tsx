import { getDashboardMetrics } from '@/lib/dashboard-metrics'
import { getAdSpend, metaMissingEnv, metaAdAccountId } from '@/lib/networks/meta-ads'
import { getNetworkStatuses } from '@/lib/networks/sync'
import TrendChart from '@/components/admin/charts/TrendChart'
import RankBars from '@/components/admin/charts/RankBars'
import SyncButton from '@/components/admin/SyncButton'
import { SERIES, STATUS, INK } from '@/components/admin/charts/palette'

export const dynamic = 'force-dynamic'

function gbp0(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function gbp2(n: number): string {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default async function AdSpendPage() {
  const [perf, spend, statuses] = await Promise.all([getDashboardMetrics(), getAdSpend(120), getNetworkStatuses()])

  const meta = statuses.find((s) => s.network === 'meta')!
  const missing = metaMissingEnv()
  const labels = perf.buckets.map((b) => b.label)

  const spendSeries = perf.money.spendSeries
  const commissionSeries = perf.money.commissionSeries
  const signupSeries = perf.metrics.signups.series
  const clickSeries = perf.metrics['retailer-clicks'].series

  const totalSpend = spendSeries.reduce((a, b) => a + b, 0)
  const totalCommission = commissionSeries.reduce((a, b) => a + b, 0)
  const totalSignups = signupSeries.reduce((a, b) => a + b, 0)

  const costPerSignup = totalSignups > 0 ? totalSpend / totalSignups : 0
  // Return on ad spend against AFFILIATE COMMISSION, not basket value — MYRA's
  // revenue is the commission, not the customer's spend at the retailer.
  const roas = totalSpend > 0 ? totalCommission / totalSpend : 0

  const platformConversions = spend.rows.reduce((s, r) => s + Number(r.conversions ?? 0), 0)
  const totalClicks = spend.rows.reduce((s, r) => s + Number(r.clicks ?? 0), 0)
  const totalImpressions = spend.rows.reduce((s, r) => s + Number(r.impressions ?? 0), 0)

  const byCampaign = new Map<string, { spend: number; clicks: number }>()
  for (const r of spend.rows) {
    const key = (r.campaign_name ?? r.campaign_id ?? '(ACCOUNT)').toUpperCase()
    const prev = byCampaign.get(key) ?? { spend: 0, clicks: 0 }
    byCampaign.set(key, { spend: prev.spend + Number(r.spend_gbp ?? 0), clicks: prev.clicks + Number(r.clicks ?? 0) })
  }
  const campaignRows = Array.from(byCampaign.entries())
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, 12)
    .map(([label, v]) => ({ label, value: v.spend, note: `${v.clicks.toLocaleString('en-GB')} CLICKS` }))

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <a href="/admin" className="text-[10px] tracking-[0.14em] text-[#A8A8A4] hover:text-[#0A0A0A] transition-colors duration-300">
            ← DASHBOARD
          </a>
          <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57] mt-4">AD SPEND → CONVERSION</h1>
          <p className="text-[10px] tracking-[0.09em] text-[#6B6B6B] mt-2 max-w-2xl leading-relaxed">
            META SPEND AGAINST WHAT IT PRODUCED. CONVERSIONS ARE COUNTED FIRST-PARTY — ACCOUNTS ACTUALLY CREATED
            IN MYRA — WITH META&apos;S OWN ATTRIBUTED FIGURE SHOWN ALONGSIDE FOR COMPARISON, NEVER MIXED INTO IT.
          </p>
        </div>
        <SyncButton target="meta" label="SYNC META SPEND" />
      </div>

      {/* Connection */}
      <div className="mb-8 bg-white border border-[#E2E0DB] rounded-[14px] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-2">META ADS CONNECTION</p>
            <p className="text-[9px] tracking-[0.09em]" style={{ color: missing.length ? STATUS.warning : STATUS.good }}>
              {missing.length ? 'NOT CONNECTED' : 'CONNECTED'} · AD ACCOUNT act_{metaAdAccountId()} · GBP
            </p>
            {meta.lastError && (
              <p className="text-[9px] tracking-[0.045em] mt-2 leading-relaxed break-words" style={{ color: STATUS.critical }}>
                {meta.lastError.slice(0, 240)}
              </p>
            )}
          </div>
          {missing.length > 0 && (
            <div className="max-w-md">
              <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-1.5">ADD TO .env.local:</p>
              <p className="font-mono text-[9px] text-[#6B6B6B] leading-relaxed">
                META_ACCESS_TOKEN=…
                <br />
                <span className="text-[#C9C7C2]">
                  META_AD_ACCOUNT_ID={metaAdAccountId()} (OPTIONAL — THIS IS THE DEFAULT)
                </span>
              </p>
              <p className="text-[9px] tracking-[0.054em] text-[#C9C7C2] mt-2 leading-relaxed">
                A SYSTEM-USER TOKEN WITH ads_read ON THE MYRA AD ACCOUNT. THE SERVER NEEDS ITS OWN CREDENTIAL —
                THE META MCP RUNS ON THE CLAUDE SIDE AND CANNOT BE CALLED FROM THE APP.
              </p>
            </div>
          )}
        </div>
      </div>

      {!spend.available && (
        <div className="mb-6 border border-[#E2D6B8] bg-[#FBF6E9] rounded-[12px] p-5">
          <p className="text-[10px] tracking-[0.09em] text-[#8A6D3B]">
            AD SPEND TABLE NOT CREATED YET · RUN <span className="font-mono">0024_performance_dashboard.sql</span> IN SUPABASE
          </p>
        </div>
      )}

      {/* Headline economics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Figure label="SPEND" value={gbp0(totalSpend)} note={`LAST ${labels.length} WEEKS`} big />
        <Figure label="COMMISSION" value={gbp0(totalCommission)} note="SAME WINDOW" big />
        <Figure
          label="RETURN ON AD SPEND"
          value={totalSpend > 0 ? `${roas.toFixed(2)}×` : '—'}
          note="COMMISSION ÷ SPEND"
          tone={totalSpend > 0 ? (roas >= 1 ? STATUS.good : STATUS.critical) : undefined}
        />
        <Figure label="COST PER SIGN-UP" value={totalSignups > 0 ? gbp2(costPerSignup) : '—'} note={`${totalSignups} SIGN-UPS`} />
        <Figure
          label="NET"
          value={`${totalCommission - totalSpend >= 0 ? '' : '−'}${gbp0(Math.abs(totalCommission - totalSpend))}`}
          note="COMMISSION − SPEND"
          tone={totalCommission - totalSpend >= 0 ? STATUS.good : STATUS.critical}
        />
      </div>

      {/* Money in vs money out — same unit, so one chart, one axis. */}
      <div className="bg-white border border-[#E2E0DB] rounded-[14px] p-6 mb-5">
        <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-4">SPEND vs COMMISSION · GBP PER WEEK</p>
        <TrendChart
          labels={labels}
          series={[
            { name: 'AD SPEND', values: spendSeries, colour: SERIES[2] },
            { name: 'COMMISSION', values: commissionSeries, colour: SERIES[0] },
          ]}
          height={230}
          format="gbp0"
        />
      </div>

      {/* Different units get different charts — never a second y-axis. */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-8">
        <div className="bg-white border border-[#E2E0DB] rounded-[14px] p-6">
          <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-4">SIGN-UPS PER WEEK</p>
          <TrendChart
            labels={labels}
            series={[{ name: 'SIGN-UPS', values: signupSeries, colour: SERIES[1] }]}
            height={170}
            format="count"
            showTable={false}
          />
        </div>
        <div className="bg-white border border-[#E2E0DB] rounded-[14px] p-6">
          <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-4">COST PER SIGN-UP · GBP</p>
          <TrendChart
            labels={labels}
            series={[{ name: 'COST PER SIGN-UP', values: perf.metrics['cost-per-signup'].series, colour: SERIES[2] }]}
            height={170}
            format="gbp"
            showTable={false}
          />
          <p className="text-[9px] tracking-[0.054em] text-[#C9C7C2] mt-3">A WEEK WITH SPEND AND NO SIGN-UPS READS AS ZERO, NOT INFINITY.</p>
        </div>
        <div className="bg-white border border-[#E2E0DB] rounded-[14px] p-6">
          <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-4">RETAILER CLICKS PER WEEK</p>
          <TrendChart
            labels={labels}
            series={[{ name: 'RETAILER CLICKS', values: clickSeries, colour: SERIES[3] }]}
            height={170}
            format="count"
            showTable={false}
          />
        </div>
      </div>

      {/* Delivery + campaigns */}
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 xl:col-span-7 bg-white border border-[#E2E0DB] rounded-[14px] p-6">
          <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-4">SPEND BY CAMPAIGN</p>
          <RankBars rows={campaignRows} colour={SERIES[2]} format={gbp0} empty="NO SPEND SYNCED YET" />
        </div>

        <div className="col-span-12 xl:col-span-5 bg-white border border-[#E2E0DB] rounded-[14px] p-6">
          <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-4">DELIVERY</p>
          <div className="grid grid-cols-2 gap-5">
            <Small label="IMPRESSIONS" value={totalImpressions.toLocaleString('en-GB')} />
            <Small label="LINK CLICKS" value={totalClicks.toLocaleString('en-GB')} />
            <Small
              label="CPM"
              value={totalImpressions > 0 ? gbp2((totalSpend / totalImpressions) * 1000) : '—'}
            />
            <Small label="CPC" value={totalClicks > 0 ? gbp2(totalSpend / totalClicks) : '—'} />
          </div>

          <div className="mt-6 pt-5 border-t border-[#F2F2F0]">
            <p className="text-[9px] tracking-[0.14em] text-[#A8A8A4] mb-3">CONVERSIONS · TWO COUNTS, NOT ONE</p>
            <div className="grid grid-cols-2 gap-5">
              <Small label="MYRA SIGN-UPS" value={totalSignups.toLocaleString('en-GB')} />
              <Small label="META ATTRIBUTED" value={platformConversions.toLocaleString('en-GB')} muted />
            </div>
            <p className="text-[9px] tracking-[0.054em] text-[#C9C7C2] mt-3 leading-relaxed">
              META COUNTS A CONVERSION WHEN ITS OWN ATTRIBUTION WINDOW CLAIMS IT. MYRA COUNTS AN ACCOUNT THAT EXISTS.
              THE TWO WILL NOT MATCH, AND THE SECOND IS THE ONE TO TRUST.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Figure({
  label,
  value,
  note,
  big = false,
  tone,
}: {
  label: string
  value: string
  note?: string
  big?: boolean
  tone?: string
}) {
  return (
    <div className="bg-white border border-[#E2E0DB] rounded-[12px] p-5">
      <p className="text-[9px] tracking-[0.14em] text-[#A8A8A4] mb-2">{label}</p>
      <p className="tracking-[0.02em] leading-none" style={{ fontSize: big ? 30 : 24, color: tone ?? INK.body }}>
        {value}
      </p>
      {note && <p className="text-[9px] tracking-[0.054em] text-[#C9C7C2] mt-2">{note}</p>}
    </div>
  )
}

function Small({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <p className="text-[8px] tracking-[0.14em] text-[#A8A8A4] mb-1.5">{label}</p>
      <p className="text-[18px] tracking-[0.02em]" style={{ color: muted ? INK.faint : INK.body }}>
        {value}
      </p>
    </div>
  )
}
