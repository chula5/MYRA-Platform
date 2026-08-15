// Commission ledger persistence. Every state change goes through transition()
// so the append-only commission_event log is complete and transitions are
// validated against the state machine — there is no other write path.

import { createAdminClient } from '@/lib/supabase-server'
import { toGbp } from '@/lib/currency'
import { getShopifyMerchant } from '@/lib/shopify/merchant'
import { fetchOrderJourney } from './journey'
import {
  canTransition,
  commissionBase,
  computeCommissionGbp,
  extractMyraClick,
  attributeFromJourney,
  orderOutcome,
  resolveRate,
  returnWindowEnd,
  type CommissionStatus,
} from './logic'

export interface AccrueInput {
  merchantId: string
  order: any            // raw orders/create payload
}

async function activeTerms(merchantId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('commission_terms' as any)
    .select('*')
    .eq('merchant_id', merchantId)
    .order('version', { ascending: false })
    .limit(1)
  return ((data as any[]) ?? [])[0] ?? null
}

// Record a state change + its event atomically enough for our purposes.
// Never throws on the event write — losing an event is bad, blocking money
// movement on it is worse; failures land in the error log.
export async function transition(
  commissionId: string,
  from: CommissionStatus,
  to: CommissionStatus,
  actor: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!canTransition(from, to)) {
    return { ok: false, error: `Illegal transition ${from} → ${to}` }
  }
  const admin = createAdminClient()
  const patch: Record<string, unknown> = { status: to, updated_at: new Date().toISOString() }
  if (to === 'approved') patch.approved_at = new Date().toISOString()
  if (to === 'paid') patch.settled_at = new Date().toISOString()

  // Guard with .eq('status', from): if another process already moved the row,
  // no rows match and we refuse — optimistic concurrency, no double-approve.
  const { data, error } = await admin
    .from('commission' as any)
    .update(patch as any)
    .eq('commission_id', commissionId)
    .eq('status', from)
    .select('commission_id')
  if (error) return { ok: false, error: error.message }
  if (!data?.length) return { ok: false, error: `Row not in ${from} (already transitioned?)` }

  try {
    await admin.from('commission_event' as any).insert({
      commission_id: commissionId, from_status: from, to_status: to, actor, reason: reason ?? null,
    } as any)
  } catch (err) {
    console.error('[ledger] event write failed', err instanceof Error ? err.message : err)
  }
  return { ok: true }
}

// ── Accrual (orders/create) ─────────────────────────────────────────────────
// Creates the pending commission row. Attribution starts from landing_site;
// if that misses, the journey pass (cron) retries within the 30-day window.
export async function accrueCommission({ merchantId, order }: AccrueInput): Promise<void> {
  const admin = createAdminClient()
  const orderId = String(order?.admin_graphql_api_id ?? order?.id ?? '')
  if (!orderId || !merchantId) return
  if (orderOutcome(order) === 'cancelled') return // born dead — nothing owed

  // Same-session attribution, verified against our own click log.
  let clickId = extractMyraClick(order?.landing_site ?? order?.referring_site)
  let attribution: 'landing_site' | 'none' = 'none'
  if (clickId) {
    const { data: click } = await admin
      .from('click' as any).select('click_id, merchant_id').eq('click_id', clickId).maybeSingle()
    if (click) attribution = 'landing_site'
    else clickId = null // spoofed / unknown — never claim it
  }

  const { data: merchant } = await admin
    .from('merchant' as any)
    .select('return_window_days, default_commission_rate')
    .eq('merchant_id', merchantId)
    .single()
  const windowDays = (merchant as any)?.return_window_days ?? 30
  const fallbackRate = Number((merchant as any)?.default_commission_rate ?? 0.15)

  const createdAt = order?.created_at ? new Date(order.created_at) : new Date()
  const terms = await activeTerms(merchantId)
  const rate = resolveRate(terms, createdAt, 0, fallbackRate)

  const { amount, currency } = commissionBase(order)
  const valueGbp = Math.round(toGbp(amount, currency) * 100) / 100
  const fx = amount > 0 ? valueGbp / amount : 1

  const { error } = await admin.from('commission' as any).insert({
    merchant_id: merchantId,
    shopify_order_id: orderId,
    order_number: order?.name ?? (order?.order_number != null ? String(order.order_number) : null),
    order_created_at: createdAt.toISOString(),
    click_id: clickId,
    attribution,
    order_value: amount,
    currency,
    fx_rate_to_gbp: Number(fx.toFixed(6)),
    order_value_gbp: valueGbp,
    rate_applied: rate,
    commission_gbp: attribution === 'none' ? 0 : computeCommissionGbp(valueGbp, rate),
    terms_version: terms?.version ?? null,
    status: 'pending',
    return_window_ends_at: returnWindowEnd(createdAt, windowDays).toISOString(),
  } as any)
  // 23505 = duplicate (merchant_id, shopify_order_id) — webhook retry, fine.
  if (error && (error as any).code !== '23505') {
    console.error('[ledger] accrue failed', error.message)
  }
}

