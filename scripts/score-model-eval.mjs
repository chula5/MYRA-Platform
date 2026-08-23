// Can the cheap model score items? Compare Haiku / Sonnet / Opus against
// items already scored in the library, dimension by dimension.
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

const src = fs.readFileSync('src/app/admin/items/analyse-image.ts', 'utf8')
const PROMPT = src.slice(src.indexOf('const PROMPT = `') + 16, src.indexOf('}`') + 1)

const DIMS = ['fit','length','rise','structure','shoulder','waist_definition','leg_opening','surface','colour_depth','pattern','sheen','material_weight','material_formality']
const CATS = ['item_type','colour_family','material_category']
const MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6']

const { data: items } = await db.from('item')
  .select('item_id, product_name, image_url, item_type, colour_family, material_category, ' + DIMS.join(', '))
  .not('structure', 'is', null).not('image_url', 'is', null).limit(400)
const sample = items.filter((i) => i.image_url?.startsWith('http')).slice(0, 25)
console.log(`${sample.length} already-scored items as the yardstick\n`)

async function score(model, imageUrl) {
  const cap = imageUrl.includes('res.cloudinary.com') && !/\/upload\/[^/]*[wqf]_/.test(imageUrl)
    ? imageUrl.replace('/upload/', '/upload/w_1200,q_auto,f_jpg/') : imageUrl
  const r = await fetch(cap); if (!r.ok) return null
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.byteLength > 4.5 * 1024 * 1024) return null
  const ct = r.headers.get('content-type') || 'image/jpeg'
  const media = ['image/jpeg','image/png','image/gif','image/webp'].find((t) => ct.includes(t)) ?? 'image/jpeg'
  const res = await client.messages.create({
    model, max_tokens: 1024,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } },
      { type: 'text', text: PROMPT }] }],
  })
  const text = res.content.find((b) => b.type === 'text')?.text ?? ''
  const json = text.replace(/^```[a-z]*\n?/, '').match(/\{[\s\S]*\}/)?.[0]
  const usage = res.usage
  try { return { data: JSON.parse(json), usage } } catch { return null }
}

const stats = {}
for (const m of MODELS) stats[m] = { n: 0, diffs: {}, cats: {}, nulls: 0, inTok: 0, outTok: 0, fails: 0 }
for (const [i, it] of sample.entries()) {
  const reads = await Promise.all(MODELS.map((m) => score(m, it.image_url).catch(() => null)))
  reads.forEach((r, k) => {
    const m = MODELS[k], s = stats[m]
    if (!r) { s.fails++; return }
    s.n++; s.inTok += r.usage.input_tokens; s.outTok += r.usage.output_tokens
    for (const d of DIMS) {
      const truth = it[d], got = r.data[d]
      if (truth == null) continue
      if (got == null) { s.nulls++; continue }
      ;(s.diffs[d] ??= []).push(Math.abs(Number(got) - Number(truth)))
    }
    for (const c of CATS) {
      if (it[c] == null) continue
      ;(s.cats[c] ??= { hit: 0, tot: 0 })
      s.cats[c].tot++; if (String(r.data[c]) === String(it[c])) s.cats[c].hit++
    }
  })
  process.stdout.write(`\r  ${i + 1}/${sample.length}`)
}
console.log('\n')
const mean = (a) => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : NaN
for (const m of MODELS) {
  const s = stats[m]
  const all = Object.values(s.diffs).flat()
  console.log(`\n=== ${m}   (${s.n} scored, ${s.fails} failed, ${s.nulls} dims left null)`)
  console.log(`  mean absolute error across all 1-5 dims: ${mean(all).toFixed(2)}  |  within 1 point: ${(all.filter((d) => d <= 1).length / all.length * 100).toFixed(0)}%  |  exact: ${(all.filter((d) => d === 0).length / all.length * 100).toFixed(0)}%`)
  console.log('  per dimension MAE: ' + Object.entries(s.diffs).map(([d, a]) => `${d} ${mean(a).toFixed(1)}`).join('  '))
  console.log('  categorical exact: ' + Object.entries(s.cats).map(([c, v]) => `${c} ${(v.hit / v.tot * 100).toFixed(0)}%`).join('  '))
  console.log(`  tokens: ${s.inTok} in / ${s.outTok} out`)
}
