// Pass 3 — finish the job. For every brand still without a logo:
//   1. an explicit domain map for the well-known houses whose name != domain
//   2. the brand's own retailer URLs (its real site), incl. Shopify /cdn logos
//   3. Clearbit on any resolved domain
// Junk rows (no items at all, or obvious typos of an existing brand) are
// reported for cleanup rather than chased.
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

const CLOUD = 'dugby2pow', KEY = '333725823491761', SECRET = process.env.CLOUDINARY_API_SECRET
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' }
const slug = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Houses whose domain isn't derivable from the name.
const DOMAINS = {
  khaite: 'khaite.com', toteme: 'toteme-studio.com', 'totême': 'toteme-studio.com',
  lemaire: 'lemaire.fr', furla: 'furla.com', soeur: 'soeur.fr', bottega: 'bottegaveneta.com',
  'bottega veneta': 'bottegaveneta.com', ami: 'amiparis.com', 'ami paris': 'amiparis.com',
  'max mara': 'maxmara.com', 'max&co': 'maxandco.com', 'maxandco': 'maxandco.com',
  mytheresa: 'mytheresa.com', 'amina muaddi': 'aminamuaddi.com', dunst: 'dunst.co',
  "l'academie": 'lacademiebrand.com', 'l’academie': 'lacademiebrand.com',
  'andres otalora': 'andresotalora.com', 'anna kosturova': 'annakosturova.com',
  'ba-sh': 'ba-sh.com', 'roberto festa': 'robertofesta.it', 'cult gaia': 'cultgaia.com',
  'isabel marant': 'isabelmarant.com', 'the row': 'therow.com', jacquemus: 'jacquemus.com',
  chloe: 'chloe.com', 'chloé': 'chloe.com', 'simon miller': 'simonmillerusa.com',
  'simonmiller': 'simonmillerusa.com', posse: 'posse.com.au', tibi: 'tibi.com',
  'tory burch': 'toryburch.com', 'ulla johnson': 'ullajohnson.com', staud: 'staud.clothing',
  'sensi studio': 'sensistudio.com', 'cami nyc': 'caminyc.com', twinset: 'twinset.com',
  diesel: 'diesel.com', demellier: 'demellierlondon.com', 'da luna': 'dalunathelabel.com',
}

async function img(url, min = 1200) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(9000) })
    if (!r.ok) return null
    const ct = r.headers.get('content-type') ?? ''
    if (!/image/.test(ct)) return null
    const buf = Buffer.from(await r.arrayBuffer())
    return buf.length >= min ? { buf, ct } : null
  } catch { return null }
}

const MARKET = /net-a-porter|mytheresa|farfetch|ssense|matches|selfridges|liberty|nordstrom|revolve|shopbop|theoutnet|harrods|browns|zalando|amazon|lyst|vestiaire/i

async function fromDomain(dom) {
  for (const p of ['apple-touch-icon.png', 'apple-touch-icon-precomposed.png', 'favicon-196x196.png']) {
    const i = await img(`https://${dom}/${p}`)
    if (i) return i
  }
  try {
    const r = await fetch(`https://${dom}/`, { headers: UA, signal: AbortSignal.timeout(9000) })
    if (r.ok) {
      const html = await r.text()
      const c = []
      for (const m of html.matchAll(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/gi)) c.push(m[1])
      for (const m of html.matchAll(/"logo"\s*:\s*"(https?:[^"]+)"/gi)) c.push(m[1])
      for (const m of html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)) c.push(m[1])
      for (let u of c) {
        if (u.startsWith('//')) u = 'https:' + u
        else if (u.startsWith('/')) u = `https://${dom}${u}`
        const i = await img(u)
        if (i) return i
      }
    }
  } catch { /* ignore */ }
  return img(`https://logo.clearbit.com/${dom}?size=400`)
}

async function upload(buf, ct, name) {
  const ts = String(Math.floor(Date.now() / 1000)), folder = 'brand-logos', id = slug(name)
  const sig = crypto.createHash('sha1').update(`folder=${folder}&invalidate=true&overwrite=true&public_id=${id}&timestamp=${ts}${SECRET}`).digest('hex')
  const f = new FormData()
  f.append('file', `data:${ct};base64,${buf.toString('base64')}`)
  f.append('api_key', KEY); f.append('timestamp', ts); f.append('signature', sig)
  f.append('folder', folder); f.append('public_id', id)
  f.append('overwrite', 'true'); f.append('invalidate', 'true')
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, { method: 'POST', body: f })
  return (await r.json()).secure_url ?? null
}

const { data: brands } = await supa.from('brand').select('brand_id, name').is('logo_url', null).order('name')
console.log(`${brands.length} without logos\n`)
let fixed = 0
const empty = [], failed = []

for (const b of brands) {
  const { count } = await supa.from('item').select('*', { count: 'exact', head: true }).eq('brand_id', b.brand_id)
  if (!count) { empty.push(b.name); continue }   // stray/typo row — nothing uses it

  const doms = []
  const mapped = DOMAINS[b.name.trim().toLowerCase()]
  if (mapped) doms.push(mapped)
  const { data: items } = await supa.from('item').select('retailer_url').eq('brand_id', b.brand_id).not('retailer_url', 'is', null).limit(25)
  for (const r of items ?? []) {
    try {
      const h = new URL(r.retailer_url).hostname.replace(/^www\./, '')
      if (!MARKET.test(h) && !doms.includes(h)) doms.push(h)
    } catch { /* skip */ }
  }
  doms.push(`${slug(b.name).replace(/-/g, '')}.com`)

  let found = null
  for (const d of doms.slice(0, 4)) { found = await fromDomain(d); if (found) break }
  if (!found) { failed.push(`${b.name} (${doms[0] ?? 'no domain'})`); continue }
  const url = await upload(found.buf, found.ct, b.name)
  if (!url) { failed.push(b.name); continue }
  await supa.from('brand').update({ logo_url: url }).eq('brand_id', b.brand_id)
  fixed++
  console.log('✓', b.name)
}

const { data: all } = await supa.from('brand').select('name, logo_url')
const withL = all.filter(x => x.logo_url).length
console.log(`\nFIXED ${fixed}. Coverage: ${withL}/${all.length}`)
console.log(`\nEMPTY BRAND ROWS (no items — safe to delete/merge): ${empty.length}\n  ${empty.join('\n  ')}`)
console.log(`\nSTILL NO LOGO (has items): ${failed.length}\n  ${failed.join('\n  ')}`)
