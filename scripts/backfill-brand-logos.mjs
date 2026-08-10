// Backfill brand.logo_url for EVERY brand:
//   1. the curated static map in src/lib/brand-logos.ts
//   2. else the brand site's apple-touch-icon / favicon via guessed domains
//   3. else Clearbit's logo API on the same domains
// Winners are persisted to Cloudinary (stable, no hotlink breakage) and the
// Cloudinary URL stored on the brand row.
//
// Run:  set -a && source .env.local && set +a && \
//       CLOUDINARY_API_SECRET=... node scripts/backfill-brand-logos.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

const CLOUD_NAME = 'dugby2pow'
const API_KEY = '333725823491761'
const API_SECRET = process.env.CLOUDINARY_API_SECRET
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' }

// Parse the curated map out of the TS file (it's JSON-shaped).
function staticMap() {
  const src = readFileSync('src/lib/brand-logos.ts', 'utf8')
  const map = {}
  for (const m of src.matchAll(/^\s*"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) {
    try { map[JSON.parse(`"${m[1]}"`)] = JSON.parse(`"${m[2]}"`) } catch { /* skip */ }
  }
  return map
}

const slug = (name) =>
  name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')
const slugDash = (name) =>
  name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function fetchImage(url, minBytes = 800) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    const ct = r.headers.get('content-type') ?? ''
    if (!/image|octet-stream/.test(ct) && !/\.(png|jpe?g|svg|webp|ico)(\?|$)/i.test(url)) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < minBytes) return null
    return { buf, ct: ct.startsWith('image') ? ct : 'image/png' }
  } catch { return null }
}

async function discover(name) {
  const s = slug(name)
  const d = slugDash(name)
  const domains = [...new Set([`${s}.com`, `${d}.com`, `${s}.co.uk`, `www.${s}.com`])]
  for (const dom of domains) {
    for (const path of ['apple-touch-icon.png', 'apple-touch-icon-precomposed.png']) {
      const img = await fetchImage(`https://${dom}/${path}`, 1500)
      if (img) return { url: `https://${dom}/${path}`, ...img }
    }
  }
  for (const dom of domains) {
    const img = await fetchImage(`https://logo.clearbit.com/${dom}?size=400`, 1500)
    if (img) return { url: `https://logo.clearbit.com/${dom}?size=400`, ...img }
  }
  return null
}

async function uploadToCloudinary(buf, ct, name) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const folder = 'brand-logos'
  const publicId = slugDash(name)
  const paramsToSign = `folder=${folder}&invalidate=true&overwrite=true&public_id=${publicId}&timestamp=${timestamp}`
  const signature = crypto.createHash('sha1').update(paramsToSign + API_SECRET).digest('hex')
  const form = new FormData()
  form.append('file', `data:${ct};base64,${buf.toString('base64')}`)
  form.append('api_key', API_KEY); form.append('timestamp', timestamp); form.append('signature', signature)
  form.append('folder', folder); form.append('public_id', publicId)
  form.append('overwrite', 'true'); form.append('invalidate', 'true')
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: form })
  const data = await res.json()
  return data.secure_url ?? null
}

const onlyMissing = process.argv.includes('--missing-only')
const { data: brands, error } = await supa.from('brand').select('brand_id, name, logo_url').order('name')
if (error) {
  console.error('✕', error.message, '\nRun migration 0024_brand_logos.sql first (adds brand.logo_url).')
  process.exit(1)
}
const map = staticMap()
let done = 0
const missing = []
for (const b of brands) {
  if (onlyMissing && b.logo_url) { done++; continue }
  const curated = map[b.name.trim().toLowerCase()]
  let img = curated ? await fetchImage(curated, 400) : null
  let source = img ? 'curated' : null
  if (!img) {
    const found = await discover(b.name)
    if (found) { img = found; source = 'discovered' }
  }
  if (!img) { missing.push(b.name); continue }
  const url = await uploadToCloudinary(img.buf, img.ct, b.name)
  if (!url) { missing.push(b.name); continue }
  const { error: upErr } = await supa.from('brand').update({ logo_url: url }).eq('brand_id', b.brand_id)
  if (upErr) { missing.push(b.name); continue }
  done++
  console.log('✓', b.name, `(${source})`)
}
console.log(`\n${done}/${brands.length} brands have logos.`)
if (missing.length) console.log('No logo found for:', missing.join(', '))
