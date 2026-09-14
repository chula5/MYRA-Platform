/**
 * What her answers currently say about each piece: kept, rejected, or neither.
 *
 * The MOST RECENT answer wins. A piece swapped out and swapped straight back
 * in a minute later has been kept; a piece kept in August and removed in
 * September has been rejected. Counting every rejection ever made — as the
 * confidence score did — zeroed looks built from pieces she had kept three
 * times since, and the composer dropped all credit for a kept piece the moment
 * any rejection existed, whichever came first.
 *
 * One definition, used by the composer and the confidence score, so they
 * cannot disagree about whether a piece is wanted.
 */

export interface FeedbackRow {
  action: string
  item_in?: string | null
  item_out?: string | null
  created_at?: string | null
}

export interface PieceVerdicts {
  /** Latest answer was a rejection. */
  rejected: Set<string>
  /** Latest answer was a keep. */
  kept: Set<string>
  /** Every rejection ever, for the "rejected repeatedly" nudge. */
  rejectedCounts: Map<string, number>
  /** Every keep ever. */
  keptCounts: Map<string, number>
}

/** The piece a row speaks against, if it rejects one. */
export function rejectedPiece(r: FeedbackRow): string | null {
  // A removed piece is item_out; older skip rows stored it as item_in.
  if (r.action === 'remove') return r.item_out ?? r.item_in ?? null
  if (r.action === 'swap') return r.item_out ?? null
  return null
}

export function pieceVerdicts(rows: FeedbackRow[]): PieceVerdicts {
  // Oldest first, so later answers overwrite earlier ones. Rows without a
  // timestamp keep their given order.
  const ordered = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ta = a.r.created_at ? Date.parse(a.r.created_at) : NaN
      const tb = b.r.created_at ? Date.parse(b.r.created_at) : NaN
      if (Number.isNaN(ta) || Number.isNaN(tb) || ta === tb) return a.i - b.i
      return ta - tb
    })
    .map((x) => x.r)

  const latest = new Map<string, 'kept' | 'rejected'>()
  const rejectedCounts = new Map<string, number>()
  const keptCounts = new Map<string, number>()
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1)

  for (const r of ordered) {
    const out = rejectedPiece(r)
    if (out) { latest.set(out, 'rejected'); bump(rejectedCounts, out) }
    // A swap brings a piece in as well as taking one out; an accept keeps it.
    if ((r.action === 'accept' || r.action === 'swap') && r.item_in && r.item_in !== out) {
      if (r.action === 'accept') { latest.set(r.item_in, 'kept'); bump(keptCounts, r.item_in) }
    }
  }

  const rejected = new Set<string>()
  const kept = new Set<string>()
  latest.forEach((v, id) => (v === 'rejected' ? rejected : kept).add(id))
  return { rejected, kept, rejectedCounts, keptCounts }
}
