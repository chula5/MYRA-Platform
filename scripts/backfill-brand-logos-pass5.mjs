// Pass 5 — the finishing pass, storing into SUPABASE STORAGE (public bucket
// `brand-logos`) rather than Cloudinary, since only the Supabase service key is
// available here. Existing Cloudinary logo_urls are left alone.
//
// For each brand still missing a logo:
//   1. explicit domain map for houses whose domain isn't derivable from the name
//   2. the brand's own retailer URLs (marketplaces excluded)
//   3. name-guessed domain
// then apple-touch-icon → <link>/JSON-LD logo → og:image → Clearbit.
import { createClient } from '@supabase/supabase-js'

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BUCKET = 'brand-logos'
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' }
const slug = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, 'and').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const DOMAINS = {
  khaite: 'khaite.com', toteme: 'toteme-studio.com', lemaire: 'lemaire.fr',
  furla: 'furla.com', soeur: 'soeur.fr', bottega: 'bottegaveneta.com',
  'bottega veneta': 'bottegaveneta.com', ami: 'amiparis.com', 'ami paris': 'amiparis.com',
  loewe: 'loewe.com', 'saint laurent': 'ysl.com', 'salvatore ferragamo': 'ferragamo.com',
  ferragamo: 'ferragamo.com', 'the attico': 'theattico.com', rouje: 'rouje.com',
  'magda butrym': 'magdabutrym.com', 'simone rocha': 'simonerocha.com',
  simkhai: 'simkhai.com', 'sister jane': 'sisterjane.com', 'st. agni': 'st-agni.com',
  'taller marmo': 'tallermarmo.com', 'ulla johnson': 'ullajohnson.com',
  'veronica beard': 'veronicabeard.com', 'victoria beckham': 'victoriabeckham.com',
  'vivere london': 'viverelondon.com', 'vix paula hermanny': 'vixpaulahermanny.com',
  'silvia tcherassi': 'silviatcherassi.com', 'sensi studio': 'sensistudio.com',
  'roger vivier': 'rogervivier.com', 'manolo blahnik': 'manoloblahnik.com',
  'mansur gavriel': 'mansurgavriel.com', 'manseur gavriel': 'mansurgavriel.com',
  'maria de la orden': 'mariadelaorden.com', metier: 'metier.com', 'métier': 'metier.com',
  mytheresa: 'mytheresa.com', 'la doublej': 'ladoublej.com', lanvin: 'lanvin.com',
  'le monde beryl': 'lemondeberyl.com', 'le monde béryl': 'lemondeberyl.com',
  "l'academie": 'lacademiebrand.com', 'l’academie': 'lacademiebrand.com',
  joseph: 'joseph-fashion.com', jacquemus: 'jacquemus.com', dior: 'dior.com',
  'gabriela hearst': 'gabrielahearst.com', 'isabel marant': 'isabelmarant.com',
  'christopher esber': 'christopheresber.com', 'brunello cucinelli': 'brunellocucinelli.com',
  bode: 'bode.com', 'doen': 'shopdoen.com', 'dôen': 'shopdoen.com', dunst: 'dunst.co',
  'emilia wickstead': 'emiliawickstead.com', 'farm rio': 'farmrio.com', frame: 'frame-store.com',
  'amina muaddi': 'aminamuaddi.com', 'anna kosturova': 'annakosturova.com',
  'andres otalora': 'andresotalora.com', 'ba-sh': 'ba-sh.com', 'bec + bridge': 'becandbridge.com.au',
  bobbies: 'bobbies.com', strathberry: 'strathberry.com', 'leo lin': 'leolin.com.au',
  leem: 'leem.com', 'awake mode': 'awake-mode.com', 'a.w.a.k.e mode': 'awake-mode.com',
  'a.w.a.k.e. mode': 'awake-mode.com', alaia: 'maison-alaia.com', 'alaïa': 'maison-alaia.com',
  '16 arlington': '16arlington.com', '16arlington': '16arlington.com', aeyde: 'aeyde.com',
  'sita nevado': 'sitanevado.com', posse: 'posse.com.au', 'roberto festa': 'robertofesta.it',
  'cult gaia': 'cultgaia.com', ashlyn: 'ashlynnewyork.com', arakii: 'arakii.com',
  eliou: 'eliou.com', 'éliou': 'eliou.com', freja: 'frejanyc.com', heirlome: 'heirlome.com',
  'jane taylor london': 'janetaylorlondon.com', 'awon golding millinery': 'awongolding.com',
  'jess collett milliner': 'jesscollettmilliner.com',
  'rachel trevor-morgan': 'racheltrevormorgan.com',
}

