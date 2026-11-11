import { retailOnly } from '@/lib/wardrobe/owned-items'
import { createAdminClient } from '@/lib/supabase-server'
import { COLOUR, MATERIAL, STOPWORDS, TYPE, fuzzyGet, hasMaterial, isTypoOf } from '@/lib/search-taxonomy'
import type { Brand, Item, AdminProject, Outfit, OutfitWithItems, Lookbook } from '@/types/database'

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getAdminStats(): Promise<{
  totalItems: number
  draftItems: number
  readyItems: number
  liveItems: number
  outOfStockItems: number
  lowStockItems: number
  totalOutfits: number
  draftOutfits: number
  liveOutfits: number
  totalProjects: number
  draftProjects: number
  liveProjects: number
  publishedToday: number
}> {
  const supabase = createAdminClient()

  try {
    const [
      { count: totalItems },
      { count: draftItems },
      { count: readyItems },
      { count: liveItems },
      { count: outOfStockItems },
      { count: lowStockItems },
      { count: totalOutfits },
      { count: draftOutfits },
      { count: liveOutfits },
      { count: totalProjects },
      { count: draftProjects },
      { count: liveProjects },
      { count: publishedToday },
    ] = await Promise.all([
      supabase.from('item').select('*', { count: 'exact', head: true }),
      supabase.from('item').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
      supabase.from('item').select('*', { count: 'exact', head: true }).eq('status', 'ready'),
      supabase.from('item').select('*', { count: 'exact', head: true }).eq('status', 'live'),
      supabase.from('item').select('*', { count: 'exact', head: true }).eq('stock_status', 'out_of_stock'),
      supabase.from('item').select('*', { count: 'exact', head: true }).eq('stock_status', 'low_stock'),
      supabase.from('outfit').select('*', { count: 'exact', head: true }),
      supabase.from('outfit').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
      supabase.from('outfit').select('*', { count: 'exact', head: true }).eq('status', 'live'),
      supabase.from('admin_project').select('*', { count: 'exact', head: true }),
      supabase.from('admin_project').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
      supabase.from('admin_project').select('*', { count: 'exact', head: true }).eq('status', 'live'),
      supabase
        .from('outfit')
        .select('*', { count: 'exact', head: true })
        .gte('published_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    ])

    return {
      totalItems: totalItems ?? 0,
      draftItems: draftItems ?? 0,
      readyItems: readyItems ?? 0,
      liveItems: liveItems ?? 0,
      outOfStockItems: outOfStockItems ?? 0,
      lowStockItems: lowStockItems ?? 0,
      totalOutfits: totalOutfits ?? 0,
      draftOutfits: draftOutfits ?? 0,
      liveOutfits: liveOutfits ?? 0,
      totalProjects: totalProjects ?? 0,
      draftProjects: draftProjects ?? 0,
      liveProjects: liveProjects ?? 0,
      publishedToday: publishedToday ?? 0,
    }
  } catch (err) {
    console.error('[getAdminStats]', err)
    return {
      totalItems: 0, draftItems: 0, readyItems: 0, liveItems: 0,
      outOfStockItems: 0, lowStockItems: 0,
      totalOutfits: 0, draftOutfits: 0, liveOutfits: 0,
      totalProjects: 0, draftProjects: 0, liveProjects: 0,
      publishedToday: 0,
    }
  }
}

// ── Taste insights ───────────────────────────────────────────────────────────

export interface TasteInsights {
  totalLogs: number
  uniqueBrands: number
  topBrands: { name: string; count: number; priceTier: number | null }[]
  topItemTypes: { type: string; count: number }[]
  topColourFamilies: { family: string; count: number }[]
  topMaterialCategories: { category: string; count: number }[]
  priceTierDistribution: { tier: number; count: number }[]
  avgScores: {
    fit: number | null
    length: number | null
    structure: number | null
    surface: number | null
    colour_depth: number | null
    pattern: number | null
    sheen: number | null
    material_weight: number | null
    material_formality: number | null
  }
  recent: {
    log_id: string
    item_id: string
    event_type: string
    brand_name: string | null
    item_type: string | null
    colour_family: string | null
    logged_at: string
  }[]
}

export async function getTasteInsights(): Promise<TasteInsights> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('taste_log')
      .select('*')
      .order('logged_at', { ascending: false })
    if (error) throw error
    const rows = (data ?? []) as Array<{
      log_id: string
      item_id: string
      event_type: string
      brand_id: string | null
      brand_name: string | null
      brand_price_tier: number | null
      item_type: string | null
      colour_family: string | null
      material_category: string | null
      fit: number | null
      length: number | null
      structure: number | null
      surface: number | null
      colour_depth: number | null
      pattern: number | null
      sheen: number | null
      material_weight: number | null
      material_formality: number | null
      logged_at: string
    }>

    const brandCounts = new Map<string, { count: number; priceTier: number | null }>()
    const itemTypeCounts = new Map<string, number>()
    const colourCounts = new Map<string, number>()
    const materialCounts = new Map<string, number>()
    const tierCounts = new Map<number, number>()
    const sums = {
      fit: 0, length: 0, structure: 0, surface: 0, colour_depth: 0,
      pattern: 0, sheen: 0, material_weight: 0, material_formality: 0,
    }
    const counts = { ...sums }

    for (const r of rows) {
      if (r.brand_name) {
        const existing = brandCounts.get(r.brand_name)
        brandCounts.set(r.brand_name, {
          count: (existing?.count ?? 0) + 1,
          priceTier: existing?.priceTier ?? r.brand_price_tier,
        })
      }
      if (r.item_type) itemTypeCounts.set(r.item_type, (itemTypeCounts.get(r.item_type) ?? 0) + 1)
      if (r.colour_family) colourCounts.set(r.colour_family, (colourCounts.get(r.colour_family) ?? 0) + 1)
      if (r.material_category) materialCounts.set(r.material_category, (materialCounts.get(r.material_category) ?? 0) + 1)
      if (r.brand_price_tier != null) tierCounts.set(r.brand_price_tier, (tierCounts.get(r.brand_price_tier) ?? 0) + 1)

      for (const key of Object.keys(sums) as (keyof typeof sums)[]) {
        const v = r[key]
        if (typeof v === 'number') {
          sums[key] += v
          counts[key]++
        }
      }
    }

    const avg = (key: keyof typeof sums) =>
      counts[key] > 0 ? Number((sums[key] / counts[key]).toFixed(2)) : null

    const topBrands = Array.from(brandCounts.entries())
      .map(([name, v]) => ({ name, count: v.count, priceTier: v.priceTier }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const topEntries = (m: Map<string, number>, limit = 10) =>
      Array.from(m.entries()).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v).slice(0, limit)

    const recent = rows.slice(0, 15).map((r) => ({
      log_id: r.log_id,
      item_id: r.item_id,
      event_type: r.event_type,
      brand_name: r.brand_name,
      item_type: r.item_type,
      colour_family: r.colour_family,
      logged_at: r.logged_at,
    }))

    return {
      totalLogs: rows.length,
      uniqueBrands: brandCounts.size,
      topBrands,
      topItemTypes: topEntries(itemTypeCounts).map((e) => ({ type: e.k, count: e.v })),
      topColourFamilies: topEntries(colourCounts).map((e) => ({ family: e.k, count: e.v })),
      topMaterialCategories: topEntries(materialCounts).map((e) => ({ category: e.k, count: e.v })),
      priceTierDistribution: Array.from(tierCounts.entries())
        .map(([tier, count]) => ({ tier, count }))
        .sort((a, b) => a.tier - b.tier),
      avgScores: {
        fit: avg('fit'),
        length: avg('length'),
        structure: avg('structure'),
        surface: avg('surface'),
        colour_depth: avg('colour_depth'),
        pattern: avg('pattern'),
        sheen: avg('sheen'),
        material_weight: avg('material_weight'),
        material_formality: avg('material_formality'),
      },
      recent,
    }
  } catch (err) {
    console.error('[getTasteInsights]', err)
    return {
      totalLogs: 0, uniqueBrands: 0,
      topBrands: [], topItemTypes: [], topColourFamilies: [], topMaterialCategories: [],
      priceTierDistribution: [],
      avgScores: {
        fit: null, length: null, structure: null, surface: null, colour_depth: null,
        pattern: null, sheen: null, material_weight: null, material_formality: null,
      },
      recent: [],
    }
  }
}

// ── Brands ────────────────────────────────────────────────────────────────────

export async function getAllBrands(): Promise<Brand[]> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('brand')
      .select('*')
      .order('name', { ascending: true })
    if (error) throw error
    return data ?? []
  } catch (err) {
    console.error('[getAllBrands]', err)
    return []
  }
}

