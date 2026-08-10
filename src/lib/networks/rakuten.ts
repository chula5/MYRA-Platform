// Rakuten Advertising — Events (Transaction) API.
//
// Two steps, because Rakuten's tokens are short-lived:
//   1. POST https://api.linksynergy.com/token
//      Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)
//      body: scope={RAKUTEN_ACCOUNT_SID}&grant_type=client_credentials
//   2. GET  https://api.linksynergy.com/events/1.0/transactions
//      ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&limit=1000&page=N
//      Authorization: Bearer {token}
//
// MYRA's Rakuten merchants (Isabel Marant, Twinset, Diesel, DeMellier) run in
// redirect mode, so the click_id is composed server-side into the deep link's
// u1 field and comes back here as `u1`.

import { toGbp } from '@/lib/currency'
import {
  fetchJson,
  missingEnv,
  normaliseStatus,
  num,
  pick,
  type ConnectorResult,
  type ConnectorWindow,
  type NormalisedTransaction,
} from './types'

const TOKEN_URL = 'https://api.linksynergy.com/token'
const EVENTS_URL = 'https://api.linksynergy.com/events/1.0/transactions'
const PAGE_SIZE = 1000
const MAX_PAGES = 20

async function getAccessToken(): Promise<string> {
  const basic = Buffer.from(
    `${process.env.RAKUTEN_CLIENT_ID}:${process.env.RAKUTEN_CLIENT_SECRET}`,
  ).toString('base64')

  const data = await fetchJson(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      scope: process.env.RAKUTEN_ACCOUNT_SID!,
      grant_type: 'client_credentials',
    }).toString(),
  })

  const token = data?.access_token
  if (!token) throw new Error('Rakuten token response contained no access_token')
  return token as string
}

export async function fetchRakutenTransactions(window: ConnectorWindow): Promise<ConnectorResult> {
  const missing = missingEnv('rakuten')
  if (missing.length) return { ok: false, reason: 'not_configured', missing }

  try {
    const token = await getAccessToken()
    const start = window.start.toISOString().slice(0, 10)
    const end = window.end.toISOString().slice(0, 10)
    const out: NormalisedTransaction[] = []

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${EVENTS_URL}?start_date=${start}&end_date=${end}&limit=${PAGE_SIZE}&page=${page}`
      const data = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } })
      const rows: any[] = Array.isArray(data) ? data : (data?.transactions ?? data?.data ?? [])
      if (!rows.length) break

      for (const r of rows) {
        const currency = pick<string>(r, 'currency', 'sale_currency') ?? 'GBP'
        // Rakuten signals a return by flipping the sign, or via is_event_return.
        const commission = num(pick(r, 'commissions', 'commission', 'commission_amount'))
        const isReturn = r?.is_event_return === true || r?.is_event_return === 'Y' || commission < 0

        out.push({
          network: 'rakuten',
          externalId: String(pick(r, 'etransaction_id', 'transaction_id', 'order_id') ?? ''),
          status: isReturn ? 'declined' : normaliseStatus(pick<string>(r, 'transaction_status', 'status') ?? 'approved'),
          saleAmountGbp: toGbp(num(pick(r, 'sale_amount', 'sales', 'amount')), currency),
          commissionGbp: toGbp(commission, currency),
          advertiserName: pick<string>(r, 'advertiser_name', 'mid_name', 'merchant_name') ?? null,
          clickRef: pick<string>(r, 'u1', 'member_id', 'sid') ?? null,
          occurredAt: new Date(
            pick<string>(r, 'transaction_date', 'process_date', 'event_date') ?? window.start.toISOString(),
          ).toISOString(),
          raw: r,
        })
      }

      if (rows.length < PAGE_SIZE) break
    }

    return { ok: true, transactions: out.filter((t) => t.externalId) }
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
