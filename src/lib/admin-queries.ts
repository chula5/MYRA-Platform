import { createAdminClient } from '@/lib/supabase-server'
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

export type ItemWithBrand = Item & { brand: Brand }

export async function getAllItems(
  status?: string,
  stockFilter?: 'flagged' | 'out_of_stock' | 'low_stock',
): Promise<ItemWithBrand[]> {
  const supabase = createAdminClient()
  try {
    let query = supabase
      .from('item')
      .select('*, brand(*)')
      .order('created_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    if (stockFilter === 'flagged') {
      query = query.in('stock_status', ['out_of_stock', 'low_stock'])
    } else if (stockFilter === 'out_of_stock' || stockFilter === 'low_stock') {
      query = query.eq('stock_status', stockFilter)
    }

    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as unknown as ItemWithBrand[]
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

export async function getReadyAndLiveItems(): Promise<ItemWithBrand[]> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('item')
      .select('*, brand(*)')
      .in('status', ['ready', 'live'])
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as unknown as ItemWithBrand[]
  } catch (err) {
    console.error('[getReadyAndLiveItems]', err)
    return []
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
