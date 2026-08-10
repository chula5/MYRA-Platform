// Pass 7 — targeted. The generic passes look for an apple-touch-icon or a
// declared og:logo; these houses publish neither, but they all render a
// wordmark <img> in the site header. Parse the homepage for an <img> whose
// src/alt/class mentions "logo" and take that.
//
// Only brands that actually carry stock are worth this effort, so the list is
// hand-picked by item count.
import { createClient } from '@supabase/supabase-js'

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BUCKET = 'brand-logos'
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Accept-Language': 'en-GB,en;q=0.9' }
const slug = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, 'and').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const TARGETS = {
  'isabel marant': 'isabelmarant.com', 'isbael marant': 'isabelmarant.com',
  'cult gaia': 'cultgaia.com', 'posse': 'posse.com.au',
  'le monde béryl': 'lemondeberyl.com', 'le monde béryl.': 'lemondeberyl.com',
  'vivere london': 'viverelondon.com', 'jacquemus': 'jacquemus.com',
  'saint laurent': 'ysl.com', 'sensi studio': 'sensistudio.com',
  'the attico': 'theattico.com', 'la doublej': 'ladoublej.com',
  'mansur gavriel': 'mansurgavriel.com', 'manseur gavriel': 'mansurgavriel.com',
  'a.p.c': 'apc.fr', 'joseph': 'joseph-fashion.com',
  'manolo blahnik': 'manoloblahnik.com', 'roger vivier': 'rogervivier.com',
  'strathberry': 'strathberry.com', 'arakii': 'arakii.com',
  'leo lin': 'leolin.com.au', 'ashlyn': 'ashlynnewyork.com',
  'sita nevado': 'sitanevado.com', 'brunello cucinelli': 'brunellocucinelli.com',
  'ferragamo': 'ferragamo.com', 'salvatore ferragamo': 'ferragamo.com',
  'dunst': 'dunst.co', 'leem': 'leem.com', 'andres otalora': 'andresotalora.com',
  'anna kosturova': 'annakosturova.com', 'roberto festa': 'robertofesta.it',
  'jess collett milliner': 'jesscollettmilliner.com',
  'rachel trevor-morgan': 'racheltrevormorgan.com',
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/avif': 'avif' }

async function grabImage(url) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(12000) })
    if (!r.ok) return null
    const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!/^image\//.test(ct)) return null
    const buf = Buffer.from(await r.arrayBuffer())
    // Header logos are small; anything huge is a hero/campaign image.
    return buf.length >= 400 && buf.length <= 900_000 ? { buf, ct } : null
  } catch { return null }
}

// Pull candidate logo URLs out of the homepage markup, best guesses first.
function candidates(html, dom) {
  const out = []
  const push = (u) => {
    if (!u) return
    u = u.trim().split(/\s+/)[0]                    // srcset → first URL
    if (/^data:/.test(u)) return
    if (u.startsWith('//')) u = 'https:' + u
    else if (u.startsWith('/')) u = `https://${dom}${u}`
    else if (!u.startsWith('http')) u = `https://${dom}/${u}`
    if (!out.includes(u)) out.push(u)
  }
  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0]
    if (!/logo/i.test(tag)) continue
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]
    const ss = tag.match(/\bsrcset=["']([^"']+)["']/i)?.[1]
    const ds = tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1]
    push(src); push(ds); push(ss)
  }
  // Shopify themes commonly serve the header mark from /cdn/shop/files/…logo…
  for (const m of html.matchAll(/["'](\/cdn\/shop\/files\/[^"']*logo[^"']*)["']/gi)) push(m[1])
  return out.slice(0, 10)
}

const { data: brands } = await supa.from('brand').select('brand_id, name').is('logo_url', null).order('name')

let fixed = 0
const failed = []
for (const b of brands) {
  const dom = TARGETS[b.name.trim().toLowerCase()]
  if (!dom) continue

  let html = ''
  try {
    const r = await fetch(`https://${dom}/`, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) })
    if (r.ok) html = await r.text()
  } catch { /* fall through */ }
  if (!html) { failed.push(`${b.name} — ${dom} unreachable`); continue }

  let img = null, via = null
  for (const u of candidates(html, dom)) {
    img = await grabImage(u)
    if (img) { via = u; break }
  }
  if (!img) { failed.push(`${b.name} — no header logo found on ${dom}`); continue }

  const path = `${slug(b.name)}.${EXT[img.ct] ?? 'png'}`
  const { error } = await supa.storage.from(BUCKET).upload(path, img.buf, { contentType: img.ct, upsert: true })
  if (error) { failed.push(`${b.name} — upload: ${error.message}`); continue }
  const url = supa.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  await supa.from('brand').update({ logo_url: url }).eq('brand_id', b.brand_id)
  fixed++
  console.log('✓', b.name, '←', via.slice(0, 100))
}

const { data: all } = await supa.from('brand').select('logo_url')
console.log(`\nFIXED ${fixed}. Coverage: ${all.filter(x => x.logo_url).length}/${all.length}`)
console.log(`\nFAILED (${failed.length}):\n  ${failed.join('\n  ')}`)
