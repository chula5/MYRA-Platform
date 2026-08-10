// Meta Ads — daily spend, pulled from the Marketing API Insights endpoint.
//
//   GET https://graph.facebook.com/v21.0/act_{accountId}/insights
//       ?level=campaign&time_increment=1
//       &time_range={"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}
//       &fields=campaign_id,campaign_name,spend,impressions,clicks,reach,actions
//       &access_token={META_ACCESS_TOKEN}
//
// Why an env-var token and not the Meta MCP: MCP tools are a Claude-side
// surface. They can't be called from a Next.js server action, so the app needs
// its own credential to keep the dashboard fresh on its own. The MCP is still
// useful for a one-off backfill — see backfillAdSpend() below, which takes rows
// in the same shape and writes them to the same table.
//
// The MYRA ad account bills in GBP, so spend is stored verbatim.

import { createAdminClient } from '@/lib/supabase-server'
import { isMissingTable } from '@/lib/metrics-core'
import { fetchJson } from './types'

const API_VERSION = 'v21.0'

// The MYRA ad account (business "MYRA", GBP). Overridable — set
// META_AD_ACCOUNT_ID when the token belongs to a different account.
const DEFAULT_AD_ACCOUNT_ID = '1395062672751437'

/** Sign-up-shaped results, so "conversions" means the same thing as our own funnel. */
const CONVERSION_ACTIONS = new Set([
  'lead',
  'complete_registration',
  'offsite_conversion.fb_pixel_lead',
  'offsite_conversion.fb_pixel_complete_registration',
  'onsite_conversion.lead_grouped',
])

export interface AdSpendRow {
  platform: 'meta'
  spend_date: string
  campaign_id: string
  campaign_name: string | null
  spend_gbp: number
  impressions: number
  clicks: number
  reach: number
  conversions: number
  raw: Record<string, unknown>
}

export function metaMissingEnv(): string[] {
  return ['META_ACCESS_TOKEN'].filter((k) => !process.env[k])
}

export function metaAdAccountId(): string {
  return (process.env.META_AD_ACCOUNT_ID || DEFAULT_AD_ACCOUNT_ID).replace(/^act_/, '')
}

function countConversions(actions: any[] | undefined): number {
  if (!Array.isArray(actions)) return 0
  return actions
    .filter((a) => CONVERSION_ACTIONS.has(String(a?.action_type)))
    .reduce((s, a) => s + Number(a?.value ?? 0), 0)
}

export type MetaFetchResult =
  | { ok: true; rows: AdSpendRow[] }
  | { ok: false; reason: 'not_configured'; missing: string[] }
  | { ok: false; reason: 'error'; message: string }

export async function fetchMetaSpend(days = 60): Promise<MetaFetchResult> {
  const missing = metaMissingEnv()
  if (missing.length) return { ok: false, reason: 'not_configured', missing }

  const until = new Date()
  const since = new Date(until)
  since.setUTCDate(since.getUTCDate() - days)

  const params = new URLSearchParams({
    level: 'campaign',
    time_increment: '1',
    time_range: JSON.stringify({
      since: since.toISOString().slice(0, 10),
      until: until.toISOString().slice(0, 10),
    }),
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,reach,actions',
    limit: '500',
    access_token: process.env.META_ACCESS_TOKEN!,
  })

  try {
    const rows: AdSpendRow[] = []
    let url = `https://graph.facebook.com/${API_VERSION}/act_${metaAdAccountId()}/insights?${params}`

    // Insights paginates via an opaque `next` URL; follow it, with a hard stop.
    for (let page = 0; page < 20 && url; page++) {
      const data = await fetchJson(url)
      for (const r of data?.data ?? []) {
        rows.push({
          platform: 'meta',
          spend_date: String(r.date_start),
          campaign_id: String(r.campaign_id ?? '(account)'),
          campaign_name: r.campaign_name ?? null,
          spend_gbp: Number(r.spend ?? 0),
          impressions: Number(r.impressions ?? 0),
          clicks: Number(r.clicks ?? 0),
          reach: Number(r.reach ?? 0),
          conversions: countConversions(r.actions),
          raw: r,
        })
      }
      url = data?.paging?.next ?? ''
    }

    return { ok: true, rows }
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Write daily spend rows. Shared by the live fetch and by a manual backfill —
 * a set of rows pulled through the Meta MCP can be handed straight to this.
 * Upsert on (platform, spend_date, campaign_id), so re-running a day corrects
 * it rather than double-counting.
 */
export async function backfillAdSpend(rows: AdSpendRow[]): Promise<{ written: number; error?: string }> {
  if (!rows.length) return { written: 0 }
  const admin = createAdminClient()
  try {
    let written = 0
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, synced_at: new Date().toISOString() }))
      const { error } = await admin
        .from('ad_spend_daily' as any)
        .upsert(chunk as any, { onConflict: 'platform,spend_date,campaign_id' })
      if (error) throw new Error(error.message)
      written += chunk.length
    }
    return { written }
  } catch (err) {
    return { written: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface AdSpendRecord {
  spend_date: string
  campaign_id: string
  campaign_name: string | null
  spend_gbp: number
  impressions: number
  clicks: number
  reach: number
  conversions: number
}

export async function getAdSpend(days = 90): Promise<{ rows: AdSpendRecord[]; available: boolean }> {
  const admin = createAdminClient()
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  try {
    const { data, error } = await admin
      .from('ad_spend_daily' as any)
      .select('spend_date, campaign_id, campaign_name, spend_gbp, impressions, clicks, reach, conversions')
      .eq('platform', 'meta')
      .gte('spend_date', since.toISOString().slice(0, 10))
      .order('spend_date', { ascending: true })
      .limit(2000)
    if (error) return { rows: [], available: !isMissingTable(error) }
    return { rows: (data ?? []) as unknown as AdSpendRecord[], available: true }
  } catch {
    return { rows: [], available: false }
  }
}