// ── Items ─────────────────────────────────────────────────────────────────────

// brand is null for owned wardrobe items with no matched brand row (migration 0046).
export type ItemWithBrand = Item & { brand: Brand }

export interface ItemFacet { value: string; count: number }
export interface ItemsPage {
  items: ItemWithBrand[]
  total: number
  page: number
  pageSize: number
  brands: ItemFacet[]
  types: ItemFacet[]
  colours: ItemFacet[]
  months: ItemFacet[] // value = 'YYYY-MM' of created_at, newest first
}

// One page of the item library plus facet counts for the filter dropdowns.
// Facets are scoped by status/stock (so switching brand/type/colour never
// empties the other dropdowns); total reflects every active filter. Built to
// stay fast at 10k+ items: the page fetch is a single ranged query and the
// facet sweep pulls only three tiny columns per row, in parallel.
//
// `search` is free text ("isabel marant fur jacket"). Every word must land
// somewhere on the piece: the start of a word in its brand, name, type, colour
// or cloth, one typo out ("sherling", "marrant"), or a word for its type or
// cloth ("gilet" finds a vest filed as a gilet, "fur" finds a label that says
// shearling). It narrows the facets too, so the dropdowns show what's inside
// the search.
const searchFold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
function itemSearchMatcher(search: string | undefined): ((r: any) => boolean) | null {
  const words = searchFold(search ?? '').split(/[^a-z0-9]+/).filter((w) => w && !STOPWORDS.has(w))
  if (words.length === 0) return null
  const materials = words.map((w) => fuzzyGet(MATERIAL, w)).filter(Boolean) as string[]
  // A fur "jacket" is often a sleeveless one (see parseQuery).
  const furOuter = materials.some((m) => m === 'fur' || m === 'shearling')
  return (r: any) => {
    const text = searchFold(
      [r.brand?.name, r.product_name, r.item_type?.replace(/_/g, ' '), r.colour_family, r.material_primary].filter(Boolean).join(' '),
    ).replace(/[^a-z0-9]+/g, ' ')
    const hay = text.split(' ').filter(Boolean)
    return words.every((w) => {
      if (hay.some((h) => h.startsWith(w) || isTypoOf(w, h))) return true
      const types = fuzzyGet(TYPE, w)
      // A broad word ("vest", "top") only reaches by type when it names a
      // gilet; otherwise it has to be in the name, or "vest" is every blouse.
      if (types && ((types.includes(r.item_type) && (types.length === 1 || r.item_type === 'gilet')) || (furOuter && r.item_type === 'gilet' && types.some((t) => t === 'jacket' || t === 'coat')))) return true
      const colour = fuzzyGet(COLOUR, w)
      if (colour && r.colour_family === colour) return true
      const material = fuzzyGet(MATERIAL, w)
      if (material && hasMaterial(r, material)) return true
      return false
    })
  }
}

