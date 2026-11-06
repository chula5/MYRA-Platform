'use server'

// HER SALE — the BLACK FRIDAY section on For You (lib/sales/picks does the choosing).

import { createAdminClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'
import { salePicksFor, type SaleView } from '@/lib/sales/picks'
import { inBlackFriday } from '@/lib/sales/detect'

export type { SaleView, SalePiece, SaleBrand } from '@/lib/sales/picks'

export async function loadMySale(asMemberId?: string): Promise<SaleView & { blackFriday: boolean; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { brands: [], pieces: [], gaps: [], blackFriday: false, error: 'Not signed in' }
  const view = await salePicksFor(createAdminClient() as any, me.memberId)
  return { ...view, blackFriday: inBlackFriday() }
}
