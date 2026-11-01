// ADD AN EVENT FOR A CLIENT — with what she wants, what she doesn't, and pictures.
//
//   node scripts/add-event.mjs scripts/events/<file>.json love1.jpg love2.jpg … [--not not1.jpg …] [--dry-run] [--rescore]
//
// --rescore reads every picture already on the event again (look + colours).
//
// The JSON is the event (kept in the repo as the log):
//   { member, label, event_date ("2028-06" or "2028-06-14"), brief, nevers, max_price_gbp, never_brands: [] }
//
// The same path as the Events room: the event is a pilot_known_event, found by
// member + label (so re-running updates it), and each picture goes through
// addEventPicture — hosted, scored, colour-read. The same picture twice is
// skipped. Pictures after --not are "not like this". Needs migration 0111.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire, Module } from 'node:module'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const rescore = args.includes('--rescore')
const rest = args.filter((a) => a !== '--dry-run' && a !== '--rescore')
const notAt = rest.indexOf('--not')
const [eventFile, ...loves] = notAt >= 0 ? rest.slice(0, notAt) : rest
const nots = notAt >= 0 ? rest.slice(notAt + 1) : []
if (!eventFile) { console.error('Usage: node scripts/add-event.mjs <event.json> [pictures…] [--not pictures…] [--dry-run]'); process.exit(1) }
const ev = JSON.parse(fs.readFileSync(eventFile, 'utf8'))

const envFile = path.join(process.cwd(), '.env.local')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

// The app's own modules, as add-influence.mjs loads them.
const require = createRequire(import.meta.url)
const stubs = path.resolve(process.cwd(), 'scripts/stubs')
for (const [id, stub] of [['next/cache', 'next-cache.cjs']]) {
  const file = require.resolve(id)
  const m = new Module(file); m.filename = file; m.loaded = true; m.exports = require(path.join(stubs, stub))
  require.cache[file] = m
}
const emptyServerOnly = require.resolve('next/dist/compiled/server-only/empty.js')
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...r) {
  return request === 'server-only' ? emptyServerOnly : resolve.call(this, request, ...r)
}
const jiti = require('jiti')(fileURLToPath(import.meta.url), { alias: { '@': path.resolve(process.cwd(), 'src') } })
const { createAdminClient } = jiti(path.resolve(process.cwd(), 'src/lib/supabase-server.ts'))
const { addEventPicture, scoreEventPicture } = jiti(path.resolve(process.cwd(), 'src/lib/events/inspiration.ts'))
const { setKnownEventNevers, setKnownEventBrief } = jiti(path.resolve(process.cwd(), 'src/lib/events/picks.ts'))

const admin = createAdminClient()
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

const { data: found } = await admin.from('pilot_member').select('member_id, name')
  .eq('is_synthetic', false).or(`name.ilike.${ev.member},name.ilike.${ev.member} %`)
if ((found ?? []).length !== 1) { console.error(`member "${ev.member}": ${(found ?? []).length} matches`); process.exit(1) }
const member = found[0]

const { data: had } = await admin.from('pilot_known_event').select('event_id').eq('member_id', member.member_id).ilike('label', ev.label).maybeSingle()
if (dryRun) {
  console.log(`${member.name}: "${ev.label}" ${ev.event_date} — ${had ? 'exists, would update' : 'would be created'} · ${loves.length} love, ${nots.length} not`)
  process.exit(0)
}

let eventId = had?.event_id
if (eventId) {
  await admin.from('pilot_known_event').update({ event_date: ev.event_date }).eq('event_id', eventId)
} else {
  const { data, error } = await admin.from('pilot_known_event').insert({ member_id: member.member_id, label: ev.label, event_date: ev.event_date }).select('event_id').single()
  if (error) { console.error('Could not add the event:', error.message); process.exit(1) }
  eventId = data.event_id
}
console.log(`${member.name}: ${ev.label} (${ev.event_date}) → ${eventId}`)

if (ev.brief) { const r = await setKnownEventBrief(admin, member.member_id, eventId, ev.brief); console.log(r.error ? `  brief: ${r.error}` : '  brief saved') }
if (ev.nevers || ev.max_price_gbp || ev.never_brands?.length) {
  const r = await setKnownEventNevers(admin, member.member_id, eventId, ev)
  console.log(r.error ? `  nevers: ${r.error}` : '  nevers saved')
}

for (const [kind, files] of [['love', loves], ['not', nots]]) {
  for (const file of files) {
    const data = fs.readFileSync(file)
    const r = await addEventPicture(admin, member.member_id, eventId, { data, contentType: TYPES[path.extname(file).toLowerCase()] ?? 'image/jpeg' }, kind)
    console.log(`  ${kind} ${path.basename(file)}: ${r.error ?? `${r.picture.status} ${JSON.stringify(r.picture.colours)}`}`)
  }
}

if (rescore) {
  const { data: pics } = await admin.from('event_inspiration_image').select('image_id, image_url, kind').eq('known_event_id', eventId).order('created_at')
  for (const p of pics ?? []) {
    await scoreEventPicture(admin, p.image_id, p.image_url)
    const { data: r } = await admin.from('event_inspiration_image').select('status, colours').eq('image_id', p.image_id).single()
    console.log(`  rescored ${p.kind} ${p.image_id.slice(0, 8)}: ${r.status} ${JSON.stringify(r.colours)}`)
  }
}