export async function getItemsPage(opts: {
  status?: string
  stockFilter?: 'flagged' | 'out_of_stock' | 'low_stock'
  search?: string
  brand?: string
  itemType?: string
  colour?: string
  month?: string // 'YYYY-MM' — items added in that calendar month (UTC)
  page?: number
  pageSize?: number
}): Promise<ItemsPage> {
  const supabase = createAdminClient()
  const pageSize = opts.pageSize ?? 120
  const applyScope = (q: any) => {
    if (opts.status && opts.status !== 'all') q = q.eq('status', opts.status)
    if (opts.stockFilter === 'flagged') q = q.in('stock_status', ['out_of_stock', 'low_stock'])
    else if (opts.stockFilter === 'out_of_stock' || opts.stockFilter === 'low_stock') q = q.eq('stock_status', opts.stockFilter)
    return q
  }
  try {
    // Facet sweep: brand/type/colour for every row in scope, 1,000 at a time.
    const { count: scopeTotal, error: cerr } = await applyScope(
      (supabase as any).from('item').select('item_id', { count: 'exact', head: true }),
    )
    if (cerr) throw cerr
    const pages = Math.ceil((scopeTotal ?? 0) / 1000)
    const facetBatches = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        applyScope((supabase as any).from('item').select('item_id, product_name, item_type, colour_family, material_primary, created_at, brand:brand_id(name)'))
          .order('item_id')
          .range(i * 1000, i * 1000 + 999)
          .then((r: any) => { if (r.error) throw r.error; return r.data ?? [] }),
      ),
    )
    const searchMatch = itemSearchMatcher(opts.search)
    const facetRows: any[] = searchMatch ? facetBatches.flat().filter(searchMatch) : facetBatches.flat()

    const tally = (rows: any[], key: (r: any) => string | null): ItemFacet[] => {
      const m = new Map<string, number>()
      for (const r of rows) { const v = key(r); if (v) m.set(v, (m.get(v) ?? 0) + 1) }
      return Array.from(m, ([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value))
    }
    const brands = tally(facetRows, (r) => r.brand?.name ?? null)
    const types = tally(facetRows, (r) => r.item_type ?? null)
    const colours = tally(facetRows, (r) => r.colour_family ?? null)
    const monthOf = (r: any) => (typeof r.created_at === 'string' ? r.created_at.slice(0, 7) : null)
    const months = tally(facetRows, monthOf).sort((a, b) => b.value.localeCompare(a.value))

    const month = opts.month && /^\d{4}-\d{2}$/.test(opts.month) ? opts.month : undefined
    const monthRange = month
      ? (() => {
          const [y, m] = month.split('-').map(Number)
          const from = new Date(Date.UTC(y, m - 1, 1)).toISOString()
          const to = new Date(Date.UTC(y, m, 1)).toISOString()
          return { from, to }
        })()
      : undefined

    const matches = (r: any) =>
      (!opts.brand || r.brand?.name === opts.brand) &&
      (!opts.itemType || r.item_type === opts.itemType) &&
      (!opts.colour || r.colour_family === opts.colour) &&
      (!month || monthOf(r) === month)
    const total = facetRows.filter(matches).length

    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const page = Math.min(Math.max(1, opts.page ?? 1), totalPages)

    // A search is resolved from the sweep: page the matching ids (newest
    // first), then fetch just those rows.
    if (searchMatch) {
      const pageIds = facetRows
        .filter(matches)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice((page - 1) * pageSize, page * pageSize)
        .map((r) => r.item_id)
      if (pageIds.length === 0) return { items: [], total, page, pageSize, brands, types, colours, months }
      const { data, error } = await (supabase as any)
        .from('item')
        .select('*, brand(*)')
        .in('item_id', pageIds)
        .order('created_at', { ascending: false })
      if (error) throw error
      return { items: (data ?? []) as unknown as ItemWithBrand[], total, page, pageSize, brands, types, colours, months }
    }

    let q = applyScope(
      (supabase as any)
        .from('item')
        .select(opts.brand ? '*, brand:brand_id!inner(*)' : '*, brand(*)')
        .order('created_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1),
    )
    if (opts.brand) q = q.eq('brand.name', opts.brand)
    if (opts.itemType) q = q.eq('item_type', opts.itemType)
    if (opts.colour) q = q.eq('colour_family', opts.colour)
    if (monthRange) q = q.gte('created_at', monthRange.from).lt('created_at', monthRange.to)
    const { data, error } = await q
    if (error) throw error

    return { items: (data ?? []) as unknown as ItemWithBrand[], total, page, pageSize, brands, types, colours, months }
  } catch (err) {
    console.error('[getItemsPage]', err)
    return { items: [], total: 0, page: 1, pageSize, brands: [], types: [], colours: [], months: [] }
  }
}

