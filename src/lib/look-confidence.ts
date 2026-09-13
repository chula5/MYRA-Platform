// HOW SURE IS THE SYSTEM ABOUT THIS LOOK?
//
// A client asking for something and getting it composed on the spot is the
// point of the chat. But at a 55% clean rate, roughly one look in two would
// normally have been edited before anyone saw it, so something has to decide
// which ones can be trusted unreviewed.
//
// THE FIRST ATTEMPT DID NOT WORK, and it is worth saying why. It scored
// coherence, anchor affinity and constitution — all computed at compose time.
// Measured against 63 of Alison's reviewed looks it separated clean from
// edited by 0.045, which is noise: coherence is ~1.00 on everything the
// composer emits because it already gates on coherence, and the rest was
// either constant or unrecorded.
//
// What actually separates is HER OWN HISTORY. A piece that has already been in
// a look she kept is evidence; a piece that has only ever been in looks that
// got edited is evidence the other way. Same for brand pairings. That signal
// is reconstructible, varies look to look, and — the point — it improves every
// time she likes something, which is what a confidence score is supposed to do.

export interface LookSignals {
  /** Did the look pass the stylist's constitution? */
  constitutionPassed: boolean
  /** Contains a piece she has rejected before. */
  containsRejected: boolean
  /** Contains a description her history has blocked. */
  containsBlockedTrait: boolean

  // ── Evidence from what she has already kept ──────────────────────────────
  /** Share of this look's pieces that have appeared in a look she kept. */
  provenPieceShare: number
  /** Share that have only appeared in looks that were edited or turned down. */
  troubledPieceShare: number
  /** Share of the look's brand pairings that have survived review before. */
  provenPairShare: number
  /** Share that have been broken up before. */
  brokenPairShare: number

  // ── Composition quality ──────────────────────────────────────────────────
  /** The pool had to be relaxed to build this. */
  usedFallbackPool: boolean
  /** Pieces with no scored dimensions — composed on brand and colour alone. */
  unscoredShare: number
}

export interface Confidence {
  score: number
  high: boolean
  reasons: string[]
}

/**
 * Where the line sits.
 *
 * MEASURED on Alison's 60 decided looks, walking forward so each is scored
 * only from the looks before it — never from its own outcome. At 0.75, 17 of
 * 60 would reach her and 76% of those went out clean, against a base rate of
 * 50%. Lower cuts pass more looks at steadily worse odds: 0.70 gives 69%, 0.60
 * gives 67%, 0.50 gives 60%.
 *
 * Deliberately at the tight end. The cost of a bad look reaching a client is
 * higher than the cost of a good one waiting for review, and this number
 * should come down only as the odds at lower cuts improve.
 */
export const HIGH_CONFIDENCE = 0.75

/** Until the score earns it on a member's own history, she is sent looks by hand. */
export const AUTO_PUBLISH_DEFAULT = false

/**
 * How much better than chance the gate has to be before it is worth having.
 *
 * Measured as PRECISION LIFT — of the looks that would reach her, what share
 * went out clean, against the share that would have if we picked at random.
 * Mean separation was the first test and it is too blunt: Alison's is 0.143,
 * which reads as a failure, while the precision at the chosen cut is 76%
 * against a 50% base rate. What matters is what she is sent, not the average.
 */
export const MIN_PRECISION_LIFT = 0.15
export const MIN_USEFUL_SEPARATION = 0.15

function disqualified(s: LookSignals): string | null {
  if (!s.constitutionPassed) return 'breaks a house rule'
  if (s.containsRejected) return 'contains a piece she has already turned down'
  if (s.containsBlockedTrait) return 'contains a kind of piece she keeps rejecting'
  return null
}

const clamp01 = (n: number): number =>
  !Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n

export function lookConfidence(s: LookSignals): Confidence {
  const reasons: string[] = []
  const blocker = disqualified(s)
  if (blocker) return { score: 0, high: false, reasons: [blocker] }

  const proven = clamp01(s.provenPieceShare)
  const troubled = clamp01(s.troubledPieceShare)
  const pairsProven = clamp01(s.provenPairShare)
  const pairsBroken = clamp01(s.brokenPairShare)

  // Her own history carries it. Pieces weigh more than pairings because a
  // piece she has worn is a stronger statement than two brands sitting
  // together once.
  let score = 0.5 + proven * 0.4 + pairsProven * 0.2 - troubled * 0.35 - pairsBroken * 0.15

  if (proven >= 0.5) reasons.push(`${Math.round(proven * 100)}% of it she has already kept`)
  if (troubled >= 0.5) reasons.push(`${Math.round(troubled * 100)}% of it has only ever been edited out`)
  if (pairsProven >= 0.5) reasons.push('these brands have worked together before')

  if (s.usedFallbackPool) { score -= 0.15; reasons.push('built from a relaxed pool') }
  if (s.unscoredShare > 0.5) { score -= 0.12; reasons.push('most pieces have no style scores') }
  else if (s.unscoredShare > 0.25) { score -= 0.06; reasons.push('some pieces have no style scores') }

  score = clamp01(score)
  const high = score >= HIGH_CONFIDENCE
  reasons.unshift(high ? 'confident enough to send' : 'not confident enough to send unreviewed')
  return { score, high, reasons }
}

