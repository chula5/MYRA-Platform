import { createAdminClient } from '@/lib/supabase-server'
import MerchantsClient, { type MerchantRow } from './MerchantsClient'

export const dynamic = 'force-dynamic'

// Merchants console (Part 7): connection state, catalogue + click volume, and
// what each merchant owes — read straight from the commission ledger.
export default async function MerchantsPage() {
  const admin = createAdminClient()

  const [{ data: merchants }, { data: items }, { data: commissions }, { data: terms }] = await Promise.all([
    admin.from('merchant' as any).select('*').order('name'),
    admin.from('item' as any).select('merchant_id, status').not('merchant_id', 'is', null),
    admin.from('commission' as any).select('merchant_id, status, commission_gbp'),
    admin.from('commission_terms' as any).select('*').order('version', { ascending: false }),
  ])

  const since = new Date(Date.now() - 30 * 864e5).toISOString()
  const { data: clicks } = await admin
    .from('click' as any)
    .select('merchant_id')
    .not('merchant_id', 'is', null)
    .eq('is_bot', false)
    .gte('created_at', since)
    .limit(20000)

  const itemsBy = new Map<string, { total: number; live: number }>()
  for (const it of (items as any[]) ?? []) {
    const e = itemsBy.get(it.merchant_id) ?? { total: 0, live: 0 }
    e.total++
    if (it.status === 'live') e.live++
    itemsBy.set(it.merchant_id, e)
  }
  const clicksBy = new Map<string, number>()
  for (const c of (clicks as any[]) ?? []) clicksBy.set(c.merchant_id, (clicksBy.get(c.merchant_id) ?? 0) + 1)

  const commBy = new Map<string, { pendingGbp: number; approvedGbp: number; paidGbp: number }>()
  for (const c of (commissions as any[]) ?? []) {
    const e = commBy.get(c.merchant_id) ?? { pendingGbp: 0, approvedGbp: 0, paidGbp: 0 }
    const v = Number(c.commission_gbp) || 0
    if (c.status === 'pending') e.pendingGbp += v
    else if (c.status === 'approved' || c.status === 'payable') e.approvedGbp += v
    else if (c.status === 'paid') e.paidGbp += v
    commBy.set(c.merchant_id, e)
  }
  const termsBy = new Map<string, any>()
  for (const t of (terms as any[]) ?? []) if (!termsBy.has(t.merchant_id)) termsBy.set(t.merchant_id, t)

  const rows: MerchantRow[] = ((merchants as any[]) ?? []).map((m) => ({
    merchant_id: m.merchant_id,
    name: m.name,
    type: m.type,
    status: m.status,
    shop_domain: m.shop_domain,
    installed_at: m.installed_at,
    webhooks_registered_at: m.webhooks_registered_at,
    catalogue_synced_at: m.catalogue_synced_at,
    default_commission_rate: Number(m.default_commission_rate ?? 0.15),
    return_window_days: m.return_window_days ?? 30,
    billing_model: m.billing_model ?? 'prefunded',
    itemCount: itemsBy.get(m.merchant_id)?.total ?? 0,
    liveItemCount: itemsBy.get(m.merchant_id)?.live ?? 0,
    clicks30: clicksBy.get(m.merchant_id) ?? 0,
    commission: commBy.get(m.merchant_id) ?? { pendingGbp: 0, approvedGbp: 0, paidGbp: 0 },
    terms: termsBy.get(m.merchant_id)
      ? {
          version: termsBy.get(m.merchant_id).version,
          base_rate: Number(termsBy.get(m.merchant_id).base_rate),
          intro_rate: termsBy.get(m.merchant_id).intro_rate != null ? Number(termsBy.get(m.merchant_id).intro_rate) : null,
          intro_expires_at: termsBy.get(m.merchant_id).intro_expires_at,
          accepted_at: termsBy.get(m.merchant_id).accepted_at,
        }
      : null,
  }))

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">MERCHANTS</h1>
        <p className="text-[11px] tracking-[0.068em] text-[#A8A8A4] mt-1">Connections, commercials and what each brand owes — from the ledger.</p>
      </div>
      <MerchantsClient merchants={rows} />
    </div>
  )
}
