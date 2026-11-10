// REPAIR — the stock sentinel had been checking pieces members OWN against the
// shop pages they were imported from, marking them unsellable, out of stock
// and (after 30 days) archived. Owned pieces are hers: put every one back.
//   node scripts/repair-owned-stock.mjs [--dry]
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^"|"$/g,'')]}))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const dry = process.argv.includes('--dry')

const { data: rows, error } = await sb.from('item')
  .select('item_id, product_name, status, status_before_oos, stock_status, stock_signal, oos_strikes')
  .eq('ownership', 'owned')
  .or('status.in.(out_of_stock,archived),stock_status.neq.in_stock,stock_signal.like.sentinel:%')
if (error) throw error
console.log(`${rows.length} owned piece(s) touched by the sentinel`)
for (const r of rows) {
  const status = r.status === 'out_of_stock' || r.status === 'archived' ? (r.status_before_oos ?? 'ready') : r.status
  const patch = { status, stock_status: 'in_stock', stock_signal: 'owned', oos_strikes: 0, oos_since: null, status_before_oos: null, next_check_at: null }
  console.log(`· ${r.product_name}: ${r.status}/${r.stock_status} → ${status}/in_stock`)
  if (!dry) {
    const { error: e } = await sb.from('item').update(patch).eq('item_id', r.item_id)
    if (e) console.error('  failed', e.message)
  }
}
// The kept outfits the sentinel retired because an OWNED piece in them looked dead.
const ids = rows.map((r) => r.item_id)
if (ids.length) {
  const { data: ways } = await sb.from('styled_way').select('styled_way_id, stale_reason').eq('stale', true).not('stale_reason', 'is', null)
  const back = (ways ?? []).filter((w) => ids.some((id) => String(w.stale_reason).endsWith(`:${id}`)))
  console.log(`${back.length} kept outfit(s) retired over an owned piece`)
  if (!dry && back.length) {
    const { error: e } = await sb.from('styled_way').update({ stale: false, stale_reason: null }).in('styled_way_id', back.map((w) => w.styled_way_id))
    if (e) console.error('  failed', e.message)
  }
}
console.log(dry ? 'dry run — nothing written' : 'done')
