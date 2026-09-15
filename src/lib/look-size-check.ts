// IN HER SIZE — checked against the retailer, not assumed.
//
// The composer's library is size-gated (loadComposableLibrary), but the gate
// lets a piece through when its sizes are unknown, and a size can sell out
// after a look is built. Measured on Alison (2026-09-15): 1,091 of 2,512 sized
// library pieces had no size data (By Malene Birger 367, ME+EM 265, Sessùn 115…),
// 101 of the pieces in her looks were unconfirmed, and 15 pieces in her looks
// are no longer in her size — nearly all sold out in it after the look was made.
//
// So a look's pieces are re-read from the retailer at the moments that matter
// (before looks are shown, at STOCK CHECK, at SEND), and every piece gets a
// verdict: in her size, not in her size, or unconfirmed (the retailer page gave
// no readable sizes). Owned pieces and pieces with no size (bags, jewellery)
// are never checked.

import 'server-only'
import { checkStockDetailed } from '@/app/admin/items/stock-check'
import { loadBrandOffsets, loadMemberSizeProfile, loadSizeRowsFor, upsertSizeAvailability } from '@/lib/size-availability'
import { resolveAvailability } from '@/lib/size-match'
import { sizeCategoryFor } from '@/lib/size-canonical'

export type SizeVerdict = 'in_size' | 'not_in_size' | 'unconfirmed'

export interface PieceSize {
  verdict: SizeVerdict
  /** The size she'd buy ("UK 8"), when in her size. */
  label: string | null
}

interface CheckablePiece {
  item_id?: string | null
  item_type?: string | null
  owned?: boolean
}

/** Which pieces need a size at all. */
export const needsSizeCheck = (p: CheckablePiece): p is CheckablePiece & { item_id: string } =>
  !p.owned && !!p.item_id && !!sizeCategoryFor(p.item_type as any)

/**
 * Size verdicts for a member's pieces, keyed by item_id.
 *
 * refresh 'unknown' re-reads only pieces with no usable size data (cheap —
 * before showing looks); 'all' re-reads every piece (STOCK CHECK and SEND,
 * where a size selling out since the look was built is the whole risk).
 */
export async function checkSizesForMember(
  admin: any,
  memberId: string,
  pieces: CheckablePiece[],
  refresh: 'none' | 'unknown' | 'all' = 'unknown',
): Promise<Map<string, PieceSize>> {
  const out = new Map<string, PieceSize>()
  const ids = Array.from(new Set(pieces.filter(needsSizeCheck).map((p) => p.item_id)))
  if (!ids.length) return out

  const ctx = await loadMemberSizeProfile(memberId)
  const { data: itemRows } = await admin
    .from('item')
    .select('item_id, item_type, retailer_url, brand_id, stock_class, source, status')
    .in('item_id', ids)
  const items = new Map<string, any>(((itemRows ?? []) as any[]).map((r) => [r.item_id, r]))
  let rows = await loadSizeRowsFor(ids)

  const verdictOf = (id: string): PieceSize => {
    const item = items.get(id)
    if (!item || !ctx.hasProfile) return { verdict: 'unconfirmed', label: null }
    const a = resolveAvailability(item, rows.get(id) ?? [], ctx.profile)
    if (a.quality === 'unknown') return { verdict: 'unconfirmed', label: null }
    return a.wearable ? { verdict: 'in_size', label: a.herSizeLabel } : { verdict: 'not_in_size', label: null }
  }

  const toRead = refresh === 'none' ? [] : ids.filter((id) =>
    items.get(id)?.retailer_url && (refresh === 'all' || verdictOf(id).verdict === 'unconfirmed'))

  if (toRead.length) {
    const offsets = await loadBrandOffsets(Array.from(new Set(toRead.map((id) => items.get(id)?.brand_id).filter(Boolean))))
    // Four at a time: a look is a handful of pieces across a few retailers.
    for (let i = 0; i < toRead.length; i += 4) {
      await Promise.all(toRead.slice(i, i + 4).map(async (id) => {
        const item = items.get(id)
        try {
          const checked = await checkStockDetailed(item.retailer_url)
          if (!checked.sizes.length) return
          await upsertSizeAvailability(id, checked.sizes, {
            itemType: item.item_type,
            brandOffsets: offsets.get(item.brand_id) ?? null,
          })
        } catch (err) {
          console.error('[checkSizesForMember]', id, err)
        }
      }))
    }
    rows = await loadSizeRowsFor(ids)
  }

  for (const id of ids) out.set(id, verdictOf(id))
  return out
}
