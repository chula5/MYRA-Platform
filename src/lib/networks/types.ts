// One normalised shape for every affiliate network.
//
// Each connector's only job is to turn its network's payload into these rows.
// All reconciliation, attribution and storage happens once, in sync.ts — so
// adding a fourth network means writing one fetch function, nothing else.

export type NetworkId = 'awin' | 'rakuten' | 'cj'

/** The four states every network's lifecycle collapses to. */
export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'declined'

export interface NormalisedTransaction {
  network: NetworkId
  /** The network's own transaction id — half of the idempotency key. */
  externalId: string
  status: CommissionStatus
  saleAmountGbp: number
  commissionGbp: number
  advertiserName: string | null
  /** Whatever the network echoed back in its sub-id field. For MYRA links this
   *  is the click_id, and sync.ts resolves it to the click, item and outfit. */
  clickRef: string | null
  occurredAt: string
  raw: Record<string, unknown>
}

export type ConnectorResult =
  | { ok: true; transactions: NormalisedTransaction[] }
  | { ok: false; reason: 'not_configured'; missing: string[] }
  | { ok: false; reason: 'error'; message: string }

export interface ConnectorWindow {
  start: Date
  end: Date
}

/** Which env vars each network needs. Surfaced verbatim in the admin UI. */
export const REQUIRED_ENV: Record<NetworkId, string[]> = {
  awin: ['AWIN_API_TOKEN', 'AWIN_PUBLISHER_ID'],
  rakuten: ['RAKUTEN_CLIENT_ID', 'RAKUTEN_CLIENT_SECRET', 'RAKUTEN_ACCOUNT_SID'],
  cj: ['CJ_API_TOKEN', 'CJ_PUBLISHER_ID'],
}

export function missingEnv(network: NetworkId): string[] {
  return REQUIRED_ENV[network].filter((k) => !process.env[k])
}

/** Networks describe status in their own vocabulary; this is the mapping. */
export function normaliseStatus(raw: string | null | undefined): CommissionStatus {
  const s = (raw ?? '').toLowerCase()
  if (['declined', 'deleted', 'rejected', 'cancelled', 'canceled', 'returned', 'corrected', 'void'].some((v) => s.includes(v))) {
    return 'declined'
  }
  if (['paid', 'closed', 'locked'].some((v) => s.includes(v))) return 'paid'
  if (['approved', 'confirmed', 'validated', 'extended', 'accepted'].some((v) => s.includes(v))) return 'approved'
  return 'pending'
}

/** Defensive numeric read — networks nest amounts differently across versions. */
export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  if (v && typeof v === 'object' && 'amount' in (v as any)) return num((v as any).amount)
  return 0
}

/** First non-empty value among several possible field names. */
export function pick<T = unknown>(obj: Record<string, any>, ...keys: string[]): T | null {
  for (const k of keys) {
    const v = obj?.[k]
    if (v !== undefined && v !== null && v !== '') return v as T
  }
  return null
}

/** A fetch that fails loudly on a timeout rather than hanging a page render. */
export async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<any> {
  const { timeoutMs = 20000, ...rest } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal, cache: 'no-store' })
    const text = await res.text()
    if (!res.ok) {
      // Truncate — network error bodies can be whole HTML pages.
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${text.slice(0, 300)}`)
    }
    return text ? JSON.parse(text) : null
  } finally {
    clearTimeout(timer)
  }
}
