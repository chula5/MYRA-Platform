// WHEN CAN A MEMBER BE SENT LOOKS WITHOUT CHLOE READING THEM FIRST?
//
// Trust has to be a number, not a feeling, or the honest answer is always
// "not yet" and the pilot never ends. Two independent signals decide it, and
// both must hold:
//
//   Chloe's edits  — did the composer get it right? A look published with no
//                    swap and no removal is CLEAN. This is the machine's mark.
//   Alison's yes/no — was it right FOR HER? A look Chloe never touched but the
//                    member turns down is not a success, it is a shared blind
//                    spot. This is the only signal that can catch that.
//
// Both read from data already being written on every look, so there is no new
// table to keep in step and no way for the score to drift from what happened.
//
// Measured on Alison, 2026-08-23: 1 clean look in 16. The gate holds, which is
// the correct answer — and it will move on its own as the numbers move.

export interface LookOutcome {
  look_id: string
  created_at: string
  /** Swaps and removals Chloe made on this look. Zero = clean. */
  edits: number
  approved: boolean
  /** The member's own verdict, once she has given one. */
  response: 'yes' | 'no' | null
}

export type TrustStage = 1 | 2 | 3

export interface TrustRead {
  stage: TrustStage
  /** Share of the trailing window published with no edit at all. */
  cleanRate: number
  /** Consecutive clean looks, most recent first. */
  streak: number
  sample: number
  memberYesRate: number | null
  responses: number
  /** What is still missing before the next stage, in her words. */
  blockers: string[]
  nextStage: TrustStage | null
}

export const TRAILING = 20
export const STAGE2_STREAK = 8
export const STAGE2_CLEAN_RATE = 0.8
export const STAGE2_MIN_SAMPLE = 10
export const STAGE2_YES_RATE = 0.6
export const STAGE2_MIN_RESPONSES = 6
export const STAGE3_CLEAN_RATE = 0.9
export const STAGE3_DAYS_AT_STAGE2 = 30

const pct = (n: number) => `${Math.round(n * 100)}%`

/**
 * Read the trust state from a member's look history, newest last.
 *
 * `stage2Since` is when auto-send was switched on for her, if it ever was —
 * Stage 3 needs a month of it behind them, and nothing else uses the date.
 */
export function readTrust(looks: LookOutcome[], stage2Since?: string | null, now = new Date()): TrustRead {
  const decided = looks.filter((l) => l.approved || l.edits > 0)
  const window = decided.slice(-TRAILING)
  const sample = window.length
  const clean = window.filter((l) => l.edits === 0)
  const cleanRate = sample ? clean.length / sample : 0

  let streak = 0
  for (let i = decided.length - 1; i >= 0; i--) {
    if (decided[i].edits === 0) streak++
    else break
  }

  const responded = looks.filter((l) => l.response)
  const yes = responded.filter((l) => l.response === 'yes').length
  const memberYesRate = responded.length ? yes / responded.length : null

  const blockers: string[] = []
  if (sample < STAGE2_MIN_SAMPLE) blockers.push(`${STAGE2_MIN_SAMPLE - sample} more reviewed looks needed`)
  if (streak < STAGE2_STREAK) blockers.push(`${STAGE2_STREAK - streak} more clean looks in a row (${streak}/${STAGE2_STREAK})`)
  if (cleanRate < STAGE2_CLEAN_RATE) blockers.push(`clean rate ${pct(cleanRate)} — needs ${pct(STAGE2_CLEAN_RATE)}`)
  if (responded.length < STAGE2_MIN_RESPONSES) blockers.push(`${STAGE2_MIN_RESPONSES - responded.length} more verdicts from her`)
  else if ((memberYesRate ?? 0) < STAGE2_YES_RATE) blockers.push(`she says yes ${pct(memberYesRate ?? 0)} of the time — needs ${pct(STAGE2_YES_RATE)}`)

  const stage2Ready = blockers.length === 0
  let stage: TrustStage = stage2Ready ? 2 : 1

  if (stage === 2 && stage2Since) {
    const days = (now.getTime() - Date.parse(stage2Since)) / 86_400_000
    if (days >= STAGE3_DAYS_AT_STAGE2 && cleanRate >= STAGE3_CLEAN_RATE) stage = 3
  }

  return {
    stage,
    cleanRate,
    streak,
    sample,
    memberYesRate,
    responses: responded.length,
    blockers,
    nextStage: stage === 3 ? null : ((stage + 1) as TrustStage),
  }
}

/** One line for the member card. */
export function trustHeadline(t: TrustRead): string {
  if (t.stage === 1) return `REVIEW EVERY LOOK — ${pct(t.cleanRate)} CLEAN OVER ${t.sample}`
  if (t.stage === 2) return `AUTO-SEND WITH MORNING DIGEST — ${pct(t.cleanRate)} CLEAN OVER ${t.sample}`
  return `COMPOSING AND SENDING ON SCHEDULE — ${pct(t.cleanRate)} CLEAN`
}
