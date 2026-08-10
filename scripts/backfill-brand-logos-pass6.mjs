// Pass 6 — the big houses (Dior, Alaïa, Saint Laurent, Ferragamo…) block
// scrapers, so their own sites give us nothing. Wikidata records an official
// logo (property P154) for most of them, hosted on Wikimedia Commons. Resolve
// brand name → Wikipedia article → Wikidata item → P154 → Commons file, and
// store the result in the same Supabase bucket as pass 5.
import { createClient } from '@supabase/supabase-js'

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BUCKET = 'brand-logos'
const UA = { 'User-Agent': 'MYRA-logo-backfill/1.0 (fashion catalogue; contact ccotter31@gmail.com)' }
const slug = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, 'and').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Search term overrides where the row name is a typo or too generic to search.
const SEARCH = {
  'isbael marant': 'Isabel Marant', 'isbael marrant': 'Isabel Marant',
  'manseur gavriel': 'Mansur Gavriel', 'alaia': 'Alaïa', 'alaïa': 'Alaïa',
  'ferragamo': 'Salvatore Ferragamo', 'dior': 'Christian Dior (fashion house)',
  'saint laurent': 'Yves Saint Laurent (brand)', 'la doublej': 'La DoubleJ',
  'roger vivier': 'Roger Vivier', 'furla': 'Furla', 'posse': 'Posse (brand)',
  'leem': 'Leem (brand)', 'derf': '', 'the seller': '', 'srg': '', 'unknown': '',
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' }

async function jsonGet(url) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) })
    return r.ok ? await r.json() : null
  } catch { return null }
}

async function wikidataLogo(term) {
  // Wikipedia search → the top article's Wikidata item.
  const s = await jsonGet(`https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=1&srsearch=${encodeURIComponent(term)}`)
  const title = s?.query?.search?.[0]?.title
  if (!title) return null
  // Wikipedia will happily return a near-miss ("La DoubleJ" → Ladurée). Only
  // trust the article if its title actually contains the brand name.
  const squash = (x) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
  if (!squash(title).includes(squash(term.replace(/\s*\(.*\)$/, '')))) return null
  const p = await jsonGet(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&titles=${encodeURIComponent(title)}`)
  const pages = p?.query?.pages ?? {}
  const qid = Object.values(pages)[0]?.pageprops?.wikibase_item
  if (!qid) return null

  const wd = await jsonGet(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`)
  const claims = wd?.entities?.[qid]?.claims ?? {}
  // ONLY P154 (logo image) and P8972 (small logo). P18 is "image of the
  // subject", which for a fashion house is a photo of the founder — shipping
  // one of those as a brand mark is worse than showing no logo at all.
  const file = claims.P154?.[0]?.mainsnak?.datavalue?.value
    ?? claims.P8972?.[0]?.mainsnak?.datavalue?.value
  if (!file || !/logo/i.test(file)) return null
  return { file, title }
}

async function fetchCommons(file) {
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=600`
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) })
    if (!r.ok) return null
    const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!/^image\//.test(ct)) return null
    return { buf: Buffer.from(await r.arrayBuffer()), ct }
  } catch { return null }
}

const { data: brands } = await supa.from('brand').select('brand_id, name').is('logo_url', null).order('name')

let fixed = 0
const skipped = [], failed = []
for (const b of brands) {
  const { count } = await supa.from('item').select('*', { count: 'exact', head: true }).eq('brand_id', b.brand_id)
  if (!count) { skipped.push(`${b.name} (no items)`); continue }

  const key = b.name.trim().toLowerCase()
  const term = key in SEARCH ? SEARCH[key] : b.name
  if (!term) { skipped.push(`${b.name} (not a real brand name)`); continue }

  const hit = await wikidataLogo(term)
  if (!hit) { failed.push(`${b.name} — no Wikidata logo`); continue }
  const img = await fetchCommons(hit.file)
  if (!img) { failed.push(`${b.name} — Commons fetch failed (${hit.file})`); continue }

  const path = `${slug(b.name)}.${EXT[img.ct] ?? 'png'}`
  const { error } = await supa.storage.from(BUCKET).upload(path, img.buf, { contentType: img.ct, upsert: true })
  if (error) { failed.push(`${b.name} — upload: ${error.message}`); continue }
  const url = supa.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  await supa.from('brand').update({ logo_url: url }).eq('brand_id', b.brand_id)
  fixed++
  console.log('✓', b.name, '←', hit.title, '/', hit.file)
}

const { data: all } = await supa.from('brand').select('logo_url')
console.log(`\nFIXED ${fixed}. Coverage: ${all.filter(x => x.logo_url).length}/${all.length}`)
console.log(`\nSKIPPED (${skipped.length}):\n  ${skipped.join('\n  ')}`)
console.log(`\nFAILED (${failed.length}):\n  ${failed.join('\n  ')}`)
