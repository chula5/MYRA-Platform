'use server'

// HER SALE — the BLACK FRIDAY section on For You (lib/sales/picks does the choosing).

import { createAdminClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'
import { salePicksFor, type SaleView } from '@/lib/sales/picks'
import { inBlackFriday } from '@/lib/sales/detect'
import { loadTasteGraph } from '@/lib/taste-graph'

export type { SaleView, SalePiece, SaleBrand } from '@/lib/sales/picks'

export async function loadMySale(asMemberId?: string, limit = 48): Promise<SaleView & { blackFriday: boolean; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { brands: [], pieces: [], gaps: [], blackFriday: false, error: 'Not signed in' }
  const view = await salePicksFor(createAdminClient() as any, me.memberId, { limit: Math.min(200, Math.max(1, limit)) })
  return { ...view, blackFriday: inBlackFriday() }
}

/** How many of her brands are on sale now — the badge on the price tag. Cheap: no pieces read. */
export async function countMySaleBrands(asMemberId?: string): Promise<number> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return 0
  const admin = createAdminClient() as any
  const { data } = await admin.from('brand_sale').select('brand_id').eq('active', true).eq('paused', false)
  if (!data?.length) return 0
  const graph = await loadTasteGraph(admin, me.memberId)
  return (data as any[]).filter((s) => graph.weights.has(s.brand_id) && !graph.blocked.has(s.brand_id)).length
}
