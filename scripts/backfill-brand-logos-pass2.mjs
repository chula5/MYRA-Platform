// Pass 2: brands the name-guess couldn't resolve. Uses the brand's OWN
// retailer URLs (from its items) to find the real domain, then tries that
// domain's apple-touch-icon / og:logo / Clearbit. Far more reliable than
// guessing a domain from the brand name.
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

const CLOUD_NAME = 'dugby2pow'
const API_KEY = '333725823491761'
const API_SECRET = process.env.CLOUDINARY_API_SECRET
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' }

const slugDash = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function fetchImage(url, minBytes = 1200) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(9000) })
    if (!r.ok) return null
    const ct = r.headers.get('content-type') ?? ''
    if (!/image/.test(ct)) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < minBytes) return null
    return { buf, ct }
  } catch { return null }
}

// Retailer domains that are marketplaces, not the brand itself.
const MARKETPLACES = /net-a-porter|mytheresa|farfetch|ssense|matchesfashion|selfridges|liberty|nordstrom|revolve|shopbop|theoutnet|harrods|browns|moda|zalando|amazon|lyst|vestiaire/i

async function domainsForBrand(brandId) {
  const { data } = await supa.from('item').select('retailer_url').eq('brand_id', brandId).not('retailer_url', 'is', null).limit(30)
  const doms = new Set()
  for (const r of data ?? []) {
    try {
      const h = new URL(r.retailer_url).hostname.replace(/^www\./, '')
      if (!MARKETPLACES.test(h)) doms.add(h)
    } catch { /* skip */ }
  }
  return [...doms]
}

async function logoFromDomain(dom) {
  for (const p of ['apple-touch-icon.png', 'apple-touch-icon-precomposed.png', 'favicon-196x196.png']) {
    const img = await fetchImage(`https://${dom}/${p}`)
    if (img) return img
  }
  // Site HTML: apple-touch-icon link or JSON-LD logo
  try {
    const r = await fetch(`https://${dom}/`, { headers: UA, signal: AbortSignal.timeout(9000) })
    if (r.ok) {
      const html = await r.text()
      const cands = []
      for (const m of html.matchAll(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/gi)) cands.push(m[1])
      for (const m of html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*apple-touch-icon[^"']*["']/gi)) cands.push(m[1])
      const ld = html.match(/"logo"\s*:\s*"(https?:[^"]+)"/i)
      if (ld?.[1]) cands.push(ld[1])
      for (let c of cands) {
        if (c.startsWith('//')) c = 'https:' + c
        else if (c.startsWith('/')) c = `https://${dom}${c}`
        else if (!c.startsWith('http')) c = `https://${dom}/${c}`
        const img = await fetchImage(c)
        if (img) return img
      }
    }
  } catch { /* fall through */ }
  return fetchImage(`https://logo.clearbit.com/${dom}?size=400`)
}

async function upload(buf, ct, name) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const folder = 'brand-logos'
  const publicId = slugDash(name)
  const sig = crypto.createHash('sha1')
    .update(`folder=${folder}&invalidate=true&overwrite=true&public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`)
    .digest('hex')
  const form = new FormData()
  form.append('file', `data:${ct};base64,${buf.toString('base64')}`)
  form.append('api_key', API_KEY); form.append('timestamp', timestamp); form.append('signature', sig)
  form.append('folder', folder); form.append('public_id', publicId)
  form.append('overwrite', 'true'); form.append('invalidate', 'true')
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: form })
  return (await res.json()).secure_url ?? null
}

const { data: brands } = await supa.from('brand').select('brand_id, name, logo_url').is('logo_url', null).order('name')
console.log(`${brands.length} brands without a logo`)

// A brand with no items at all is a stray/typo row — report, don't chase.
let fixed = 0
const stillMissing = []
for (const b of brands) {
  const doms = await domainsForBrand(b.brand_id)
  if (!doms.length) { stillMissing.push(`${b.name} (no items/urls)`); continue }
  let img = null
  for (const d of doms.slice(0, 3)) {
    img = await logoFromDomain(d)
    if (img) break
  }
  if (!img) { stillMissing.push(`${b.name} (${doms[0]})`); continue }
  const url = await upload(img.buf, img.ct, b.name)
  if (!url) { stillMissing.push(b.name); continue }
  await supa.from('brand').update({ logo_url: url }).eq('brand_id', b.brand_id)
  fixed++
  console.log('✓', b.name, '←', doms[0])
}
const { data: after } = await supa.from('brand').select('logo_url')
console.log(`\npass 2 fixed ${fixed}. Total with logos: ${after.filter(x => x.logo_url).length}/${after.length}`)
if (stillMissing.length) console.log('still missing:\n  ' + stillMissing.join('\n  '))