export async function getAllItems(
  status?: string,
  stockFilter?: 'flagged' | 'out_of_stock' | 'low_stock',
  opts?: { includeOwned?: boolean },
): Promise<ItemWithBrand[]> {
  const supabase = createAdminClient()
  try {
    const filtered = <Q extends { eq: any; in: any }>(query: Q): Q => {
      if (status && status !== 'all') query = query.eq('status', status)
      if (stockFilter === 'flagged') query = query.in('stock_status', ['out_of_stock', 'low_stock'])
      else if (stockFilter === 'out_of_stock' || stockFilter === 'low_stock') query = query.eq('stock_status', stockFilter)
      return query
    }
    // Page past PostgREST's 1,000-row response cap — the library is bigger.
    //
    // Twelve thousand pieces used to come back a page at a time, each page
    // carrying its brand row again (a third of the bytes) through a lateral
    // join, and the library took thirty seconds of every tap (measured
    // 2026-10-12). Now: the brands once, the count, then the pages three at
    // a time — not all at once, which on a busy evening tripped the
    // statement timeout — each ordered the same way so they tile without
    // overlap, joined to their brand here.
    const PAGE = 1000
    const PARALLEL = 3
    const [{ data: brandRows, error: brandErr }, { count, error: countErr }] = await Promise.all([
      supabase.from('brand').select('*'),
      filtered(supabase.from('item').select('item_id', { count: 'exact', head: true })),
    ])
    if (brandErr) throw brandErr
    if (countErr) throw countErr
    const brands = new Map<string, Brand>(((brandRows ?? []) as Brand[]).map((b) => [b.brand_id, b]))
    const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE))
    const readPage = async (p: number, attempt = 0): Promise<Item[]> => {
      const { data, error } = await filtered(supabase.from('item').select('*'))
        .order('created_at', { ascending: false })
        .order('item_id', { ascending: true })
        .range(p * PAGE, p * PAGE + PAGE - 1)
      if (error) {
        // A page that fell to a timeout under load gets one quiet retry.
        if (attempt < 1) return readPage(p, attempt + 1)
        throw error
      }
      return (data ?? []) as unknown as Item[]
    }
    const out: ItemWithBrand[] = []
    for (let p = 0; p < pages; p += PARALLEL) {
      const batch = await Promise.all(Array.from({ length: Math.min(PARALLEL, pages - p) }, (_, k) => readPage(p + k)))
      for (const rows of batch) {
        for (const row of rows) out.push({ ...row, brand: (row.brand_id && brands.get(row.brand_id)) || null } as unknown as ItemWithBrand)
      }
    }
    // Owned wardrobe items (migration 0046) belong to ONE client — they never
    // enter a shared pool. Filtered in memory so this stays safe pre-migration.
    return opts?.includeOwned ? out : retailOnly(out)
  } catch (err) {
    console.error('[getAllItems]', err)
    return []
  }
}

