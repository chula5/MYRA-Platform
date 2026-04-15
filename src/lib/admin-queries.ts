import { createAdminClient } from '@/lib/supabase-server'
import type { Brand, Item, AdminProject, Outfit, OutfitWithItems, Lookbook } from '@/types/database'

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getAdminStats(): Promise<{
  totalItems: number
  draftItems: number
  readyItems: number
  liveItems: number
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
      totalOutfits: 0, draftOutfits: 0, liveOutfits: 0,
      totalProjects: 0, draftProjects: 0, liveProjects: 0,
      publishedToday: 0,
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

export async function getAllItems(status?: string): Promise<ItemWithBrand[]> {
  const supabase = createAdminClient()
  try {
    let query = supabase
      .from('item')
      .select('*, brand(*)')
      .order('created_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
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
