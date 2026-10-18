// ADD THE BRANDS SHE SAVED ON INSTAGRAM TO BRAND WATCH, AT 90% AUTO-ADD.
//
// Each shop goes through the app's own onboarding (createWatchedBrandAndScan,
// mode 'watch': the last 60 days of on-taste pieces, everything marked seen,
// the Monday watching set up; a shop that is not Shopify falls to the browser
// route, and a shop behind a bot wall is kept mirror-fed) — the same path as
// typing the URL into /admin/brand-watch. Then AUTO-ADD is switched on at the
// bar she asked for, exactly as the card's switch does it: auto_keep_confidence
// with the bar, and auto_keep_manual because a brand with no decisions yet has
// not earned the gate. The hourly cron sweeps every AUTO-ADD brand each run, so
// anything already queued above the bar is added within the hour.
//
//   node scripts/add-saved-brands.mjs            # add + switch on at 0.9
//   node scripts/add-saved-brands.mjs --bar 0.92 # a different bar
//   node scripts/add-saved-brands.mjs --dry-run  # list what would happen
//
// Needs .env.local (Supabase service role, ANTHROPIC_API_KEY for the scan's
// classifiers). Safe to re-run: a brand already on the watchlist is left as it
// is and only its AUTO-ADD settings are (re)applied.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire, Module } from 'node:module'

const BRANDS = [
  { name: 'ARMA', url: 'https://armastore.com', ig: 'arma_label' },
  { name: 'N.A Studio', url: 'https://nastudioofficial.com', ig: 'nastudio_official' },
  { name: 'Nina Runsdorf', url: 'https://www.ninarunsdorf.com', ig: 'ninarunsdorfjewelry' },
  { name: 'Tibi', url: 'https://tibi.com', ig: 'tibi' },
  { name: 'Camilla and Marc', url: 'https://www.camillaandmarc.com', ig: 'camillaandmarc' },
  { name: 'Love Stories', url: 'https://www.lovestoriesintimates.com', ig: 'lovestoriesintimates' },
  { name: "Sarah's Bag", url: 'https://www.sarahsbag.com', ig: 'sarahsbag' },
  { name: 'Tae Park', url: 'https://www.tae-park.com', ig: 'tae___park' },
  { name: 'Horton New York', url: 'https://hortonnewyork.com', ig: 'hortonnewyork' },
  { name: 'Alexandra Grecco', url: 'https://www.alexandragrecco.com', ig: 'alexandragrecco' },
  { name: "Conor O'Brien Studio", url: 'https://conorobrienstudio.com', ig: 'conorobrienstudio' },
  { name: 'Loeffler Randall', url: 'https://www.loefflerrandall.com', ig: 'loefflerrandall' },
  { name: 'Edward Meller', url: 'https://www.edwardmeller.com.au', ig: 'edwardmellershoes' },
  { name: 'Carla Zampatti', url: 'https://www.carlazampatti.com.au', ig: 'carlazampatti' },
  { name: 'Scanlan Theodore', url: 'https://www.scanlantheodore.com', ig: 'scanlantheodore' },
  // Second batch of saves.
  { name: 'Les Archives', url: 'https://www.lesarchivesparis.com', ig: 'les_____archives' },
  { name: 'Comptoir Vintage', url: 'https://comptoirvintage.com', ig: 'comptoir.vintage.paris' },
  { name: 'AMLUL', url: 'https://shop.amlul.com', ig: 'amlul' },
  { name: 'Nomasei', url: 'https://nomasei.com', ig: 'nomasei_official' },
  { name: 'Kulakovsky', url: 'https://kulakovsky.ua', ig: 'kulakovsky' },
  { name: 'Maria McManus', url: 'https://mariamcmanus.com', ig: 'maria_mcmanus_' },
  { name: 'Advene', url: 'https://advenedesign.com', ig: 'advene_design' },
  { name: 'EENK', url: 'https://eenkshop.com', ig: 'eenk_official' },
  { name: 'Linnea Lund', url: 'https://linnealund.com', ig: 'linnealund_official' },
  { name: 'Front Row Shop', url: 'https://www.frontrowshop.com', ig: 'frontrowshop' },
  { name: 'Deux Amis', url: 'https://deuxamis.co', ig: 'deuxamis.co' },
  { name: 'HAI', url: 'https://homeofhai.com', ig: 'homeofhai' },
]
// Saved too, but with no shop a server can read: The Favorite Vintage sells
// from Instagram; Cardón (cardon_mx) is a multi-brand concept store in Mexico
// City with no web shop found; "albausart" was only a caption fragment. Add
// them by hand once they have a storefront.

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const barArg = args.indexOf('--bar')
const bar = Math.max(0.5, Math.min(0.99, barArg >= 0 ? Number(args[barArg + 1]) : 0.9))
const CONCURRENCY = 3
const onlyArg = args.indexOf('--only')
const only = onlyArg >= 0 ? String(args[onlyArg + 1] ?? '').toLowerCase() : ''
const RUN = only ? BRANDS.filter((b) => b.name.toLowerCase().includes(only)) : BRANDS

// .env.local, as the other scripts read it.
const envFile = path.join(process.cwd(), '.env.local')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (.env.local)')
  process.exit(1)
}