// ── Building the signals from her history ───────────────────────────────────

export interface LookRecord {
  /** item ids in the look */
  itemIds: string[]
  /** brand ids in the look */
  brandIds: string[]
  /** She kept it: approved with no edit, or said yes. */
  kept: boolean
}

export interface HistoryIndex {
  keptPieces: Set<string>
  troubledPieces: Set<string>
  keptPairs: Set<string>
  brokenPairs: Set<string>
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * What her past looks say about pieces and pairings.
 *
 * A piece is "proven" the moment it appears in one she kept — a single yes
 * outweighs any number of looks it merely appeared in, because appearing is
 * the composer's choice and keeping is hers.
 */
export function indexHistory(looks: LookRecord[]): HistoryIndex {
  const keptPieces = new Set<string>()
  const troubledPieces = new Set<string>()
  const keptPairs = new Set<string>()
  const brokenPairs = new Set<string>()
  for (const l of looks) {
    for (const id of l.itemIds) (l.kept ? keptPieces : troubledPieces).add(id)
    for (let i = 0; i < l.brandIds.length; i++) {
      for (let j = i + 1; j < l.brandIds.length; j++) {
        if (l.brandIds[i] === l.brandIds[j]) continue
        ;(l.kept ? keptPairs : brokenPairs).add(pairKey(l.brandIds[i], l.brandIds[j]))
      }
    }
  }
  // Proof wins: a piece she kept once is proven, whatever else happened to it.
  for (const id of Array.from(keptPieces)) troubledPieces.delete(id)
  for (const k of Array.from(keptPairs)) brokenPairs.delete(k)
  return { keptPieces, troubledPieces, keptPairs, brokenPairs }
}

/** The history half of the signals for one candidate look. */
export function historySignals(
  h: HistoryIndex,
  itemIds: string[],
  brandIds: string[],
): Pick<LookSignals, 'provenPieceShare' | 'troubledPieceShare' | 'provenPairShare' | 'brokenPairShare'> {
  const n = itemIds.length || 1
  const pairs: string[] = []
  for (let i = 0; i < brandIds.length; i++) {
    for (let j = i + 1; j < brandIds.length; j++) {
      if (brandIds[i] !== brandIds[j]) pairs.push(pairKey(brandIds[i], brandIds[j]))
    }
  }
  const p = pairs.length || 1
  return {
    provenPieceShare: itemIds.filter((id) => h.keptPieces.has(id)).length / n,
    troubledPieceShare: itemIds.filter((id) => h.troubledPieces.has(id)).length / n,
    provenPairShare: pairs.filter((k) => h.keptPairs.has(k)).length / p,
    brokenPairShare: pairs.filter((k) => h.brokenPairs.has(k)).length / p,
  }
}

/**
 * Where the line should sit for one member, measured rather than assumed.
 *
 * A separation near zero means the score is not predicting her edits, and the
 * caller should say so rather than shipping a threshold that means nothing.
 */
export interface Calibration {
  threshold: number
  separation: number
  cleanMean: number
  editedMean: number
  sample: number
  /** Of the looks that would reach her at this threshold, the share that were clean. */
  precision: number
  /** How much better than picking at random. */
  lift: number
  reaching: number
  usable: boolean
}

export function calibrateThreshold(
  history: { score: number; wasClean: boolean }[],
  threshold = HIGH_CONFIDENCE,
): Calibration {
  const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
  const cleanMean = mean(history.filter((h) => h.wasClean).map((h) => h.score))
  const editedMean = mean(history.filter((h) => !h.wasClean).map((h) => h.score))
  const baseRate = history.length ? history.filter((h) => h.wasClean).length / history.length : 0
  const reaching = history.filter((h) => h.score >= threshold)
  const precision = reaching.length ? reaching.filter((h) => h.wasClean).length / reaching.length : 0
  const lift = reaching.length ? precision - baseRate : 0
  return {
    threshold,
    separation: cleanMean - editedMean,
    cleanMean,
    editedMean,
    sample: history.length,
    precision,
    lift,
    reaching: reaching.length,
    usable: reaching.length >= 10 && lift >= MIN_PRECISION_LIFT,
  }
}
