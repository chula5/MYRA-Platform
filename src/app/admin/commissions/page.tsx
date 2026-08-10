import { getCommissions, getNetworkStatuses, NETWORKS } from '@/lib/networks/sync'
import { REQUIRED_ENV, type NetworkId } from '@/lib/networks/types'
import { weekBuckets, bucketSum } from '@/lib/metrics-core'
import TrendChart from '@/components/admin/charts/TrendChart'
import RankBars, { ShareBar } from '@/components/admin/charts/RankBars'
import SyncButton from '@/components/admin/SyncButton'
import { NETWORK_COLOR, NETWORK_LABEL, STATUS, INK } from '@/components/admin/charts/palette'

export const dynamic = 'force-dynamic'

const WEEKS = 12

function gbp(n: number): string {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function gbp0(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function ago(iso: string | null): string {
  if (!iso) return 'NEVER'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'JUST NOW'
  if (mins < 60) return `${mins} MIN AGO`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} HR AGO`
  return `${Math.floor(hours / 24)} DAYS AGO`
}

export default async function CommissionsPage() {
  const [{ rows, available }, statuses] = await Promise.all([getCommissions(WEEKS * 7), getNetworkStatuses()])

  const buckets = weekBuckets(WEEKS)
  const labels = buckets.map((b) => b.label)

  // Declined transactions are excluded from every earnings figure — a returned
  // order was never revenue — but they are still counted and shown, because a
  // rising decline rate is itself a signal.
  const earning = rows.filter((r) => r.status !== 'declined')

  const perNetworkSeries = NETWORKS.map((n) => ({
    name: NETWORK_LABEL[n],
    values: bucketSum(earning, 'occurred_at', 'commission_gbp', buckets, (r) => r.network === n),
    colour: NETWORK_COLOR[n],
  }))

  const totals = {
    all: earning.reduce((s, r) => s + Number(r.commission_gbp ?? 0), 0),
    pending: earning.filter((r) => r.status === 'pending').reduce((s, r) => s + Number(r.commission_gbp ?? 0), 0),
    approved: earning.filter((r) => r.status === 'approved').reduce((s, r) => s + Number(r.commission_gbp ?? 0), 0),
    paid: earning.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.commission_gbp ?? 0), 0),
    declined: rows.filter((r) => r.status === 'declined').reduce((s, r) => s + Number(r.commission_gbp ?? 0), 0),
    sales: earning.reduce((s, r) => s + Number(r.sale_amount_gbp ?? 0), 0),
  }

  const byNetwork = NETWORKS.map((n) => ({
    label: NETWORK_LABEL[n],
    value: earning.filter((r) => r.network === n).reduce((s, r) => s + Number(r.commission_gbp ?? 0), 0),
    colour: NETWORK_COLOR[n],
  }))

  const advertisers = new Map<string, number>()
  for (const r of earning) {
    const k = (r.advertiser_name ?? 'UNATTRIBUTED').toUpperCase()
    advertisers.set(k, (advertisers.get(k) ?? 0) + Number(r.commission_gbp ?? 0))
  }
  const topAdvertisers = Array.from(advertisers.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, value]) => ({ label, value }))

  const attributed = earning.filter((r) => r.outfit_id || r.item_id).length
  const attributionRate = earning.length > 0 ? attributed / earning.length : 0

  const affiliateStatuses = statuses.filter((s) => s.network !== 'meta')

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <a href="/admin" className="text-[10px] tracking-[0.14em] text-[#A8A8A4] hover:text-[#0A0A0A] transition-colors duration-300">
            ← DASHBOARD
          </a>
          <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57] mt-4">COMMISSIONS</h1>
          <p className="text-[10px] tracking-[0.09em] text-[#6B6B6B] mt-2 max-w-2xl leading-relaxed">
            AWIN, RAKUTEN AND CJ IN ONE LEDGER. SYNCING RE-READS THE LAST 60 DAYS — NETWORKS REVISE A
            TRANSACTION&apos;S STATUS FOR WEEKS AFTER THE SALE, SO OVERLAP IS DELIBERATE.
          </p>
        </div>
        <SyncButton target="commissions" label="SYNC ALL NETWORKS" />
      </div>

      {!available && (
        <div className="mb-6 border border-[#E2D6B8] bg-[#FBF6E9] rounded-[12px] p-5">
          <p className="text-[10px] tracking-[0.09em] text-[#8A6D3B] mb-1">COMMISSION LEDGER NOT CREATED YET</p>
          <p className="text-[9px] tracking-[0.054em] text-[#8A6D3B]/80 leading-relaxed">
            RUN <span className="font-mono">0024_performance_dashboard.sql</span> IN SUPABASE, THEN SYNC.
          </p>
        </div>
      )}

      {/* Connection status — a zero means nothing until you know whether the
          network is even connected. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {affiliateStatuses.map((s) => {
          const tone = !s.configured ? STATUS.neutral : s.lastStatus === 'error' ? STATUS.critical : s.lastStatus === 'ok' ? STATUS.good : STATUS.warning
          const word = !s.configured ? 'NOT CONNECTED' : s.lastStatus === 'error' ? 'ERROR' : s.lastStatus === 'ok' ? 'CONNECTED' : 'NEVER SYNCED'
          return (
            <div key={s.network} className="bg-white border border-[#E2E0DB] rounded-[12px] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: NETWORK_COLOR[s.network] }} aria-hidden />
                  <span className="text-[11px] tracking-[0.113em] text-[#4A4E57]">{NETWORK_LABEL[s.network]}</span>
                </span>
                <span className="text-[8px] tracking-[0.14em]" style={{ color: tone }}>
                  {word}
                </span>
              </div>

              {s.configured ? (
                <>
                  <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4]">
                    LAST SYNC {ago(s.lastSyncedAt)} · {s.rowsSynced} ROWS
                  </p>
                  {s.lastError && (
                    <p className="text-[9px] tracking-[0.045em] mt-2 leading-relaxed break-words" style={{ color: STATUS.critical }}>
                      {s.lastError.slice(0, 200)}
                    </p>
                  )}
                </>
              ) : (
                <div>
                  <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-2">ADD THESE TO .env.local:</p>
                  <ul className="space-y-0.5">
                    {REQUIRED_ENV[s.network as NetworkId].map((k) => (
                      <li key={k} className="font-mono text-[9px] text-[#6B6B6B]">
                        {k}
                        {s.missing.includes(k) ? '' : ' ✓'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Figure label="TOTAL EARNED" value={gbp0(totals.all)} note={`OVER ${WEEKS} WEEKS`} big />
        <Figure label="PAID" value={gbp0(totals.paid)} note="MONEY RECEIVED" />
        <Figure label="APPROVED" value={gbp0(totals.approved)} note="PAYABLE" />
        <Figure label="PENDING" value={gbp0(totals.pending)} note="IN RETURN WINDOW" />
        <Figure label="DECLINED" value={gbp0(Math.abs(totals.declined))} note="RETURNED / REJECTED" tone={STATUS.critical} />
      </div>

      <div className="grid grid-cols-12 gap-5 mb-8">
        <div className="col-span-12 xl:col-span-8 bg-white border border-[#E2E0DB] rounded-[14px] p-6">
          <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-4">COMMISSION BY NETWORK · GBP PER WEEK</p>
          <TrendChart labels={labels} series={perNetworkSeries} height={230} format="gbp0" />
        </div>

        <div className="col-span-12 xl:col-span-4 space-y-5">
          <div className="bg-white border border-[#E2E0DB] rounded-[14px] p-6">
            <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-4">SHARE OF EARNINGS</p>
            <ShareBar parts={byNetwork} format={gbp0} />
          </div>

          <div className="bg-white border border-[#E2E0DB] rounded-[14px] p-6">
            <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-4">ATTRIBUTION</p>
            <p className="text-[30px] leading-none tracking-[0.02em] text-[#4A4E57]">
              {(attributionRate * 100).toFixed(0)}%
            </p>
            <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mt-2">
              OF SALES TRACED BACK TO AN OUTFIT OR ITEM
            </p>
            <p className="text-[9px] tracking-[0.054em] text-[#C9C7C2] mt-3 leading-relaxed">
              A SALE IS ATTRIBUTED WHEN THE NETWORK ECHOES BACK THE CLICK ID MYRA PUT ON THE OUTBOUND LINK.
              UNATTRIBUTED SALES ARE STILL COUNTED IN EVERY TOTAL.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5 mb-8">
        <div className="col-span-12 xl:col-span-4 bg-white border border-[#E2E0DB] rounded-[14px] p-6">
          <p className="text-[10px] tracking-[0.14em] text-[#4A4E57] mb-4">TOP ADVERTISERS</p>
          <RankBars rows={topAdvertisers} format={gbp0} empty="NO COMMISSION SYNCED YET" />
        </div>

        <div className="col-span-12 xl:col-span-8 bg-white border border-[#E2E0DB] rounded-[14px] p-6">
          <div className="flex items-baseline justify-between mb-4">
            <p className="text-[10px] tracking-[0.14em] text-[#4A4E57]">TRANSACTIONS</p>
            <p className="text-[9px] tracking-[0.09em] text-[#C9C7C2]">
              {rows.length} ROWS · SALES {gbp0(totals.sales)}
            </p>
          </div>

          {rows.length === 0 ? (
            <p className="text-[10px] tracking-[0.09em] text-[#C9C7C2]">
              NOTHING SYNCED YET. CONNECT A NETWORK ABOVE, THEN SYNC.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    {['DATE', 'NETWORK', 'ADVERTISER', 'STATUS', 'SALE', 'COMMISSION', 'ATTRIBUTED'].map((h) => (
                      <th key={h} className="text-[9px] tracking-[0.14em] text-[#A8A8A4] font-normal py-2 pr-4 border-b border-[#E2E0DB] whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 60).map((r) => (
                    <tr key={r.id}>
                      <td className="text-[10px] text-[#6B6B6B] py-2 pr-4 border-b border-[#F2F2F0] whitespace-nowrap">
                        {new Date(r.occurred_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()}
                      </td>
                      <td className="py-2 pr-4 border-b border-[#F2F2F0] whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: NETWORK_COLOR[r.network] }} aria-hidden />
                          <span className="text-[10px] tracking-[0.045em] text-[#4A4E57]">{NETWORK_LABEL[r.network]}</span>
                        </span>
                      </td>
                      <td className="text-[10px] text-[#4A4E57] py-2 pr-4 border-b border-[#F2F2F0] max-w-[220px] truncate">
                        {(r.advertiser_name ?? '—').toUpperCase()}
                      </td>
                      <td className="text-[9px] tracking-[0.09em] py-2 pr-4 border-b border-[#F2F2F0]" style={{ color: statusColour(r.status) }}>
                        {r.status.toUpperCase()}
                      </td>
                      <td className="text-[10px] text-[#6B6B6B] py-2 pr-4 border-b border-[#F2F2F0] whitespace-nowrap">
                        {gbp(Number(r.sale_amount_gbp ?? 0))}
                      </td>
                      <td className="text-[10px] text-[#0A0A0A] py-2 pr-4 border-b border-[#F2F2F0] whitespace-nowrap">
                        {gbp(Number(r.commission_gbp ?? 0))}
                      </td>
                      <td className="text-[9px] tracking-[0.09em] py-2 pr-4 border-b border-[#F2F2F0] whitespace-nowrap"
                          style={{ color: r.outfit_id || r.item_id ? INK.body : INK.faint }}>
                        {r.outfit_id ? 'OUTFIT' : r.item_id ? 'ITEM' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 60 && (
                <p className="text-[9px] tracking-[0.09em] text-[#C9C7C2] mt-3">
                  SHOWING THE 60 MOST RECENT OF {rows.length}.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function statusColour(status: string): string {
  if (status === 'declined') return STATUS.critical
  if (status === 'paid') return STATUS.good
  if (status === 'approved') return INK.body
  return INK.muted
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
      <p className="tracking-[0.02em] leading-none" style={{ fontSize: big ? 32 : 24, color: tone ?? INK.body }}>
        {value}
      </p>
      {note && <p className="text-[9px] tracking-[0.054em] text-[#C9C7C2] mt-2">{note}</p>}
    </div>
  )
}