export async function getItem(id: string): Promise<ItemWithBrand | null> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('item')
      .select('*, brand(*)')
      .eq('item_id', id)
      .single()
    if (error) throw error
    return data as unknown as ItemWithBrand
  } catch (err) {
    console.error('[getItem]', err)
    return null
  }
}

// Returns every item that can be used in the composer — drafts, ready, and
// live. Archived items are excluded. The composer treats drafts as composable
// so newly-ingested pieces can be assembled into outfits immediately, without
// the user having to mark each one ready first.
//
// Read in pages. PostgREST caps any single read at 1,000 rows, and the
// library passed that long ago (7,429 composable pieces on 2026-10-08) — so
// until this paginated, every composer saw only the newest thousand pieces
// and silently never offered the rest. The pages are fetched together after
// one count, so a full read is one round trip longer than a capped one.
const POOL_PAGE = 1000

// The full read is 7k+ rows with their brands and takes seconds (20s on a
// slow afternoon), and eight parallel 1,000-row pages were enough to make the
// database refuse some of them — a refused page emptied the whole pool and
// every composer then found "no combinations". So: one read shared for five
// minutes, concurrent askers share the read in flight, pages are read two at
// a time with retries, and if a fresh read fails the last good pool is served
// rather than nothing. Stock, status and size changes reach the pool within
// the window; a bulk change can call resetReadyAndLiveItemsCache().
const POOL_TTL_MS = 5 * 60 * 1000
// Admin surfaces (Outfit Review) may be handed a pool up to this old while a
// fresh one is read behind them — 20k pieces is 40s+ on a busy evening, and
// waiting for it on every page load is what made Review feel stuck
// (2026-10-26). Member-facing callers keep the strict five minutes.
const POOL_STALE_OK_MS = 30 * 60 * 1000
const POOL_PAGE_CONCURRENCY = 2
const POOL_PAGE_RETRIES = 3
// Kept on globalThis so a dev-server recompile of this module (any session's
// edit to an importer) doesn't throw away a 40-second read.
const poolState = ((globalThis as any).__myraReadyPool ??= { cache: null, inFlight: null }) as {
  cache: { at: number; items: ItemWithBrand[] } | null
  inFlight: Promise<ItemWithBrand[]> | null
}

