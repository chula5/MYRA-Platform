// AUTONOMY GRADUATION — pure stage machine.
//
// Three publishing stages per stylist, moved between automatically on review
// performance. The tracker counts individual outfit VARIANTS, not sets.
//
//   Stage 1 — FULL REVIEW: everything goes through the review queue.
//   Stage 2 — AUDITED AUTO-PUBLISH: fast-lane outfits publish straight through
//             render + fidelity; daily audit digest with one-tap pull.
//   Stage 3 — AUTONOMOUS COMPOSITION: scheduled gap-filling composition;
//             weekly digest.
//
// Demotions: any audit intervention drops Stage 2 → 1 and Stage 3 → 2
// immediately; a trailing swap rate above 10% drops Stage 3 → 1.
// The render fidelity check is NEVER bypassed at any stage.

export interface ReviewEntry {
  at: string
  lane: 'fast' | 'standard'
  swapped: boolean      // she swapped at least one item before deciding
  approved: boolean
}

export interface AutonomyState {
  stage: 1 | 2 | 3
  currentStreak: number                  // consecutive fast-lane approvals with ZERO swaps
  reviewedLog: ReviewEntry[]             // last 50 reviewed variants
  stage2Since: string | null             // ISO — when Stage 2 began
  lastInterventionAt: string | null
  demotions: { at: string; from: number; to: number; reason: string }[]
}

export const STREAK_TO_STAGE2 = 10
export const SWAP_RATE_CEILING = 0.10
export const TRAILING_WINDOW = 50
export const STAGE3_CLEAN_DAYS = 30
/** Promotion needs a minimally meaningful trailing sample. */
export const MIN_REVIEWS_FOR_PROMOTION = 10

export function emptyAutonomy(): AutonomyState {
  return { stage: 1, currentStreak: 0, reviewedLog: [], stage2Since: null, lastInterventionAt: null, demotions: [] }
}

/** % of the trailing window where at least one item was swapped. */
export function trailingSwapRate(log: ReviewEntry[]): number {
  const window = log.slice(-TRAILING_WINDOW)
  if (!window.length) return 0
  return window.filter((e) => e.swapped).length / window.length
}

// Fold one reviewed variant into the state. Streak counts consecutive FAST-LANE
// approvals with zero swaps; a swap or a reject resets it to 0. Standard-lane
// clean approvals don't advance the streak (they aren't the trust signal) but
// they do enter the trailing window.
export function recordReview(
  state: AutonomyState,
  entry: { lane: 'fast' | 'standard'; swapped: boolean; approved: boolean },
  now = new Date(),
): AutonomyState {
  const e: ReviewEntry = { at: now.toISOString(), ...entry }
  const reviewedLog = [...state.reviewedLog, e].slice(-TRAILING_WINDOW)
  let currentStreak = state.currentStreak
  if (entry.swapped || !entry.approved) currentStreak = 0
  else if (entry.lane === 'fast') currentStreak += 1

  let { stage, stage2Since } = state
  // Promotion 1 → 2.
  if (
    stage === 1 &&
    currentStreak >= STREAK_TO_STAGE2 &&
    reviewedLog.length >= MIN_REVIEWS_FOR_PROMOTION &&
    trailingSwapRate(reviewedLog) < SWAP_RATE_CEILING
  ) {
    stage = 2
    stage2Since = now.toISOString()
  }
  // Safety valve at any stage: trailing swap rate above the ceiling → Stage 1.
  let demotions = state.demotions
  if (stage > 1 && trailingSwapRate(reviewedLog) > SWAP_RATE_CEILING) {
    demotions = [...demotions, { at: now.toISOString(), from: stage, to: 1, reason: `trailing swap rate ${Math.round(trailingSwapRate(reviewedLog) * 100)}% over last ${Math.min(reviewedLog.length, TRAILING_WINDOW)}` }].slice(-20)
    stage = 1
    stage2Since = null
    currentStreak = 0
  }
  return { ...state, stage, stage2Since, currentStreak, reviewedLog, demotions }
}

// An audit intervention (swap or pull on an auto-published outfit).
// Stage 2 → Stage 1 immediately; Stage 3 → Stage 2 (or Stage 1 when the
// trailing swap rate is also above the ceiling). Streak resets.
export function applyIntervention(
  state: AutonomyState,
  kind: 'swapped' | 'pulled',
  now = new Date(),
): AutonomyState {
  if (state.stage === 1) {
    return { ...state, currentStreak: 0, lastInterventionAt: now.toISOString() }
  }
  const to = state.stage === 3
    ? (trailingSwapRate(state.reviewedLog) > SWAP_RATE_CEILING ? 1 : 2)
    : 1
  return {
    ...state,
    stage: to as 1 | 2 | 3,
    stage2Since: to >= 2 ? state.stage2Since : null,
    currentStreak: 0,
    lastInterventionAt: now.toISOString(),
    demotions: [...state.demotions, { at: now.toISOString(), from: state.stage, to, reason: `audit ${kind}` }].slice(-20),
  }
}

// Stage 2 → 3 after 30 consecutive days with zero audit interventions.
export function checkStage3Promotion(state: AutonomyState, now = new Date()): AutonomyState {
  if (state.stage !== 2 || !state.stage2Since) return state
  const since = new Date(state.stage2Since).getTime()
  const cleanDays = (now.getTime() - since) / 86400000
  const intervenedInWindow =
    state.lastInterventionAt != null && new Date(state.lastInterventionAt).getTime() >= since
  if (cleanDays >= STAGE3_CLEAN_DAYS && !intervenedInWindow) {
    return { ...state, stage: 3 }
  }
  return state
}

// ── Dashboard read-out ────────────────────────────────────────────────────────

export interface AutonomyProgress {
  stage: 1 | 2 | 3
  stageLabel: string
  streak: number
  streakTarget: number
  swapRate: number
  swapRateCeiling: number
  nextTrigger: string
  daysInStage2: number | null
}

export const STAGE_LABELS: Record<number, string> = {
  1: 'FULL REVIEW',
  2: 'AUDITED AUTO-PUBLISH',
  3: 'AUTONOMOUS COMPOSITION',
}

export function autonomyProgress(state: AutonomyState, now = new Date()): AutonomyProgress {
  const swapRate = trailingSwapRate(state.reviewedLog)
  const daysInStage2 = state.stage >= 2 && state.stage2Since
    ? Math.floor((now.getTime() - new Date(state.stage2Since).getTime()) / 86400000)
    : null
  let nextTrigger = ''
  if (state.stage === 1) {
    nextTrigger = `Stage 2 at ${STREAK_TO_STAGE2} clean fast-lane approvals in a row (now ${state.currentStreak}) with swap rate under ${Math.round(SWAP_RATE_CEILING * 100)}% (now ${Math.round(swapRate * 100)}%)`
  } else if (state.stage === 2) {
    nextTrigger = `Stage 3 after ${STAGE3_CLEAN_DAYS} clean days in Stage 2 (day ${daysInStage2 ?? 0})`
  } else {
    nextTrigger = 'Fully autonomous — weekly digest'
  }
  return {
    stage: state.stage,
    stageLabel: STAGE_LABELS[state.stage],
    streak: state.currentStreak,
    streakTarget: STREAK_TO_STAGE2,
    swapRate,
    swapRateCeiling: SWAP_RATE_CEILING,
    nextTrigger,
    daysInStage2,
  }
}
