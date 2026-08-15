// Commission ledger — PURE logic (no I/O), so the money rules are unit-testable
// in isolation. Everything financial that can be a pure function lives here.

// ── State machine ───────────────────────────────────────────────────────────
export type CommissionStatus = 'pending' | 'approved' | 'payable' | 'paid' | 'void' | 'returned'

// pending → approved → payable → paid ; pending → void ; approved/payable → returned.
// `returned` after payable means money already drawn must be credited back
// (Part 5 writes the reversing balance entry); the transition itself is legal.
const TRANSITIONS: Record<CommissionStatus, CommissionStatus[]> = {
  pending:  ['approved', 'void'],
  approved: ['payable', 'returned'],
  payable:  ['paid', 'returned'],
  paid:     ['returned'],
  void:     [],
  returned: [],
}

export function canTransition(from: CommissionStatus, to: CommissionStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}

// ── Rates ───────────────────────────────────────────────────────────────────
export interface TermsLike {
  base_rate: number
  intro_rate?: number | null
  intro_expires_at?: string | Date | null
  tier_threshold_gbp?: number | null
  tier_rate?: number | null
}

// The rate for an order: intro rate while unexpired (auto-reverts — no cron,
// just a date comparison at accrual time), else volume tier, else base.
export function resolveRate(
  terms: TermsLike | null,
  orderDate: Date,
  monthVolumeGbp = 0,
  fallbackRate = 0.15,
): number {
  if (!terms) return fallbackRate
  if (terms.intro_rate != null && terms.intro_expires_at != null) {
    if (orderDate < new Date(terms.intro_expires_at)) return Number(terms.intro_rate)
  }
  if (terms.tier_rate != null && terms.tier_threshold_gbp != null && monthVolumeGbp >= Number(terms.tier_threshold_gbp)) {
    return Number(terms.tier_rate)
  }
  return Number(terms.base_rate)
}

// Commission in pence-accurate GBP. Banker's-free simple half-up to 2dp —
// consistent everywhere so the ledger, dashboard and invoice always agree.
export function computeCommissionGbp(orderValueGbp: number, rate: number): number {
  if (!Number.isFinite(orderValueGbp) || !Number.isFinite(rate) || orderValueGbp <= 0 || rate <= 0) return 0
  return Math.round(orderValueGbp * rate * 100) / 100
}

export function returnWindowEnd(orderCreatedAt: Date, windowDays: number): Date {
  const d = new Date(orderCreatedAt)
  d.setUTCDate(d.getUTCDate() + Math.max(0, windowDays || 0))
  return d
}

// ── Order parsing ───────────────────────────────────────────────────────────
// Commission base = merchandise subtotal (excludes shipping + tax): what the
// commission percentage was agreed against. Falls back defensively.
export function commissionBase(order: any): { amount: number; currency: string } {
  const amount =
    num(order?.current_subtotal_price) ??
    num(order?.subtotal_price) ??
    num(order?.total_price) ??
    0
  return { amount, currency: String(order?.currency ?? 'GBP').toUpperCase() }
}

export type OrderOutcome = 'active' | 'cancelled' | 'refunded' | 'partially_refunded'

export function orderOutcome(order: any): OrderOutcome {
  if (order?.cancelled_at) return 'cancelled'
  const fs = String(order?.financial_status ?? '')
  if (fs === 'refunded' || fs === 'voided') return 'refunded'
  if (fs === 'partially_refunded') return 'partially_refunded'
  return 'active'
}

// ── Attribution ─────────────────────────────────────────────────────────────
const CLICK_RE = /[?&](?:myra_click|myra_click_id)=([0-9a-zA-Z_-]{8,64})/

export function extractMyraClick(url: string | null | undefined): string | null {
  if (!url) return null
  const m = CLICK_RE.exec(String(url))
  return m ? m[1] : null
}

export interface JourneyMoment {
  landingPage?: string | null
  occurredAt?: string | null
  referrerUrl?: string | null
  utmParameters?: { source?: string | null; medium?: string | null } | null
}

export interface JourneyAttribution {
  clickId: string | null
  /** true when a MYRA utm was seen even if the click id wasn't recoverable */
  myraTouched: boolean
  momentAt: string | null
}

// Scan the 30-day journey (most recent MYRA touch wins — last-click within the
// window, matching how the networks she compares us against attribute).
export function attributeFromJourney(moments: JourneyMoment[] | null | undefined): JourneyAttribution {
  let clickId: string | null = null
  let myraTouched = false
  let momentAt: string | null = null
  for (const m of moments ?? []) {
    const fromLanding = extractMyraClick(m?.landingPage)
    const utmMyra = String(m?.utmParameters?.source ?? '').toLowerCase() === 'myra'
    if (fromLanding || utmMyra) {
      myraTouched = true
      // Keep scanning: later moments override earlier ones (last click wins).
      if (fromLanding) clickId = fromLanding
      momentAt = m?.occurredAt ?? momentAt
    }
  }
  return { clickId, myraTouched, momentAt }
}

function num(v: unknown): number | null {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}
