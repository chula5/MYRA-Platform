// Awin — Publisher Transactions API.
//
//   GET https://api.awin.com/publishers/{publisherId}/transactions/
//       ?startDate=YYYY-MM-DDTHH:mm:ss&endDate=...&timezone=Europe/London
//       Authorization: Bearer {AWIN_API_TOKEN}
//
// Awin caps a single call at a 31-day window, so longer ranges are fetched in
// month-sized chunks. Amounts already arrive in the account currency (GBP for
// MYRA); anything else is converted rather than assumed.
//
// MYRA's Awin merchants (Da Luna) run Convert-a-Link, so the click ref comes
// back in clickRefs.clickRef — the value the MasterTag picked up client-side.

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

const BASE = 'https://api.awin.com'
const MAX_WINDOW_DAYS = 31

/** Awin wants a local ISO string with no timezone suffix and no milliseconds. */
function awinDate(d: Date): string {
  return d.toISOString().slice(0, 19)
}

export async function fetchAwinTransactions(window: ConnectorWindow): Promise<ConnectorResult> {
  const missing = missingEnv('awin')
  if (missing.length) return { ok: false, reason: 'not_configured', missing }

  const token = process.env.AWIN_API_TOKEN!
  const publisherId = process.env.AWIN_PUBLISHER_ID!

  try {
    const out: NormalisedTransaction[] = []

    for (let cursor = new Date(window.start); cursor < window.end; ) {
      const chunkEnd = new Date(cursor)
      chunkEnd.setUTCDate(chunkEnd.getUTCDate() + MAX_WINDOW_DAYS)
      const end = chunkEnd < window.end ? chunkEnd : window.end

      const url =
        `${BASE}/publishers/${encodeURIComponent(publisherId)}/transactions/` +
        `?startDate=${encodeURIComponent(awinDate(cursor))}` +
        `&endDate=${encodeURIComponent(awinDate(end))}` +
        `&timezone=Europe/London`

      const data = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } })
      const rows: any[] = Array.isArray(data) ? data : (data?.transactions ?? [])

      for (const r of rows) {
        const saleCurrency = pick<string>(r?.saleAmount ?? {}, 'currency') ?? r?.currency ?? 'GBP'
        const commCurrency = pick<string>(r?.commissionAmount ?? {}, 'currency') ?? saleCurrency

        out.push({
          network: 'awin',
          externalId: String(pick(r, 'id', 'transactionId', 'orderRef') ?? ''),
          status: normaliseStatus(pick<string>(r, 'commissionStatus', 'status')),
          saleAmountGbp: toGbp(num(r?.saleAmount), saleCurrency),
          commissionGbp: toGbp(num(r?.commissionAmount), commCurrency),
          advertiserName: pick<string>(r, 'advertiserName', 'siteName') ?? null,
          clickRef:
            pick<string>(r?.clickRefs ?? {}, 'clickRef', 'clickRef2', 'clickRef3') ??
            pick<string>(r, 'clickRef') ??
            null,
          occurredAt: new Date(pick<string>(r, 'transactionDate', 'clickDate') ?? cursor.toISOString()).toISOString(),
          raw: r,
        })
      }

      cursor = end
    }

    return { ok: true, transactions: out.filter((t) => t.externalId) }
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
