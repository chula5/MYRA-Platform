// Pulls every network into one ledger.
//
// The connectors know their own API and nothing else. Everything shared lives
// here: attribution back to a MYRA click, the idempotent upsert, and the
// per-network sync log the dashboard reads to say whether a zero means "no
// sales" or "the credential expired".

import { createAdminClient } from '@/lib/supabase-server'
import { isMissingTable } from '@/lib/metrics-core'
import { fetchAwinTransactions } from './awin'
import { fetchRakutenTransactions } from './rakuten'
import { fetchCjTransactions } from './cj'
import { metaMissingEnv } from './meta-ads'
import { missingEnv, type ConnectorResult, type NetworkId, type NormalisedTransaction } from './types'

export const NETWORKS: NetworkId[] = ['awin', 'rakuten', 'cj']

const CONNECTORS: Record<NetworkId, (w: { start: Date; end: Date }) => Promise<ConnectorResult>> = {
  awin: fetchAwinTransactions,
  rakuten: fetchRakutenTransactions,
  cj: fetchCjTransactions,
}

export interface SyncOutcome {
  network: NetworkId
  status: 'ok' | 'error' | 'not_configured'
  rows: number
  message?: string
  missing?: string[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve the network's echoed sub-id back to a MYRA click. Networks pass the
 * ref through untouched, so for our own links it IS the click_id — which gives
 * us the item, the outfit and the merchant behind every sale.
 *
 * A ref that doesn't match any click is kept as-is: the sale is still real
 * money, it just isn't attributable to a look.
 */
async function attribute(
  txs: NormalisedTransaction[],
): Promise<Map<string, { click_id: string; item_id: string | null; outfit_id: string | null; merchant_id: string | null }>> {
  const refs = Array.from(new Set(txs.map((t) => t.clickRef).filter((r): r is string => !!r && UUID_RE.test(r))))
  const map = new Map<string, { click_id: string; item_id: string | null; outfit_id: string | null; merchant_id: string | null }>()
  if (!refs.length) return map

  const admin = createAdminClient()
  // Chunked — a long sync can carry more refs than a URL can hold.
  for (let i = 0; i < refs.length; i += 200) {
    const slice = refs.slice(i, i + 200)
    const { data, error } = await admin
      .from('click' as any)
      .select('click_id, item_id, outfit_id, merchant_id')
      .in('click_id', slice)
    if (error) break
    for (const c of (data ?? []) as any[]) {
      map.set(c.click_id, {
        click_id: c.click_id,
        item_id: c.item_id ?? null,
        outfit_id: c.outfit_id ?? null,
        merchant_id: c.merchant_id ?? null,
      })
    }
  }
  return map
}

async function writeSyncLog(
  network: NetworkId | 'meta',
  fields: { status: string; error?: string | null; rows?: number; start?: Date; end?: Date },
): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('network_sync_log' as any).upsert(
      {
        network,
        last_synced_at: new Date().toISOString(),
        last_status: fields.status,
        last_error: fields.error ?? null,
        rows_synced: fields.rows ?? 0,
        window_start: fields.start?.toISOString() ?? null,
        window_end: fields.end?.toISOString() ?? null,
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: 'network' },
    )
  } catch (err) {
    console.error('[writeSyncLog]', err)
  }
}

/**
 * Sync one network over the last `days`. The window deliberately overlaps
 * previous syncs — networks revise a transaction's status for weeks after the
 * sale, and the (network, external_id) key means re-reading is free.
 */
