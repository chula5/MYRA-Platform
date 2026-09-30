// REMOVE OLD SEASONAL STOCK FROM THE LIVE QUEUE.
//
// Autumn/current-season rows, future dated collections (SS27, etc.), and
// unplaced rows remain queued. Older summer/winter rows become recorded
// wrong-season skips. Nothing is deleted.
//
//   node_modules/.bin/jiti scripts/retire-out-of-season-queue.ts --dry-run
//   node_modules/.bin/jiti scripts/retire-out-of-season-queue.ts

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { inCurrentSeason } from '../src/lib/season'

const env: Record<string, string> = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const dryRun = process.argv.includes('--dry-run')

async function main() {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const rows: Array<{ queue_id: string; season: 'aw' | 'ss' | 'all' | null; season_code: string | null }> = []

  for (let from = 0; ; from += 1000) {
    const { data, error } = await (db as any)
      .from('brand_watch_queue')
      .select('queue_id, season, season_code')
      .eq('status', 'queued')
      .order('queue_id')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }

  const now = new Date()
  const out = rows.filter((r) => !inCurrentSeason(r.season, r.season_code, now))
  console.log(`${dryRun ? 'DRY RUN — ' : ''}${rows.length} queued rows; ${out.length} old-season rows`)
  if (!out.length || dryRun) return

  const decidedAt = new Date().toISOString()
  for (let i = 0; i < out.length; i += 200) {
    const ids = out.slice(i, i + 200).map((r) => r.queue_id)
    let { error } = await (db as any)
      .from('brand_watch_queue')
      .update({ status: 'skipped', decided_at: decidedAt, skip_reason: 'wrong_season' })
      .in('queue_id', ids)
      .eq('status', 'queued')
    if (error && /skip_reason/.test(error.message)) {
      ;({ error } = await (db as any)
        .from('brand_watch_queue')
        .update({ status: 'skipped', decided_at: decidedAt })
        .in('queue_id', ids)
        .eq('status', 'queued'))
    }
    if (error) throw new Error(error.message)
  }
  console.log(`marked ${out.length} rows skipped for wrong season`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
