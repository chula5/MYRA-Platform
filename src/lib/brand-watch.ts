// Brand Watch — scan a Shopify storefront's full catalogue via /products.json,
// map products onto the MYRA item taxonomy, score them against the house style,
// and queue new on-taste pieces as draft items for review at /admin/brand-watch.
//
// Same scan + scoring scheme as tools/brand-scanner (the standalone scratchpad
// tool); this is the in-app version the Monday cron runs.

import { createAdminClient } from '@/lib/supabase-server'

// ---------------------------------------------------------------- types

export interface ScannedProduct {
  shopifyProductId: string
  handle: string
  title: string
  vendor: string
  productType: string
  tags: string[]
  url: string
  price: number | null
  publishedAt: string | null
  images: string[]
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock'
  sizesInStock: string[]
  // derived
  itemType: string | null
  colourFamily: string | null
  materialCategory: string | null
  materialPrimary: string | null
  score: number
  reasons: string[]
  nonFashion: boolean
}

export interface WatchedBrandRow {
  watched_brand_id: string
  brand_id: string | null
  name: string
  base_url: string
  active: boolean
  min_score: number
  last_checked_at: string | null
  last_new_count: number
}

export interface BrandCheckResult {
  name: string
  scanned: number
  newProducts: number
  queued: number
  belowScore: number
  skippedStock: number // new on-taste pieces NOT queued because low/out of stock
  restocked: number // existing library items that went out-of-stock → back in stock
  error?: string
}

// ---------------------------------------------------------------- house style

const HOUSE_STYLE = {
  weights: { colour: 3, material: 2, silhouette: 2 },
  houseColours: ['black', 'white', 'ivory', 'cream', 'ecru', 'bone', 'off white', 'off-white', 'beige', 'taupe', 'sand', 'camel', 'tan', 'caramel', 'chocolate', 'brown', 'cognac', 'grey', 'charcoal', 'navy', 'khaki', 'olive', 'burgundy', 'bordeaux', 'oxblood'],
  offColours: ['neon', 'fluo', 'lime', 'fuchsia', 'hot pink', 'bright pink', 'turquoise', 'rainbow', 'multicolour', 'multicolor', 'leopard', 'zebra', 'animal print', 'cow print', 'snake print', 'glitter', 'holographic', 'iridescent', 'metallic silver', 'metallic gold'],
  houseMaterials: ['leather', 'suede', 'calf', 'nappa', 'lambskin', 'nubuck', 'shearling', 'wool', 'cashmere', 'merino', 'mohair', 'silk', 'cotton', 'linen', 'poplin', 'denim'],
  offMaterials: ['sequin', 'diamante', 'rhinestone', 'pvc', 'vinyl', 'faux fur', 'marabou', 'feather', 'lurex', 'glitter'],
  houseSilhouettes: ['pointed', 'pointy', 'slingback', 'kitten heel', 'stiletto', 'ballet', 'ballerina', 'loafer', 'riding boot', 'knee boot', 'ankle boot', 'column', 'straight leg', 'wide leg', 'tailored', 'blazer', 'trench', 'slip dress', 'shirt dress', 'square toe', 'minimal', 'clean', 'structured', 'longline'],
  offSilhouettes: ['platform', 'flatform', 'chunky', 'wedge sneaker', 'extreme crop', 'cut-out', 'cut out', 'ruffle', 'bow embellished', 'ultra mini', 'micro mini'],
  skipCategories: ['sock', 'socks', 'hair clip', 'hair claw', 'hairband', 'scrunchie', 'kids', 'child', 'children', 'baby', 'gift card', 'giftcard', 'care kit', 'shoe care', 'cleaner', 'insole', 'laces', 'shoelace', 'protector', 'candle', 'keyring', 'key ring', 'phone case'],
  newDays: 60,
}

// ---------------------------------------------------------------- taxonomy mapping