export async function syncNetwork(network: NetworkId, days = 60): Promise<SyncOutcome> {
  const end = new Date()
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - days)

  const result = await CONNECTORS[network]({ start, end })

  if (!result.ok && result.reason === 'not_configured') {
    await writeSyncLog(network, { status: 'not_configured', error: `Missing: ${result.missing.join(', ')}` })
    return { network, status: 'not_configured', rows: 0, missing: result.missing }
  }
  if (!result.ok) {
    await writeSyncLog(network, { status: 'error', error: result.message, start, end })
    return { network, status: 'error', rows: 0, message: result.message }
  }

  const attribution = await attribute(result.transactions)
  const admin = createAdminClient()

  const rows = result.transactions.map((t) => {
    const hit = t.clickRef ? attribution.get(t.clickRef) : undefined
    return {
      network: t.network,
      external_id: t.externalId,
      status: t.status,
      sale_amount_gbp: Number(t.saleAmountGbp.toFixed(2)),
      commission_gbp: Number(t.commissionGbp.toFixed(2)),
      advertiser_name: t.advertiserName,
      merchant_id: hit?.merchant_id ?? null,
      click_ref: t.clickRef,
      click_id: hit?.click_id ?? null,
      item_id: hit?.item_id ?? null,
      outfit_id: hit?.outfit_id ?? null,
      occurred_at: t.occurredAt,
      updated_at: new Date().toISOString(),
      raw: t.raw,
    }
  })

  let written = 0
  try {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin
        .from('commission_transaction' as any)
        .upsert(rows.slice(i, i + 500) as any, { onConflict: 'network,external_id' })
      if (error) throw new Error(error.message)
      written += Math.min(500, rows.length - i)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await writeSyncLog(network, { status: 'error', error: message, rows: written, start, end })
    return { network, status: 'error', rows: written, message }
  }

  await writeSyncLog(network, { status: 'ok', error: null, rows: written, start, end })
  return { network, status: 'ok', rows: written }
}

export async function syncAllNetworks(days = 60): Promise<SyncOutcome[]> {
  return Promise.all(NETWORKS.map((n) => syncNetwork(n, days)))
}

// ── Read side ───────────────────────────────────────────────────────────────

export interface NetworkStatus {
  network: NetworkId | 'meta'
  configured: boolean
  missing: string[]
  lastSyncedAt: string | null
  lastStatus: string
  lastError: string | null
  rowsSynced: number
}

/** Connection + last-sync state for every network, for the status strip. */
export async function getNetworkStatuses(): Promise<NetworkStatus[]> {
  const admin = createAdminClient()
  let logs: any[] = []
  try {
    const { data } = await admin.from('network_sync_log' as any).select('*')
    logs = data ?? []
  } catch {
    /* table not migrated yet */
  }

  const all: (NetworkId | 'meta')[] = [...NETWORKS, 'meta']
  return all.map((n) => {
    const log = logs.find((l) => l.network === n)
    // META_AD_ACCOUNT_ID is optional — it falls back to the MYRA ad account.
    const missing = n === 'meta' ? metaMissingEnv() : missingEnv(n as NetworkId)
    return {
      network: n,
      configured: missing.length === 0,
      missing,
      lastSyncedAt: log?.last_synced_at ?? null,
      lastStatus: log?.last_status ?? 'never',
      lastError: log?.last_error ?? null,
      rowsSynced: log?.rows_synced ?? 0,
    }
  })
}

export interface CommissionRow {
  id: string
  network: NetworkId
  status: string
  sale_amount_gbp: number
  commission_gbp: number
  advertiser_name: string | null
  occurred_at: string
  item_id: string | null
  outfit_id: string | null
  click_ref: string | null
}

export async function getCommissions(sinceDays = 90): Promise<{ rows: CommissionRow[]; available: boolean }> {
  const admin = createAdminClient()
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - sinceDays)
  try {
    const { data, error } = await admin
      .from('commission_transaction' as any)
      .select('id, network, status, sale_amount_gbp, commission_gbp, advertiser_name, occurred_at, item_id, outfit_id, click_ref')
      .gte('occurred_at', since.toISOString())
      .order('occurred_at', { ascending: false })
      .limit(1000)
    if (error) return { rows: [], available: !isMissingTable(error) }
    return { rows: (data ?? []) as unknown as CommissionRow[], available: true }
  } catch {
    return { rows: [], available: false }
  }
}