/** Test seam / after a bulk change: forget the shared pool. */
export function resetReadyAndLiveItemsCache(): void {
  poolState.cache = null
  poolState.inFlight = null
}

export async function getReadyAndLiveItems(opts?: { allowStale?: boolean }): Promise<ItemWithBrand[]> {
  const cache = poolState.cache
  const age = cache ? Date.now() - cache.at : Infinity
  if (cache && age < POOL_TTL_MS) return cache.items
  if (cache && opts?.allowStale && age < POOL_STALE_OK_MS) {
    void refreshReadyAndLiveItems()
    return cache.items
  }
  return refreshReadyAndLiveItems()
}

function refreshReadyAndLiveItems(): Promise<ItemWithBrand[]> {
  if (poolState.inFlight) return poolState.inFlight
  poolState.inFlight = readReadyAndLiveItems()
    .then((items) => {
      if (items) {
        poolState.cache = { at: Date.now(), items }
        return items
      }
      // The read failed: the last good pool is better than an empty one.
      return poolState.cache?.items ?? []
    })
    .finally(() => { poolState.inFlight = null })
  return poolState.inFlight
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The pool, or null when the read failed (never a silently empty pool). */
async function readReadyAndLiveItems(): Promise<ItemWithBrand[] | null> {
  const supabase = createAdminClient()
  try {
    const statuses = ['draft', 'ready', 'live']
    // Brands read once and joined here, as getAllItems does: the lateral
    // brand(*) join repeated each brand row on every piece (a third of the
    // bytes) and was the heaviest query on the database (2026-10-26).
    const [{ data: brandRows, error: brandErr }, { count, error: countErr }] = await Promise.all([
      supabase.from('brand').select('*'),
      supabase.from('item').select('item_id', { count: 'exact', head: true }).in('status', statuses),
    ])
    if (brandErr) throw brandErr
    if (countErr) throw countErr
    const brands = new Map<string, Brand>(((brandRows ?? []) as Brand[]).map((b) => [b.brand_id, b]))
    const pages = Math.max(1, Math.ceil((count ?? 0) / POOL_PAGE))
    const readPage = async (i: number) => {
      let lastErr: unknown = null
      for (let attempt = 0; attempt < POOL_PAGE_RETRIES; attempt++) {
        const r = await supabase
          .from('item')
          .select('*')
          .in('status', statuses)
          .order('created_at', { ascending: false })
          .order('item_id', { ascending: true })
          .range(i * POOL_PAGE, i * POOL_PAGE + POOL_PAGE - 1)
        if (!r.error) {
          return ((r.data ?? []) as Item[]).map((row) => ({ ...row, brand: (row.brand_id && brands.get(row.brand_id)) || null }) as unknown as ItemWithBrand)
        }
        lastErr = r.error
        await sleep(300 * (attempt + 1))
      }
      throw lastErr
    }
    const results: ItemWithBrand[][] = new Array(pages)
    let next = 0
    const worker = async () => {
      while (next < pages) {
        const i = next++
        results[i] = await readPage(i)
      }
    }
    await Promise.all(Array.from({ length: Math.min(POOL_PAGE_CONCURRENCY, pages) }, worker))
    const rows: ItemWithBrand[] = []
    const seen = new Set<string>()
    for (const page of results) {
      for (const it of page) {
        if (seen.has(it.item_id)) continue // a page boundary moved under us
        seen.add(it.item_id)
        rows.push(it)
      }
    }
    // Shared pool = retail only. A client's owned pieces (migration 0046) are
    // composed for HER alone via the private-stylist path.
    return retailOnly(rows)
  } catch (err) {
    console.error('[getReadyAndLiveItems]', err)
    return null
  }
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function getAllProjects(filter?: string): Promise<AdminProject[]> {
  const supabase = createAdminClient()
  try {
    let query = supabase
      .from('admin_project')
      .select('*')
      .order('created_at', { ascending: false })

    if (filter && filter !== 'all') {
      query = query.eq('status', filter)
    }

    const { data, error } = await query
    if (error) throw error
    return data ?? []
  } catch (err) {
    console.error('[getAllProjects]', err)
    return []
  }
}

export async function getProject(id: string): Promise<AdminProject | null> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('admin_project')
      .select('*')
      .eq('project_id', id)
      .single()
    if (error) throw error
    return data
  } catch (err) {
    console.error('[getProject]', err)
    return null
  }
}