const TYPE_RULES: Array<[RegExp, string]> = [
  [/\btrench/, 'trench'], [/\bcoat|parka|puffer/, 'coat'], [/\bblazer/, 'blazer'],
  [/\bgilet|waistcoat|\bvest\b/, 'gilet'], [/\bcape|poncho/, 'cape'],
  [/\bboot/, 'boot'], [/sneaker|trainer/, 'sneaker'], [/\bmule/, 'mule'],
  [/\bsandal|\bslide\b|flip.?flop/, 'sandal'],
  [/\bpump|stiletto|\bheel|slingback/, 'heel'],
  [/ballerina|ballet|mary.?jane|loafer|\bflat\b|\bflats\b/, 'flat'],
  [/\btote/, 'tote'], [/\bclutch|\bpouch/, 'clutch'], [/cross.?body/, 'crossbody'],
  [/shoulder bag/, 'shoulder_bag'], [/\bhandbag|\bbag\b|\bbags\b/, 'structured_bag'],
  [/shirt.?dress/, 'shirt_dress'], [/slip.?dress/, 'slip_dress'],
  [/maxi.?dress|\bgown/, 'maxi_dress'], [/mini.?dress/, 'mini_dress'],
  [/midi.?dress/, 'midi_dress'], [/\bdress/, 'midi_dress'],
  [/\bcorset/, 'corset'], [/bodysuit/, 'bodysuit'],
  [/t.?shirt|\btee\b/, 't-shirt'],
  [/knit|sweater|jumper|cardigan|pullover|turtleneck|roll.?neck/, 'knitwear'],
  [/\bblouse|camisole|\bcami\b|\btop\b|\btops\b|\btank\b/, 'blouse'], [/\bshirt/, 'shirt'],
  [/\bjeans|\bdenim\b/, 'jeans'], [/trouser|\bpants|chino|legging/, 'trousers'],
  [/\bshorts/, 'shorts'], [/\bskirt/, 'skirt'],
  [/\bjacket|bomber|anorak|windbreaker/, 'jacket'],
  [/\bbelt/, 'belt'], [/\bscarf|shawl|bandana/, 'scarf'],
  [/necklace|pendant|choker|\bchain\b/, 'necklace'], [/earring|ear cuff|\bhoop/, 'earrings'],
  [/bracelet|bangle|\bcuff\b/, 'bracelet'], [/brooch/, 'brooch'], [/\bring\b|\brings\b/, 'ring'],
  [/hair/, 'hair_accessory'], [/\bhat\b|beanie|\bcap\b|beret/, 'hat'],
  [/glove/, 'gloves'], [/sunglass|eyewear|glasses/, 'sunglasses'],
]

const COLOUR_RULES: Array<[RegExp, string]> = [
  [/\bblack|onyx|noir/, 'black'],
  [/off.?white|ivory|cream|ecru|\bbone\b|eggshell|vanilla/, 'cream'],
  [/\bwhite|\bblanc/, 'white'],
  [/charcoal|\bgrey|\bgray|slate|graphite/, 'grey'],
  [/\bnavy|midnight|marine/, 'navy'],
  [/camel|\btan\b|beige|taupe|\bsand\b|\bnude\b|caramel|biscuit|latte|stone/, 'camel'],
  [/chocolate|cognac|mocha|espresso|coffee|chestnut|walnut|\bbrown/, 'brown'],
  [/olive|khaki|sage|forest|emerald|pistachio|\bgreen/, 'green'],
  [/burgundy|bordeaux|\bwine\b|oxblood|maroon|merlot/, 'burgundy'],
  [/scarlet|crimson|cherry|\bred\b/, 'red'],
  [/cobalt|royal blue|sky blue|light blue|\bblue\b/, 'blue'],
  [/blush|\brose\b|fuchsia|\bpink/, 'pink'],
  [/mustard|butter|\bgold\b|\byellow/, 'yellow'],
  [/\brust\b|terracotta|coral|apricot|\borange/, 'orange'],
  [/lilac|lavender|violet|\bplum\b|\bpurple/, 'purple'],
  [/multi|leopard|zebra|print|striped|check/, 'multicolour'],
]

