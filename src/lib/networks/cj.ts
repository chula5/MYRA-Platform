// CJ Affiliate — Commission Detail GraphQL API.
//
//   POST https://commission-detail.api.cj.com/query
//        Authorization: Bearer {CJ_API_TOKEN}
//        Content-Type: application/json
//
// CJ's REST commission endpoints are retired; GraphQL is the current surface.
// The window is capped at 92 days per query, so longer ranges are chunked.
//
// Amounts are requested in the publisher's own currency (pubCurrency) rather
// than the USD fields, so a GBP account needs no conversion at all.

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

const ENDPOINT = 'https://commission-detail.api.cj.com/query'
const MAX_WINDOW_DAYS = 90

function cjTime(d: Date): string {
  return d.toISOString().slice(0, 19) + 'Z'
}

function buildQuery(publisherId: string, since: Date, before: Date): string {
  return `{
    publisherCommissions(
      forPublishers: ["${publisherId}"],
      sincePostingDateTime: "${cjTime(since)}",
      beforePostingDateTime: "${cjTime(before)}"
    ) {
      count
      records {
        commissionId
        actionStatus
        actionType
        advertiserName
        orderId
        postingDate
        eventDate
        saleAmountPubCurrency
        pubCommissionAmountPubCurrency
        pubCurrency
        shopperId
        websiteId
      }
    }
  }`
}

export async function fetchCjTransactions(window: ConnectorWindow): Promise<ConnectorResult> {
  const missing = missingEnv('cj')
  if (missing.length) return { ok: false, reason: 'not_configured', missing }

  const token = process.env.CJ_API_TOKEN!
  const publisherId = process.env.CJ_PUBLISHER_ID!

  try {
    const out: NormalisedTransaction[] = []

    for (let cursor = new Date(window.start); cursor < window.end; ) {
      const chunkEnd = new Date(cursor)
      chunkEnd.setUTCDate(chunkEnd.getUTCDate() + MAX_WINDOW_DAYS)
      const end = chunkEnd < window.end ? chunkEnd : window.end

      const data = await fetchJson(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: buildQuery(publisherId, cursor, end) }),
      })

      // GraphQL returns 200 with an errors array — surface it as a real failure.
      if (data?.errors?.length) {
        throw new Error(data.errors.map((e: any) => e?.message).filter(Boolean).join('; ') || 'CJ GraphQL error')
      }

      const records: any[] = data?.data?.publisherCommissions?.records ?? []

      for (const r of records) {
        const currency = pick<string>(r, 'pubCurrency') ?? 'GBP'
        const commission = num(pick(r, 'pubCommissionAmountPubCurrency', 'pubCommissionAmountUsd'))
        // CJ books a return as a negative correction rather than a status change.
        const isCorrection = commission < 0 || String(r?.actionType ?? '').toLowerCase().includes('correction')

        out.push({
          network: 'cj',
          externalId: String(pick(r, 'commissionId', 'orderId') ?? ''),
          status: isCorrection ? 'declined' : normaliseStatus(pick<string>(r, 'actionStatus')),
          saleAmountGbp: toGbp(num(pick(r, 'saleAmountPubCurrency', 'saleAmountUsd')), currency),
          commissionGbp: toGbp(commission, currency),
          advertiserName: pick<string>(r, 'advertiserName') ?? null,
          // CJ echoes our sub-id in shopperId (the SID on the outbound link).
          clickRef: pick<string>(r, 'shopperId') ?? null,
          occurredAt: new Date(pick<string>(r, 'eventDate', 'postingDate') ?? cursor.toISOString()).toISOString(),
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