export async function getProjectOutfits(projectId: string): Promise<Outfit[]> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('outfit')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  } catch (err) {
    console.error('[getProjectOutfits]', err)
    return []
  }
}

// ── Lookbooks ─────────────────────────────────────────────────────────────────

export async function getLookbooks(): Promise<Lookbook[]> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('lookbook')
      .select('*')
      .eq('status', 'active')
      .order('sort_order', { ascending: true })
    if (error) throw error
    return (data ?? []) as Lookbook[]
  } catch (err) {
    console.error('[getLookbooks]', err)
    return []
  }
}

export async function getOutfitLookbookIds(outfitId: string): Promise<string[]> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('lookbook_outfit')
      .select('lookbook_id')
      .eq('outfit_id', outfitId)
    if (error) throw error
    return (data ?? []).map((r: { lookbook_id: string }) => r.lookbook_id)
  } catch (err) {
    console.error('[getOutfitLookbookIds]', err)
    return []
  }
}

// ── Outfits ───────────────────────────────────────────────────────────────────

export async function getOutfitsForItem(itemId: string): Promise<Outfit[]> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('outfit_item')
      .select('outfit(*)')
      .eq('item_id', itemId)
    if (error) throw error
    return ((data ?? []).map((r: { outfit: unknown }) => r.outfit).filter(Boolean)) as Outfit[]
  } catch (err) {
    console.error('[getOutfitsForItem]', err)
    return []
  }
}

export async function getOutfit(id: string): Promise<OutfitWithItems | null> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('outfit')
      .select('*, outfit_item(*, item(*, brand(*)))')
      .eq('outfit_id', id)
      .single()
    if (error) throw error
    return data as unknown as OutfitWithItems
  } catch (err) {
    console.error('[getOutfit]', err)
    return null
  }
}