// ── Reconcile (orders/updated: cancellations + refunds) ─────────────────────
export async function reconcileOrderUpdate(merchantId: string, order: any): Promise<void> {
  const admin = createAdminClient()
  const orderId = String(order?.admin_graphql_api_id ?? order?.id ?? '')
  if (!orderId) return
  const { data: row } = await admin
    .from('commission' as any)
    .select('commission_id, status, order_value, currency, order_value_gbp, rate_applied, attribution')
    .eq('merchant_id', merchantId)
    .eq('shopify_order_id', orderId)
    .maybeSingle()
  const c = row as any
  if (!c) return

  const outcome = orderOutcome(order)
  if (outcome === 'cancelled' && c.status === 'pending') {
    await transition(c.commission_id, 'pending', 'void', 'system', 'Order cancelled')
    return
  }
  if (outcome === 'refunded') {
    if (c.status === 'pending') await transition(c.commission_id, 'pending', 'void', 'system', 'Order fully refunded in window')
    else if (['approved', 'payable', 'paid'].includes(c.status)) {
      await transition(c.commission_id, c.status, 'returned', 'system', 'Order fully refunded')
    }
    return
  }
  if (outcome === 'partially_refunded' && c.status === 'pending') {
    // Still inside the window → recompute against the surviving subtotal.
    const { amount, currency } = commissionBase(order)
    const valueGbp = Math.round(toGbp(amount, currency) * 100) / 100
    await admin.from('commission' as any).update({
      order_value: amount,
      currency,
      order_value_gbp: valueGbp,
      commission_gbp: c.attribution === 'none' ? 0 : computeCommissionGbp(valueGbp, Number(c.rate_applied)),
      updated_at: new Date().toISOString(),
    } as any).eq('commission_id', c.commission_id)
    try {
      await admin.from('commission_event' as any).insert({
        commission_id: c.commission_id, from_status: c.status, to_status: c.status,
        actor: 'system', reason: `Partial refund — base recomputed to ${currency} ${amount}`,
      } as any)
    } catch { /* logged path only */ }
  }
}

// ── Journey pass ────────────────────────────────────────────────────────────
// For unattributed pending commissions, ask Shopify's 30-day customer journey
// whether MYRA touched the path. Runs from the daily cron until the window
// closes; upgrades attribution + computes the commission when it matches.
export async function resolveJourneyAttribution(limit = 25): Promise<{ checked: number; matched: number }> {
  const admin = createAdminClient()
  let checked = 0, matched = 0
  const { data: rows } = await admin
    .from('commission' as any)
    .select('commission_id, merchant_id, shopify_order_id, order_value_gbp, rate_applied, merchant:merchant_id(shop_domain)')
    .eq('status', 'pending')
    .eq('attribution', 'none')
    .order('created_at', { ascending: true })
    .limit(limit)

  const byShop = new Map<string, any>()
  for (const r of (rows as any[]) ?? []) {
    checked++
    const shop = r.merchant?.shop_domain
    if (!shop) continue
    let merchant = byShop.get(shop)
    if (merchant === undefined) { merchant = await getShopifyMerchant(shop); byShop.set(shop, merchant) }
    if (!merchant) continue

    const numericId = String(r.shopify_order_id).split('/').pop() ?? r.shopify_order_id
    const journey = await fetchOrderJourney(merchant, numericId)
    if (!journey || !journey.ready) continue // not computed yet — retry next run

    const attr = attributeFromJourney(journey.moments)
    if (!attr.myraTouched) continue

    // Verify a recovered click id against our log; a MYRA utm with no
    // recoverable id still counts, recorded as journey-attributed without link.
    let clickId: string | null = null
    if (attr.clickId) {
      const { data: click } = await admin
        .from('click' as any).select('click_id').eq('click_id', attr.clickId).maybeSingle()
      if (click) clickId = attr.clickId
    }

    await admin.from('commission' as any).update({
      click_id: clickId,
      attribution: 'journey',
      attribution_note: attr.momentAt ? `MYRA touch at ${attr.momentAt}` : 'MYRA utm in 30-day journey',
      commission_gbp: computeCommissionGbp(Number(r.order_value_gbp), Number(r.rate_applied)),
      updated_at: new Date().toISOString(),
    } as any).eq('commission_id', r.commission_id)
    matched++
  }
  return { checked, matched }
}

// ── Approval pass ───────────────────────────────────────────────────────────
// pending + window closed + MYRA-attributed → approved. Unattributed rows past
// the window are voided (order existed; it just wasn't ours).
export async function approveMaturedCommissions(): Promise<{ approved: number; voided: number }> {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  let approved = 0, voided = 0
  const { data: rows } = await admin
    .from('commission' as any)
    .select('commission_id, attribution')
    .eq('status', 'pending')
    .lte('return_window_ends_at', now)
    .limit(500)
  for (const r of (rows as any[]) ?? []) {
    if (r.attribution === 'none') {
      const res = await transition(r.commission_id, 'pending', 'void', 'system', 'Window closed — not MYRA-attributed')
      if (res.ok) voided++
    } else {
      const res = await transition(r.commission_id, 'pending', 'approved', 'system', 'Return window closed')
      if (res.ok) approved++
    }
  }
  return { approved, voided }
}