function tagValue(tags: string[], key: string): string | null {
  const k = key.toLowerCase() + ':'
  for (const t of tags) {
    if (t.toLowerCase().startsWith(k)) return t.slice(t.indexOf(':') + 1).trim()
  }
  return null
}

function mapMaterialCategory(materialStr: string | null, hay: string, itemType: string | null): string | null {
  const m = (materialStr || hay || '').toLowerCase()
  if (/leather|suede|calf|nappa|lamb\s?skin|lambskin|nubuck|shearling|goat|patent|croc/.test(m)) return 'leather_suede'
  if (/neoprene|scuba|gore|technical|ripstop|performance/.test(m)) return 'technical'
  const knit = itemType === 'knitwear' || /knit|jersey|\brib\b|ribbed/.test(m)
  const natural = /wool|cashmere|merino|mohair|alpaca|silk|cotton|linen|viscose|lyocell|tencel|modal|hemp/.test(m)
  const synthetic = /polyester|polyamide|nylon|acrylic|elastane|spandex|pvc|vinyl/.test(m)
  if (natural && synthetic) return 'mixed'
  if (natural) return knit ? 'natural_knit' : 'natural_woven'
  if (synthetic) return knit ? 'synthetic_knit' : 'synthetic_woven'
  return null
}

// ---------------------------------------------------------------- scoring