const MARKET = /net-a-porter|mytheresa|farfetch|ssense|matches|selfridges|liberty|nordstrom|revolve|shopbop|theoutnet|harrods|browns|zalando|amazon|lyst|vestiaire|wolfandbadger|harveynichols|fwrd|google\./i

async function img(url, min = 900) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!/^image\//.test(ct)) return null
    const buf = Buffer.from(await r.arrayBuffer())
    return buf.length >= min ? { buf, ct } : null
  } catch { return null }
}

async function fromDomain(dom) {
  for (const p of ['apple-touch-icon.png', 'apple-touch-icon-precomposed.png']) {
    const i = await img(`https://${dom}/${p}`)
    if (i) return i
  }
  try {
    const r = await fetch(`https://${dom}/`, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(8000) })
    if (r.ok) {
      const html = await r.text()
      const c = []
      for (const m of html.matchAll(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/gi)) c.push(m[1])
      for (const m of html.matchAll(/"logo"\s*:\s*"(https?:[^"]+)"/gi)) c.push(m[1])
      for (const m of html.matchAll(/<link[^>]+rel=["']icon["'][^>]+href=["']([^"']+\.(?:png|svg))[^"']*["']/gi)) c.push(m[1])
      for (const m of html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)) c.push(m[1])
      for (let u of c.slice(0, 8)) {
        if (u.startsWith('//')) u = 'https:' + u
        else if (u.startsWith('/')) u = `https://${dom}${u}`
        else if (!u.startsWith('http')) u = `https://${dom}/${u}`
        const i = await img(u)
        if (i) return i
      }
    }
  } catch { /* ignore */ }
  return img(`https://logo.clearbit.com/${dom}?size=400`)
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/gif': 'gif' }

async function store(buf, ct, name) {
  const path = `${slug(name)}.${EXT[ct] ?? 'png'}`
  const { error } = await supa.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: true })
  if (error) { console.log('  upload failed:', error.message); return null }
  return supa.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

const { data: brands } = await supa.from('brand').select('brand_id, name').is('logo_url', null).order('name')
console.log(`${brands.length} without logos\n`)

let fixed = 0
const empty = [], failed = []
for (const b of brands) {
  const { count } = await supa.from('item').select('*', { count: 'exact', head: true }).eq('brand_id', b.brand_id)
  if (!count) { empty.push(b.name); continue }

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
  const guess = `${slug(b.name).replace(/-/g, '')}.com`
  if (!doms.includes(guess)) doms.push(guess)

  let found = null, via = null
  for (const d of doms.slice(0, 4)) { found = await fromDomain(d); if (found) { via = d; break } }
  if (!found) { failed.push(`${b.name} — tried ${doms.slice(0, 4).join(', ')}`); continue }
  const url = await store(found.buf, found.ct, b.name)
  if (!url) { failed.push(`${b.name} — upload failed`); continue }
  await supa.from('brand').update({ logo_url: url }).eq('brand_id', b.brand_id)
  fixed++
  console.log('✓', b.name, '←', via)
}

const { data: all } = await supa.from('brand').select('logo_url')
console.log(`\nFIXED ${fixed}. Coverage: ${all.filter(x => x.logo_url).length}/${all.length}`)
console.log(`\nEMPTY ROWS, no items (${empty.length}):\n  ${empty.join('\n  ')}`)
console.log(`\nSTILL MISSING (${failed.length}):\n  ${failed.join('\n  ')}`)
