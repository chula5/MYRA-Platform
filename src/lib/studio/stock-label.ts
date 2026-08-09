// Compact stock signal for the mobile review chips.
//
// When sizes were captured they ARE the in-stock sizes (see migration 0018), so
// a piece down to one or two sizes is effectively low stock even if the coarse
// status still says in_stock — that's the case worth flagging before approving
// an outfit into the feed.
//
// tone drives the colour: 'out' red · 'low' amber · 'ok' green · 'none' hide.

export type StockTone = 'out' | 'low' | 'ok' | 'none'

export interface StockSignal {
  tone: StockTone
  /** Short label for the chip, e.g. "OUT OF STOCK", "ONLY L", "S·M·L". */
  text: string
}

// At or below this many remaining sizes, treat the piece as running low.
const LOW_SIZE_COUNT = 2

// Bags, jewellery and most accessories carry a single "one size" marker. That is
// NOT one size left — flagging it amber would cry wolf on every accessory, so
// these fall through to the coarse status instead.
const ONE_SIZE = /^(o\/?s|one[\s-]?size|onesize|uni|tu|u|n\/?a|no[\s-]?size|single)$/i

export function stockSignal(
  status: string | null | undefined,
  sizes: string[] | null | undefined,
): StockSignal {
  const list = (sizes ?? [])
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0 && !ONE_SIZE.test(s))

  if (status === 'out_of_stock') return { tone: 'out', text: 'OUT OF STOCK' }

  if (list.length > 0) {
    const joined = list.join('·')
    // One or two sizes left, or the retailer already flagged low stock.
    if (list.length <= LOW_SIZE_COUNT || status === 'low_stock') {
      return { tone: 'low', text: list.length === 1 ? `ONLY ${joined}` : `LOW · ${joined}` }
    }
    return { tone: 'ok', text: joined }
  }

  if (status === 'low_stock') return { tone: 'low', text: 'LOW STOCK' }
  if (status === 'in_stock') return { tone: 'ok', text: 'IN STOCK' }

  // Never checked / unknown — say nothing rather than imply a check happened.
  return { tone: 'none', text: '' }
}