interface CompiledTerm { t: string; re: RegExp }
function compileTerms(list: string[]): CompiledTerm[] {
  return list.map((t) => ({
    t,
    re: new RegExp('\\b' + t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'),
  }))
}
const COMPILED: Array<[CompiledTerm[], CompiledTerm[], number]> = [
  [compileTerms(HOUSE_STYLE.houseColours), compileTerms(HOUSE_STYLE.offColours), HOUSE_STYLE.weights.colour],
  [compileTerms(HOUSE_STYLE.houseMaterials), compileTerms(HOUSE_STYLE.offMaterials), HOUSE_STYLE.weights.material],
  [compileTerms(HOUSE_STYLE.houseSilhouettes), compileTerms(HOUSE_STYLE.offSilhouettes), HOUSE_STYLE.weights.silhouette],
]

// ---------------------------------------------------------------- scanning

// Stock from /products.json variants (`available` boolean, size in `title` —
// no quantities). Same shape the stock sentinel and shopify sync use, but a
// single-variant piece (one-size) in stock is NOT low stock.
function stockFromVariants(variants: any[]): { stockStatus: ScannedProduct['stockStatus']; sizesInStock: string[] } {
  const vs = variants ?? []
  const available = vs.filter((v) => v?.available !== false)
  const sizesInStock = available
    .map((v) => String(v?.title ?? '').trim())
    .filter((t) => t && t.toLowerCase() !== 'default title')
  if (available.length === 0) return { stockStatus: 'out_of_stock', sizesInStock }
  if (vs.length > 2 && available.length <= 2) return { stockStatus: 'low_stock', sizesInStock }
  return { stockStatus: 'in_stock', sizesInStock }
}

function classifyAndScore(p: {
  id: unknown; handle: string; title: string; vendor: string; product_type: string
  tags: string[]; url: string; price: number | null; published_at: string | null; images: string[]
  variants: any[]
}): ScannedProduct {
  const hay = [p.product_type, p.tags.join(' '), p.title].join(' ').toLowerCase()
  const catHay = [
    tagValue(p.tags, 'category') ?? '', tagValue(p.tags, 'main category') ?? '',
    tagValue(p.tags, 'sub category') ?? '', p.product_type, p.title,
  ].join(' ').toLowerCase()

  let itemType: string | null = null
  for (const [re, t] of TYPE_RULES) { if (re.test(catHay)) { itemType = t; break } }
  if (!itemType) for (const [re, t] of TYPE_RULES) { if (re.test(hay)) { itemType = t; break } }

  const colTag = (tagValue(p.tags, 'color') ?? tagValue(p.tags, 'colour') ?? '').toLowerCase()
  let colourFamily: string | null = null
  for (const [re, c] of COLOUR_RULES) { if (colTag && re.test(colTag)) { colourFamily = c; break } }
  if (!colourFamily) for (const [re, c] of COLOUR_RULES) { if (re.test(p.title.toLowerCase())) { colourFamily = c; break } }

  const materialPrimary = tagValue(p.tags, 'material')
  const materialCategory = mapMaterialCategory(materialPrimary, hay, itemType)

  let score = 0
  const reasons: string[] = []
  for (const [pos, neg, w] of COMPILED) {
    const hp = pos.find((x) => x.re.test(hay))
    if (hp) { score += w; reasons.push(`+${w} ${hp.t}`) }
    const hn = neg.find((x) => x.re.test(hay))
    if (hn) { score -= w; reasons.push(`−${w} ${hn.t}`) }
  }

  const nonFashion = HOUSE_STYLE.skipCategories.some((s) => hay.includes(s))

  return {
    shopifyProductId: String(p.id), handle: p.handle, title: p.title, vendor: p.vendor,
    productType: p.product_type, tags: p.tags, url: p.url, price: p.price,
    publishedAt: p.published_at, images: p.images,
    ...stockFromVariants(p.variants),
    itemType, colourFamily, materialCategory, materialPrimary, score, reasons, nonFashion,
  }
}

export function normaliseBaseUrl(url: string): string | null {
  let u = (url ?? '').trim()
  if (!u) return null
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  try { return new URL(u).origin } catch { return null }
}

// Fetch the whole catalogue, 250 products a page. Throws with a readable
// message when the store isn't Shopify or the feed is blocked.
export async function fetchCatalogue(baseUrl: string): Promise<ScannedProduct[]> {
  const out: ScannedProduct[] = []
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(`${baseUrl}/products.json?limit=250&page=${page}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) MYRA-BrandWatch/1.0', Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) {
      if (page === 1) throw new Error(`${baseUrl} returned HTTP ${res.status} for /products.json — not a Shopify store, or the feed is blocked`)
      break
    }
    let batch: any[]
    try { batch = (await res.json())?.products ?? [] }
    catch {
      if (page === 1) throw new Error(`${baseUrl} answered /products.json with something that isn't JSON — not Shopify, or blocked`)
      break
    }
    for (const p of batch) {
      let price: number | null = null
      for (const v of p.variants ?? []) {
        const vp = parseFloat(v.price)
        if (!isNaN(vp) && (price === null || vp < price)) price = vp
      }
      const tags: string[] = Array.isArray(p.tags) ? p.tags : String(p.tags ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)
      out.push(classifyAndScore({
        id: p.id, handle: p.handle, title: p.title ?? '', vendor: p.vendor ?? '',
        product_type: p.product_type ?? '', tags,
        url: `${baseUrl}/products/${p.handle}`, price,
        published_at: p.published_at ?? p.created_at ?? null,
        images: (p.images ?? []).map((i: any) => i?.src).filter(Boolean).slice(0, 8),
        variants: p.variants ?? [],
      }))
    }
    if (batch.length < 250) break
  }
  if (!out.length) throw new Error(`no products found at ${baseUrl}/products.json`)
  return out
}

// ---------------------------------------------------------------- queueing

