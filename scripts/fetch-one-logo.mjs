// Fetch a single brand's logo from a page (or a direct image URL) and store it.
//   node scripts/fetch-one-logo.mjs "Isabel Marant" https://www.isabelmarant.com/
// If given a page, every asset URL mentioning "logo" is tried in turn.
import { createClient } from '@supabase/supabase-js'

const [, , brandQuery, source] = process.argv
if (!brandQuery || !source) {
  console.error('usage: fetch-one-logo.mjs "<brand name or fragment>" <page-or-image-url>')
  process.exit(1)
}

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' }
const slug = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/avif': 'avif' }

async function grab(url) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) })
    if (!r.ok) return null
    const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!/^image\//.test(ct)) return null
    const buf = Buffer.from(await r.arrayBuffer())
    return buf.length > 300 ? { buf, ct } : null
  } catch { return null }
}

let found = await grab(source)
let via = source

if (!found) {
  // Treat it as a page: collect every asset URL mentioning "logo", unescaping
  // the \/ that appears inside inlined JSON.
  const r = await fetch(source, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(20000) })
  const html = await r.text()
  const origin = new URL(source).origin
  const raw = new Set()
  for (const m of html.matchAll(/["'(]([^"'()\s]*logo[^"'()\s]*)["')]/gi)) raw.add(m[1])
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    if (/logo/i.test(m[0])) raw.add(m[1])
  }
  const urls = [...raw]
    .map((u) => u.replace(/\\\//g, '/'))
    .filter((u) => /\.(png|svg|jpe?g|webp|avif)(\?|$)/i.test(u))
    .map((u) => (u.startsWith('//') ? 'https:' + u : u.startsWith('/') ? origin + u : u))
    .filter((u) => u.startsWith('http'))
  console.log(`page gave ${urls.length} candidate asset(s)`)
  for (const u of urls.slice(0, 25)) {
    const hit = await grab(u)
    if (hit) { found = hit; via = u; break }
  }
}

if (!found) { console.error('no logo image found'); process.exit(2) }

const { data: rows } = await supa.from('brand').select('brand_id, name').ilike('name', `%${brandQuery}%`)
if (!rows?.length) { console.error('no brand matched', brandQuery); process.exit(3) }

const path = `${slug(rows[0].name)}.${EXT[found.ct] ?? 'png'}`
const { error } = await supa.storage.from('brand-logos').upload(path, found.buf, { contentType: found.ct, upsert: true })
if (error) { console.error('upload failed:', error.message); process.exit(4) }
const url = supa.storage.from('brand-logos').getPublicUrl(path).data.publicUrl

for (const b of rows) {
  await supa.from('brand').update({ logo_url: url }).eq('brand_id', b.brand_id)
  console.log('✓', b.name)
}
console.log('from', via)
console.log('→', url)
