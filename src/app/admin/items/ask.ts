// BUILD AN OUTFIT in the item library: the sentence read as pieces (lib/
// outfit-ask), each piece's matches from the whole library in the current
// status tab. Server-only — imported by the page, never by the browser.

import { createAdminClient } from '@/lib/supabase-server'
import type { ItemWithBrand } from '@/lib/admin-queries'
import { parseOutfitAsk, rankForPiece } from '@/lib/outfit-ask'
import { retailOnly } from '@/lib/wardrobe/owned-items'

export interface AskGroup {
  label: string
  relaxed: string | null
  total: number
  items: ItemWithBrand[]
}

const PER_PIECE = 30

export async function getAskGroups(ask: string, status?: string): Promise<{ groups: AskGroup[]; error?: string }> {
  const supabase = createAdminClient() as any
  try {
    const scope = (q: any) => (status && status !== 'all' ? q.eq('status', status) : q)
    // The same light sweep the library's search uses: a few columns of every
    // row in scope, 1,000 at a time.
    const { count, error: cerr } = await scope(supabase.from('item').select('item_id', { count: 'exact', head: true }))
    if (cerr) throw cerr
    const pages = Math.ceil((count ?? 0) / 1000)
    const batches = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        scope(supabase.from('item').select('item_id, product_name, item_type, colour_family, material_primary, stock_status, created_at, ownership, brand:brand_id(name)'))
          .order('item_id')
          .range(i * 1000, i * 1000 + 999)
          .then((r: any) => { if (r.error) throw r.error; return r.data ?? [] }),
      ),
    )
    // Owned wardrobe pieces belong to one client — never offered here.
    const rows: any[] = retailOnly(batches.flat())
    const brands = Array.from(new Set(rows.map((r) => r.brand?.name).filter(Boolean) as string[]))
    const { pieces } = parseOutfitAsk(ask, brands)
    if (pieces.length === 0) return { groups: [], error: `Couldn’t find a piece in “${ask}” — name a garment, a colour, a cloth or a brand` }

    const matched = pieces.map((spec) => rankForPiece(rows, spec, { limit: PER_PIECE }))
    const ids = Array.from(new Set(matched.flatMap((m) => m.items.map((i: any) => i.item_id))))
    const full = new Map<string, ItemWithBrand>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.from('item').select('*, brand(*)').in('item_id', ids.slice(i, i + 200))
      if (error) throw error
      for (const it of (data ?? []) as ItemWithBrand[]) full.set(it.item_id, it)
    }
    return {
      groups: matched.map((m) => ({
        label: m.spec.label,
        relaxed: m.relaxed,
        total: m.total,
        items: m.items.map((i: any) => full.get(i.item_id)).filter(Boolean) as ItemWithBrand[],
      })),
    }
  } catch (err) {
    console.error('[getAskGroups]', err)
    return { groups: [], error: err instanceof Error ? err.message : 'Could not read the library' }
  }
}