async function resolveBrandId(admin: ReturnType<typeof createAdminClient>, name: string): Promise<string> {
  const clean = name.trim()
  const { data: existing } = await admin.from('brand').select('brand_id').ilike('name', clean).limit(1)
  const row = (existing ?? [])[0] as { brand_id: string } | undefined
  if (row) return row.brand_id
  const { data: created } = await admin
    .from('brand')
    .insert([{ name: clean, price_tier: 3, era_orientation: 3, aesthetic_output: 3, cultural_legibility: 3, creative_behaviour: 3 }] as any)
    .select('brand_id')
    .single()
  return (created as any).brand_id
}

function isGbpStore(baseUrl: string): boolean {
  return /\.uk(\/|$)/.test(baseUrl) || /\.co\.uk/.test(baseUrl)
}

// Insert scanned products as draft items in the review queue. Dedupes against
// existing items by shopify_product_id, then retailer_url.
async function queueProducts(
  admin: ReturnType<typeof createAdminClient>,
  watched: WatchedBrandRow,
  products: ScannedProduct[],
): Promise<number> {
  if (!products.length) return 0
  const brandId = watched.brand_id ?? (await resolveBrandId(admin, watched.name))
  if (!watched.brand_id) {
    await (admin as any).from('watched_brand').update({ brand_id: brandId } as any).eq('watched_brand_id', watched.watched_brand_id)
  }

  // Chunked lookups (PostgREST caps a single response at 1,000 rows).
  const seenPids = new Set<string>()
  const seenUrls = new Set<string>()
  for (let i = 0; i < products.length; i += 100) {
    const chunk = products.slice(i, i + 100)
    const { data: existing } = await (admin as any)
      .from('item')
      .select('shopify_product_id, retailer_url')
      .or(
        `shopify_product_id.in.(${chunk.map((p) => p.shopifyProductId).join(',')}),` +
        `retailer_url.in.(${chunk.map((p) => `"${p.url}"`).join(',')})`,
      )
    for (const r of existing ?? []) {
      if (r.shopify_product_id != null) seenPids.add(String(r.shopify_product_id))
      if (r.retailer_url) seenUrls.add(r.retailer_url)
    }
  }

  const gbp = isGbpStore(watched.base_url)
  const rows = products
    .filter((p) => !seenPids.has(p.shopifyProductId) && !seenUrls.has(p.url))
    .map((p) => ({
      brand_id: brandId,
      item_type: p.itemType ?? 'blouse',
      product_name: p.title,
      retailer_url: p.url,
      image_url: p.images[0] ?? '',
      price: p.price != null ? String(p.price) : null,
      currency: gbp ? 'GBP' : null,
      price_gbp: gbp ? p.price : null,
      colour_family: p.colourFamily,
      material_category: p.materialCategory,
      material_primary: p.materialPrimary,
      shopify_product_id: p.shopifyProductId,
      shopify_handle: p.handle,
      stock_status: p.stockStatus,
      stock_sizes: p.sizesInStock,
      stock_checked_at: new Date().toISOString(),
      available: p.stockStatus !== 'out_of_stock',
      status: 'draft',
      source: 'retailer_api',
      in_inventory: false,
      discovery_source: 'brand_watch',
      discovery_score: p.score,
      discovered_at: new Date().toISOString(),
      admin_notes: `Brand Watch ${p.score > 0 ? '+' : ''}${p.score}${p.reasons.length ? ` (${p.reasons.join(', ')})` : ''} — score the 1–5 dimensions before READY.`,
    }))

  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await (admin as any).from('item').insert(rows.slice(i, i + 100) as any)
    if (error) throw new Error(`item insert failed: ${error.message}`)
  }
  return rows.length
}

// Forget product ids so a later check treats them as new again — used for
// on-taste pieces held back for stock, including ones seen by earlier scans.
async function unmarkSeen(
  admin: ReturnType<typeof createAdminClient>,
  watchedBrandId: string,
  ids: string[],
): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    await (admin as any)
      .from('brand_watch_seen')
      .delete()
      .eq('watched_brand_id', watchedBrandId)
      .in('shopify_product_id', ids.slice(i, i + 200))
  }
}

