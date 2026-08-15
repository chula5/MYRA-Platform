// Part 5: money movement. balance_entry is APPEND-ONLY — the balance is always
// SUM(amount_gbp), never a mutable column. Positive credits, negative draws.
//
// Prefunded model (default): approved commission sweeps to payable and draws
// down the balance. At/below the pause threshold the merchant is marked paused
// (surfaced in admin + partner dashboard; item-level feed enforcement is a
// follow-up noted in the Part 5 summary).
//
// NOT built, deliberately: any movement of money OUT of MYRA beyond the
// refund/adjustment entry types, and any card handling — Stripe integration
// awaits keys and is isolated behind recordTopUp.

import { createAdminClient } from '@/lib/supabase-server'
import { transition } from '@/lib/ledger/store'

export async function getBalanceGbp(merchantId: string): Promise<number> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('balance_entry' as any)
    .select('amount_gbp')
    .eq('merchant_id', merchantId)
    .limit(10000)
  const sum = ((data as any[]) ?? []).reduce((s, e) => s + (Number(e.amount_gbp) || 0), 0)
  return Math.round(sum * 100) / 100
}

export async function recordBalanceEntry(opts: {
  merchantId: string
  entryType: 'topup' | 'commission_draw' | 'refund' | 'adjustment' | 'invoice_payment' | 'reversal'
  amountGbp: number
  commissionId?: string | null
  invoiceId?: string | null
  actor?: string
  reason?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(opts.amountGbp) || opts.amountGbp === 0) return { ok: false, error: 'Amount must be non-zero' }
  const admin = createAdminClient()
  const { error } = await admin.from('balance_entry' as any).insert({
    merchant_id: opts.merchantId,
    entry_type: opts.entryType,
    amount_gbp: Math.round(opts.amountGbp * 100) / 100,
    commission_id: opts.commissionId ?? null,
    invoice_id: opts.invoiceId ?? null,
    actor: opts.actor ?? 'system',
    reason: opts.reason ?? null,
  } as any)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Sweep (cron): approved → payable, drawing down prefunded balances ──────
export async function sweepApprovedCommissions(): Promise<{ swept: number; paused: string[] }> {
  const admin = createAdminClient()
  let swept = 0
  const paused: string[] = []

  const { data: rows } = await admin
    .from('commission' as any)
    .select('commission_id, merchant_id, commission_gbp, order_number, merchant:merchant_id(billing_model, status, balance_pause_threshold_gbp, name)')
    .eq('status', 'approved')
    .gt('commission_gbp', 0)
    .limit(200)

  for (const r of (rows as any[]) ?? []) {
    if (r.merchant?.billing_model !== 'prefunded') continue // invoiced model sweeps via monthly invoice
    const res = await transition(r.commission_id, 'approved', 'payable', 'system', 'Swept to balance')
    if (!res.ok) continue
    const draw = await recordBalanceEntry({
      merchantId: r.merchant_id,
      entryType: 'commission_draw',
      amountGbp: -Number(r.commission_gbp),
      commissionId: r.commission_id,
      reason: `Commission on ${r.order_number ?? 'order'}`,
    })
    if (!draw.ok) continue
    await transition(r.commission_id, 'payable', 'paid', 'system', 'Settled against pre-funded balance')
    swept++

    const balance = await getBalanceGbp(r.merchant_id)
    const threshold = Number(r.merchant?.balance_pause_threshold_gbp ?? 0)
    if (balance <= threshold && r.merchant?.status === 'active') {
      await admin.from('merchant' as any).update({ status: 'paused' } as any).eq('merchant_id', r.merchant_id)
      paused.push(r.merchant?.name ?? r.merchant_id)
    }
  }
  return { swept, paused }
}

// ── Monthly invoice for invoiced-model merchants ────────────────────────────
export async function createMonthlyInvoice(merchantId: string, periodStart: Date, periodEnd: Date, actor = 'system'): Promise<{ ok: boolean; invoiceNumber?: string; error?: string }> {
  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('commission' as any)
    .select('commission_id, commission_gbp, order_number, order_created_at, currency, order_value, fx_rate_to_gbp')
    .eq('merchant_id', merchantId)
    .eq('status', 'approved')
    .gte('order_created_at', periodStart.toISOString())
    .lt('order_created_at', periodEnd.toISOString())
  const items = ((rows as any[]) ?? []).filter((r) => Number(r.commission_gbp) > 0)
  if (!items.length) return { ok: false, error: 'Nothing approved in that period' }

  const subtotal = Math.round(items.reduce((s, r) => s + Number(r.commission_gbp), 0) * 100) / 100
  // VAT: reverse_charge / cross-border treatment is CONFIG for the accountant
  // to confirm — we record treatment text, we do not invent a rate.
  const { data: merchant } = await admin.from('merchant' as any).select('reverse_charge, country_code').eq('merchant_id', merchantId).single()
  const reverse = Boolean((merchant as any)?.reverse_charge)
  const vatTreatment = reverse
    ? 'Reverse charge: customer to account for VAT'
    : 'VAT treatment to be confirmed — see engagement terms'

  const { data: inv, error } = await admin.from('invoice' as any).insert({
    merchant_id: merchantId,
    period_start: periodStart.toISOString().slice(0, 10),
    period_end: periodEnd.toISOString().slice(0, 10),
    line_items: items.map((r) => ({
      commission_id: r.commission_id,
      order: r.order_number,
      order_date: r.order_created_at,
      original: `${r.currency} ${r.order_value}`,
      fx_rate: r.fx_rate_to_gbp,
      commission_gbp: Number(r.commission_gbp),
    })) as any,
    subtotal_gbp: subtotal,
    vat_treatment: vatTreatment,
    vat_gbp: 0,
    total_gbp: subtotal,
    due_at: new Date(Date.now() + 30 * 864e5).toISOString(), // net 30
  } as any).select('invoice_id, invoice_number').single()
  if (error) return { ok: false, error: error.message }

  for (const r of items) {
    await transition(r.commission_id, 'approved', 'payable', actor, `Invoiced ${(inv as any).invoice_number}`)
  }
  return { ok: true, invoiceNumber: (inv as any).invoice_number }
}
