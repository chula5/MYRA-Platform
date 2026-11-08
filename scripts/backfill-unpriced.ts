// FILL IN THE PRICE ON PIECES THAT SHOW NONE.
//
// Chloe (2026-11-01): "some items also do not show prices". A piece read off a
// shop whose currency MYRA could not confirm (Mirror-fed tiles, a Shopify
// store that would not say) keeps its number but no price_gbp — unpriced rather
// than wrong, so a $248 piece never shows as £248. Cards only show price_gbp,
// so ~2,200 pieces showed no price at all (Claudie Pierlot, Isabel Marant
// intl, Munthe, Sézane, Reformation…).
//
// This reads each such piece's own page for the price AND the currency its
// structured data names (lib/retailer-prices), and only then writes price,
// currency and price_gbp. A page that names no currency is left as it was,
// except a UK site (uk./gb. host, .co.uk, /en-gb/), which is pounds.
//
//   node_modules/.bin/jiti scripts/backfill-unpriced.ts --dry-run
//   node_modules/.bin/jiti scripts/backfill-unpriced.ts --brand="Claudie Pierlot"
//   node_modules/.bin/jiti scripts/backfill-unpriced.ts

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { priceFromJsonLd, priceFromShopifyJs, type PriceReading } from '../src/lib/retailer-prices'
import { toGbpAmount, knownCurrency } from '../src/lib/currency'

const env: Record<string, string> = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const brandArg = args.find((a) => a.startsWith('--brand='))?.slice(8).replace(/^"|"$/g, '')

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const HOST_GAP_MS = 1200

/** A UK storefront by its address: pounds. */
function ukSite(url: string): boolean {
  try {
    const u = new URL(url)
    return /^(uk|gb)\./i.test(u.host) || /\.uk$/i.test(u.host) || /^\/(gb|uk|en-gb|en-uk)(\/|$)/i.test(u.pathname)
  } catch { return false }
}

async function page(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(10_000) })
    return res.ok ? await res.text() : null
  } catch { return null }
}

/** A Shopify page with no JSON-LD (Munthe): the product's .js, in the currency the page says is active. */
async function shopifyReading(url: string, html: string): Promise<PriceReading | null> {
  const active = html.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/)?.[1] ?? null
  if (!active || !/\/products\//.test(url)) return null
  try {
    const res = await fetch(`${url.split('?')[0].replace(/\/$/, '')}.js`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const read = priceFromShopifyJs(await res.json())
    return read ? { ...read, currency: active } : null
  } catch { return null }
}

async function main() {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    let q = admin.from('item').select('item_id, product_name, price, currency, retailer_url, brand:brand_id(name)')
      .in('status', ['ready', 'live', 'draft']).is('price_gbp', null).not('retailer_url', 'is', null)
      .range(from, from + 999)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const todo = rows.filter((r) => !brandArg || (r.brand?.name ?? '').toLowerCase() === brandArg.toLowerCase())
  console.log(`${todo.length} unpriced pieces${brandArg ? ` for ${brandArg}` : ''}${dry ? ' (dry run)' : ''}`)

  // One queue per shop, all shops at once, a polite gap within each.
  const byHost = new Map<string, any[]>()
  for (const r of todo) {
    let host = ''
    try { host = new URL(r.retailer_url).host } catch { continue }
    byHost.set(host, [...(byHost.get(host) ?? []), r])
  }
  const tally = { priced: 0, noPage: 0, noPrice: 0, noCurrency: 0 }
  const samples: string[] = []

  await Promise.all(Array.from(byHost.entries()).map(async ([host, list]) => {
    for (const r of list) {
      const html = await page(r.retailer_url)
      await new Promise((ok) => setTimeout(ok, HOST_GAP_MS))
      if (!html) { tally.noPage++; continue }
      const read = priceFromJsonLd(html) ?? await shopifyReading(r.retailer_url, html)
      if (!read) { tally.noPrice++; continue }
      const currency = read.currency && knownCurrency(read.currency) ? read.currency : (!read.currency && ukSite(r.retailer_url) ? 'GBP' : null)
      if (!currency) { tally.noCurrency++; continue }
      const gbp = toGbpAmount(read.amount, currency)
      if (gbp == null) { tally.noCurrency++; continue }
      tally.priced++
      if (samples.length < 12) samples.push(`${r.brand?.name} · ${r.product_name}: stored ${r.price ?? '—'} ${r.currency ?? '?'} → ${read.amount} ${currency} = £${Math.round(gbp)}`)
      if (!dry) {
        await admin.from('item').update({ price: String(read.amount), currency, price_gbp: Math.round(gbp * 100) / 100 }).eq('item_id', r.item_id)
      }
    }
    console.log(`  ${host}: done (${list.length})`)
  }))

  console.log(samples.join('\n'))
  console.log(tally)
}

main().catch((err) => { console.error(err); process.exit(1) })