async function markSeen(
  admin: ReturnType<typeof createAdminClient>,
  watchedBrandId: string,
  products: ScannedProduct[],
): Promise<void> {
  const rows = products.map((p) => ({ watched_brand_id: watchedBrandId, shopify_product_id: p.shopifyProductId }))
  for (let i = 0; i < rows.length; i += 500) {
    await (admin as any)
      .from('brand_watch_seen')
      .upsert(rows.slice(i, i + 500) as any, { onConflict: 'watched_brand_id,shopify_product_id', ignoreDuplicates: true })
  }
}

// ---------------------------------------------------------------- stock refresh

// The catalogue scan carries live availability for every product, so each run
// also refreshes stock on the library items we already have for this brand
// (matched by shopify_product_id) and counts restocks: out_of_stock → back in.
// Only the stock_* fields are written — item.status transitions stay with the
// stock sentinel, which already handles oos_strikes / status_before_oos.
async function refreshBrandStock(
  admin: ReturnType<typeof createAdminClient>,
  products: ScannedProduct[],
): Promise<number> {
  const byPid = new Map(products.map((p) => [p.shopifyProductId, p]))
  const pids = Array.from(byPid.keys())
  let restocked = 0
  for (let i = 0; i < pids.length; i += 100) {
    const chunk = pids.slice(i, i + 100)
    const { data: rows } = await (admin as any)
      .from('item')
      .select('item_id, shopify_product_id, stock_status')
      .in('shopify_product_id', chunk)
    for (const r of rows ?? []) {
      const p = byPid.get(String(r.shopify_product_id))
      if (!p || r.stock_status === p.stockStatus) continue
      if (r.stock_status === 'out_of_stock' && p.stockStatus !== 'out_of_stock') restocked++
      await (admin as any)
        .from('item')
        .update({
          stock_status: p.stockStatus,
          stock_sizes: p.sizesInStock,
          stock_checked_at: new Date().toISOString(),
          available: p.stockStatus !== 'out_of_stock',
          stock_signal: 'brand_watch',
        } as any)
        .eq('item_id', r.item_id)
    }
  }
  return restocked
}

// ---------------------------------------------------------------- entry points

function isRecent(p: ScannedProduct, days: number): boolean {
  if (!p.publishedAt) return false
  return Date.now() - Date.parse(p.publishedAt) < days * 86_400_000
}

// Add a brand: scan, queue only the last 60 days of on-taste pieces (so a
// 2,000-product back catalogue doesn't land at once), mark everything seen.
export async function baselineBrand(watched: WatchedBrandRow): Promise<BrandCheckResult> {
  return scanAndQueue(watched, (p) => p.score >= watched.min_score && isRecent(p, HOUSE_STYLE.newDays))
}

// Onboard a brand: queue every on-taste piece in the catalogue regardless of
// publish date. The threshold is the brand's min_score — lower it and run
// again to pull in the next band down (already-queued pieces are deduped).
export async function onboardBrand(watched: WatchedBrandRow): Promise<BrandCheckResult> {
  return scanAndQueue(watched, (p) => p.score >= watched.min_score)
}

