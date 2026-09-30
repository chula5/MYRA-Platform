// COMPUTE A PERSONA'S ENVELOPE FROM ITS CONFIRMED MOODBOARD.
//
// The admin pipeline (inspiration-actions.recomputeEnvelope) does this when
// images are confirmed through the review grid — but a persona whose images
// were confirmed before that pipeline existed (Chloe: 108 confirmed images,
// no envelope) never gets recomputed, because confirming is what triggers it.
// This is the backfill: the same maths, the same write, no admin session.
//
//   node scripts/compute-persona-envelope.mjs chloe
//   node scripts/compute-persona-envelope.mjs chloe mila ralph-lauren
//
// Only CONFIRMED, persona-level images count (user_id null): a client's own
// reference pictures shape HER looks, never the style everyone inherits.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

// The maths must be the app's own — the alias the app builds with, wired into
// jiti by hand because the repo's jiti (v1) reads no tsconfig paths.
const require = createRequire(import.meta.url)
const jiti = require('jiti')(fileURLToPath(import.meta.url), {
  alias: { '@': path.resolve(process.cwd(), 'src') },
})
const {
  computeEnvelope,
  envelopeToRange,
  proposeRulesFromEnvelope,
  occasionProfile,
  sampleLooks,
  definingDimensions,
  NARRATED_DIMS,
  MIN_CONFIRMED_IMAGES,
} = jiti(path.resolve(process.cwd(), 'src/lib/inspiration.ts'))

function readEnv() {
  const out = {}
  const file = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env0 = readEnv()
const db = createClient(env0.NEXT_PUBLIC_SUPABASE_URL, env0.SUPABASE_SERVICE_ROLE_KEY)

const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!slugs.length) {
  console.error('usage: node scripts/compute-persona-envelope.mjs <slug> [slug…]')
  process.exit(1)
}

for (const slug of slugs) {
  const { data: stylist, error: sErr } = await db
    .from('stylist').select('stylist_id, name, slug, status, constitution').eq('slug', slug).single()
  if (sErr || !stylist) { console.error(`\n${slug}: no stylist with that slug`); continue }

  const { data: rows, error } = await db
    .from('inspiration_image')
    .select('vector, scores, occasion_read')
    .eq('persona_id', stylist.stylist_id)
    .eq('status', 'confirmed')
    .is('user_id', null)
  if (error) { console.error(`\n${slug}: ${error.message}`); continue }

  const vectors = (rows ?? []).map((r) => r.vector).filter((v) => Array.isArray(v))
  const env = computeEnvelope(vectors, 1)
  if (!env) {
    console.log(`\n${stylist.name}: ${(rows ?? []).length} confirmed images but no vectors — envelope impossible`)
    continue
  }

  const itemTypeCounts = {}
  for (const r of rows ?? []) {
    for (const t of r.scores?.item_types ?? []) itemTypeCounts[t] = (itemTypeCounts[t] ?? 0) + 1
  }
  const occasions = occasionProfile((rows ?? []).map((r) => r.occasion_read ?? []))
  const looks = sampleLooks(vectors)
  const range = envelopeToRange(env)
  const proposed = proposeRulesFromEnvelope(env, itemTypeCounts)

  const { error: upErr } = await db.from('stylist').update({
    envelope: { ...env, looks, item_types: itemTypeCounts, occasions },
    envelope_computed_at: new Date().toISOString(),
    envelope_status: 'current',
    vector_range: range,
    centroid: env.mean,
    // A hand-written constitution is never overwritten.
    constitution: stylist.constitution ?? proposed,
    updated_at: new Date().toISOString(),
  }).eq('stylist_id', stylist.stylist_id)
  if (upErr) { console.error(`\n${stylist.name}: update failed — ${upErr.message}`); continue }

  console.log(`\n${stylist.name} (${slug}) — envelope computed`)
  console.log(`  confirmed images: ${env.n}${env.n < MIN_CONFIRMED_IMAGES ? `  (below the go-live bar of ${MIN_CONFIRMED_IMAGES})` : ''}`)
  console.log(`  looks kept whole: ${looks.length}`)
  console.log(`  tightness: ${env.tightness} — ${env.tightness < 0.12 ? 'narrow' : env.tightness < 0.2 ? 'defined, with room' : 'broad — the moodboard may mix more than one lens'}`)
  console.log(`  constitution: ${stylist.constitution ? 'kept the existing one' : 'scaffolded from the envelope (draft — edit + confirm in /admin/stylists)'}`)
  for (const d of definingDimensions(env, NARRATED_DIMS, 4)) {
    console.log(`  ${String(d.label).padEnd(20)} ${d.reading}  (mean ${d.mean}, spread ${d.spread})`)
  }
}