// The app's own modules, loaded the way compute-persona-envelope.mjs does it:
// the @ alias wired by hand (the repo's jiti reads no tsconfig paths), plus two
// Next/Vercel-only modules swapped for stubs that make sense in a script.
const require = createRequire(import.meta.url)
const stubs = path.resolve(process.cwd(), 'scripts/stubs')
// jiti v1's alias only rewrites path-like ids, not a bare package name — so the
// two Next/Vercel modules are swapped in Node's own require cache, which jiti
// shares, before anything imports them. (The first run of this script loaded
// the real next/cache and every add died in revalidatePath after the insert.)
for (const [id, stub] of [['next/cache', 'next-cache.cjs'], ['@vercel/functions', 'vercel-functions.cjs']]) {
  const file = require.resolve(id)
  const m = new Module(file); m.filename = file; m.loaded = true; m.exports = require(path.join(stubs, stub))
  require.cache[file] = m
}
const jiti = require('jiti')(fileURLToPath(import.meta.url), { alias: { '@': path.resolve(process.cwd(), 'src') } })
const { flush } = require(path.join(stubs, 'vercel-functions.cjs'))
const { createAdminClient } = jiti(path.resolve(process.cwd(), 'src/lib/supabase-server.ts'))
const { createWatchedBrandAndScan, scanNewBrand } = jiti(path.resolve(process.cwd(), 'src/lib/brand-onboarding.ts'))
const { normaliseBaseUrl } = jiti(path.resolve(process.cwd(), 'src/lib/brand-watch.ts'))

const admin = createAdminClient()

async function addOne(b) {
  const base = normaliseBaseUrl(b.url)
  if (!base) return { ...b, error: 'bad url' }
  if (dryRun) {
    const { data } = await admin.from('watched_brand').select('watched_brand_id, name, auto_keep_confidence, confidence_bar').eq('base_url', base).maybeSingle()
    return { ...b, id: data?.watched_brand_id, existing: !!data, note: data ? `already watched as ${data.name} (auto-add ${data.auto_keep_confidence ? `on at ${data.confidence_bar}` : 'off'})` : 'would add + scan' }
  }
  const r = await createWatchedBrandAndScan(admin, base, 'watch')
  if (r.error && !r.watchedBrandId) return { ...b, error: r.error }
  const id = r.watchedBrandId
  const existing = r.error === 'Already on the watchlist'
  // A row that is on the list but was never checked (an add that died before
  // its scan, as the first run of this script did) is scanned now.
  const { data: row0 } = existing ? await admin.from('watched_brand').select('*').eq('watched_brand_id', id).single() : { data: null }
  const neverScanned = !!row0 && row0.last_checked_at == null
  if (!existing || neverScanned) {
    if (neverScanned) {
      try { await scanNewBrand(admin, row0, 'watch') } catch (e) {
        await admin.from('watched_brand').update({ scan_state: { running: false, error: e instanceof Error ? e.message : String(e) } }).eq('watched_brand_id', id)
      }
    }
    // The scan runs behind waitUntil; wait for it so the row is settled before
    // the switch is set (and so the script does not exit mid-scan).
    await flush()
    // A provisional name from the URL is replaced by the real one after a scan;
    // if the scan could not learn it, the name she saved it under is better.
    const { data: row } = await admin.from('watched_brand').select('name, scan_state, platform').eq('watched_brand_id', id).single()
    if (row && row.name === r.name && row.name !== b.name) await admin.from('watched_brand').update({ name: b.name }).eq('watched_brand_id', id)
    const err = row?.scan_state?.error
    if (err) return { ...b, id, platform: row?.platform, note: `added, scan failed: ${err}` }
  }
  // AUTO-ADD at the bar — what the card's switch writes, and auto_keep_manual
  // because no decisions exist yet to earn the gate (enableAutoAddForBrands with
  // the brand in overriddenIds).
  const now = new Date().toISOString()
  const { error } = await admin.from('watched_brand')
    .update({ auto_keep_confidence: true, auto_keep_confidence_since: now, confidence_bar: bar, auto_keep_manual: true })
    .eq('watched_brand_id', id)
  if (error) return { ...b, id, error: `auto-add not set: ${error.message}` }
  const { data: after } = await admin.from('watched_brand').select('name, platform, last_new_count').eq('watched_brand_id', id).single()
  return { ...b, id, existing, platform: after?.platform ?? 'shopify', queued: after?.last_new_count, note: existing ? (neverScanned ? 'was on the list unscanned — scanned, auto-add on' : 'already watched — auto-add (re)set') : 'added + scanned, auto-add on' }
}

const results = []
const queue = RUN.slice()
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let b = queue.shift(); b; b = queue.shift()) {
    const started = Date.now()
    let r
    try { r = await addOne(b) } catch (e) { r = { ...b, error: e instanceof Error ? e.message : String(e) } }
    r.secs = Math.round((Date.now() - started) / 1000)
    results.push(r)
    console.log(`${r.error ? '✗' : '✓'} ${r.name.padEnd(22)} ${r.error ?? r.note}${r.queued != null ? ` · ${r.queued} queued` : ''}${r.platform ? ` · ${r.platform}` : ''} (${r.secs}s)`)
  }
}))

const ok = results.filter((r) => !r.error).length
console.log(`\n${dryRun ? 'dry run: ' : ''}${ok}/${RUN.length} brands ${dryRun ? 'checked' : `on the watchlist with AUTO-ADD at ${Math.round(bar * 100)}%`}`)
if (!dryRun) console.log('The hourly brand-watch cron sweeps every AUTO-ADD brand, so pieces already queued above the bar are added within the hour.')
process.exit(ok === RUN.length ? 0 : 1)