async function scanAndQueue(
  watched: WatchedBrandRow,
  wanted: (p: ScannedProduct) => boolean,
): Promise<BrandCheckResult> {
  const admin = createAdminClient()
  const products = await fetchCatalogue(watched.base_url)
  const fashion = products.filter((p) => !p.nonFashion)
  const onTaste = fashion.filter(wanted)
  // Low or out of stock isn't worth adding — it gets another chance on a
  // later check if it restocks (queueing only marks items, not seen state).
  const candidates = onTaste.filter((p) => p.stockStatus === 'in_stock')
  const queued = await queueProducts(admin, watched, candidates)
  const restocked = await refreshBrandStock(admin, products)
  // Stock-held on-taste pieces are NOT marked seen — and any that an earlier
  // scan already marked are unmarked — so the week they restock, the check
  // sees them as new and queues them.
  const stockHeld = new Set(
    fashion.filter((p) => p.score >= watched.min_score && p.stockStatus !== 'in_stock').map((p) => p.shopifyProductId),
  )
  await unmarkSeen(admin, watched.watched_brand_id, Array.from(stockHeld))
  await markSeen(admin, watched.watched_brand_id, products.filter((p) => !stockHeld.has(p.shopifyProductId)))
  await (admin as any)
    .from('watched_brand')
    .update({ last_checked_at: new Date().toISOString(), last_new_count: queued } as any)
    .eq('watched_brand_id', watched.watched_brand_id)
  return {
    name: watched.name, scanned: products.length, newProducts: onTaste.length,
    queued, belowScore: fashion.length - onTaste.length,
    skippedStock: stockHeld.size, restocked,
  }
}

// Weekly check: anything not in brand_watch_seen is new. On-taste new pieces
// are queued as drafts; everything is marked seen either way.
export async function checkWatchedBrand(watched: WatchedBrandRow): Promise<BrandCheckResult> {
  const admin = createAdminClient()
  const products = await fetchCatalogue(watched.base_url)

  // Page through the seen ids — PostgREST caps a single response at 1,000 rows,
  // and a full catalogue is easily double that.
  const seen = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data: seenRows } = await (admin as any)
      .from('brand_watch_seen')
      .select('shopify_product_id')
      .eq('watched_brand_id', watched.watched_brand_id)
      .order('shopify_product_id')
      .range(from, from + 999)
    for (const r of seenRows ?? []) seen.add(String(r.shopify_product_id))
    if (!seenRows || seenRows.length < 1000) break
  }

  const fresh = products.filter((p) => !seen.has(p.shopifyProductId))
  const onTaste = fresh.filter((p) => !p.nonFashion && p.score >= watched.min_score)
  // Low or out of stock isn't worth adding — and it is NOT marked seen, so a
  // later check queues it the moment it restocks. Stock-held is computed over
  // the WHOLE catalogue (not just unseen products) so pieces marked seen by
  // earlier scans are released from the seen list too.
  const candidates = onTaste.filter((p) => p.stockStatus === 'in_stock')
  const queued = await queueProducts(admin, watched, candidates)
  const restocked = await refreshBrandStock(admin, products)
  const stockHeld = new Set(
    products
      .filter((p) => !p.nonFashion && p.score >= watched.min_score && p.stockStatus !== 'in_stock')
      .map((p) => p.shopifyProductId),
  )
  await unmarkSeen(admin, watched.watched_brand_id, Array.from(stockHeld))
  await markSeen(admin, watched.watched_brand_id, products.filter((p) => !stockHeld.has(p.shopifyProductId)))
  await (admin as any)
    .from('watched_brand')
    .update({ last_checked_at: new Date().toISOString(), last_new_count: queued } as any)
    .eq('watched_brand_id', watched.watched_brand_id)

  return {
    name: watched.name, scanned: products.length, newProducts: fresh.length,
    queued, belowScore: fresh.length - onTaste.length,
    skippedStock: stockHeld.size, restocked,
  }
}

// Run the whole watchlist (the Monday cron, and RUN CHECK NOW in admin).
export async function runBrandWatch(): Promise<BrandCheckResult[]> {
  const admin = createAdminClient()
  const { data } = await (admin as any)
    .from('watched_brand')
    .select('*')
    .eq('active', true)
    .order('name')
  const results: BrandCheckResult[] = []
  for (const w of (data ?? []) as unknown as WatchedBrandRow[]) {
    try {
      results.push(await checkWatchedBrand(w))
    } catch (e) {
      results.push({ name: w.name, scanned: 0, newProducts: 0, queued: 0, belowScore: 0, skippedStock: 0, restocked: 0, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return results
}
