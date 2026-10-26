// ADD A STYLE INFLUENCE — a person a client named, with pictures, from a file.
//
//   node scripts/add-influence.mjs scripts/influences/julianne-moore.json pic1.jpg pic2.jpg …
//   node scripts/add-influence.mjs scripts/influences/julianne-moore.json --dry-run
//
// The JSON is the person (kept in the repo as the log of who inspires whom):
//   { name, kind, handle, status, brief: { summary, signatures, silhouettes, palette, nevers }, members: ["Anne"] }
//
// The same path as /admin/influences: the person is upserted by slug (the brief
// is replaced), each picture is hosted on Cloudinary under influences/<id>,
// scored by the same vision pass, and the envelope recomputed. A picture already
// added (same bytes) is skipped, so re-running is safe. A member is linked only
// when exactly one real member has that name.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire, Module } from 'node:module'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const [personFile, ...pictures] = args.filter((a) => !a.startsWith('--'))
if (!personFile) { console.error('Usage: node scripts/add-influence.mjs <person.json> [pictures…] [--dry-run]'); process.exit(1) }
const person = JSON.parse(fs.readFileSync(personFile, 'utf8'))

const envFile = path.join(process.cwd(), '.env.local')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

// The app's own modules (see add-saved-brands.mjs): next/cache stubbed in the
// require cache, and 'server-only' — which only Next's bundler resolves —
// pointed at Next's own empty module.
const require = createRequire(import.meta.url)
const stubs = path.resolve(process.cwd(), 'scripts/stubs')
for (const [id, stub] of [['next/cache', 'next-cache.cjs']]) {
  const file = require.resolve(id)
  const m = new Module(file); m.filename = file; m.loaded = true; m.exports = require(path.join(stubs, stub))
  require.cache[file] = m
}
const emptyServerOnly = require.resolve('next/dist/compiled/server-only/empty.js')
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  return request === 'server-only' ? emptyServerOnly : resolve.call(this, request, ...rest)
}
const jiti = require('jiti')(fileURLToPath(import.meta.url), { alias: { '@': path.resolve(process.cwd(), 'src') } })
const { createAdminClient } = jiti(path.resolve(process.cwd(), 'src/lib/supabase-server.ts'))
const { uploadImageBytesToCloudinary } = jiti(path.resolve(process.cwd(), 'src/lib/cloudinary-persist.ts'))
const { scorePendingInfluenceImages } = jiti(path.resolve(process.cwd(), 'src/lib/style-influence-store.ts'))
const { parseInfluenceBrief, slugify } = jiti(path.resolve(process.cwd(), 'src/lib/style-influence.ts'))

const admin = createAdminClient()
const slug = slugify(person.name)
const brief = parseInfluenceBrief(person.brief)
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

if (dryRun) {
  const { data } = await admin.from('style_influence').select('influence_id, status').eq('slug', slug).maybeSingle()
  console.log(`${person.name} (${slug}): ${data ? `exists, ${data.status}` : 'would be created'} · ${pictures.length} picture(s) · members ${JSON.stringify(person.members ?? [])}`)
  process.exit(0)
}

// 1. The person.
const row = { name: person.name, slug, kind: person.kind ?? 'celebrity', handle: person.handle ?? null, brief, updated_at: new Date().toISOString() }
if (person.status) row.status = person.status
const { data: saved, error } = await admin.from('style_influence').upsert(row, { onConflict: 'slug' }).select('influence_id, image_url').single()
if (error) { console.error('Could not save the person:', error.message); process.exit(1) }
const id = saved.influence_id
console.log(`${person.name} → ${id}`)

// 2. The pictures, skipping bytes already added.
const { data: had } = await admin.from('style_influence_image').select('source_url').eq('influence_id', id)
const seen = new Set((had ?? []).map((r) => r.source_url))
const rows = []
for (const file of pictures) {
  const data = fs.readFileSync(file)
  const key = `upload:sha1:${crypto.createHash('sha1').update(data).digest('hex')}`
  if (seen.has(key)) { console.log(`  skip (already added) ${path.basename(file)}`); continue }
  const url = await uploadImageBytesToCloudinary(data, TYPES[path.extname(file).toLowerCase()] ?? 'image/jpeg', {
    folder: `influences/${id}`, publicId: `${slug}-${Date.now()}-${rows.length}`,
  })
  if (!url) { console.log(`  FAILED to host ${path.basename(file)}`); continue }
  rows.push({ influence_id: id, image_url: url, source_url: key, status: 'pending_scoring' })
  console.log(`  hosted ${path.basename(file)}`)
}
if (rows.length) {
  const { error: insErr } = await admin.from('style_influence_image').insert(rows)
  if (insErr) { console.error('Could not save pictures:', insErr.message); process.exit(1) }
  if (!saved.image_url) await admin.from('style_influence').update({ image_url: rows[0].image_url }).eq('influence_id', id)
  const r = await scorePendingInfluenceImages(admin, id, Math.max(40, rows.length))
  console.log(`  scored ${r.scored}, failed ${r.failed}`)
}

// 3. The clients who named them.
for (const name of person.members ?? []) {
  const { data: found } = await admin.from('pilot_member').select('member_id, name')
    .eq('is_synthetic', false).or(`name.ilike.${name},name.ilike.${name} %`)
  if ((found ?? []).length !== 1) { console.log(`  member "${name}": ${(found ?? []).length} matches — link by hand on /admin/influences`); continue }
  const { error: linkErr } = await admin.from('member_style_influence')
    .upsert({ member_id: found[0].member_id, influence_id: id, source: 'application' }, { onConflict: 'member_id,influence_id', ignoreDuplicates: true })
  console.log(linkErr ? `  member "${name}": ${linkErr.message}` : `  linked ${found[0].name}`)
}
