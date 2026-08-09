import { describe, it, expect } from 'vitest'
import {
  emptyAutonomy,
  recordReview,
  applyIntervention,
  checkStage3Promotion,
  trailingSwapRate,
  autonomyProgress,
  STREAK_TO_STAGE2,
  type AutonomyState,
} from '@/lib/autonomy'

const cleanFast = { lane: 'fast' as const, swapped: false, approved: true }

function afterN(n: number, state = emptyAutonomy()): AutonomyState {
  let s = state
  for (let i = 0; i < n; i++) s = recordReview(s, cleanFast)
  return s
}

describe('streak + promotion to Stage 2', () => {
  it('counts consecutive clean fast-lane approvals', () => {
    expect(afterN(3).currentStreak).toBe(3)
  })
  it('a swap resets the streak', () => {
    let s = afterN(5)
    s = recordReview(s, { lane: 'fast', swapped: true, approved: true })
    expect(s.currentStreak).toBe(0)
  })
  it('a reject resets the streak', () => {
    let s = afterN(5)
    s = recordReview(s, { lane: 'fast', swapped: false, approved: false })
    expect(s.currentStreak).toBe(0)
  })
  it('standard-lane approvals do not advance the streak but enter the window', () => {
    let s = afterN(2)
    s = recordReview(s, { lane: 'standard', swapped: false, approved: true })
    expect(s.currentStreak).toBe(2)
    expect(s.reviewedLog.length).toBe(3)
  })
  it('promotes to Stage 2 at streak 10 with swap rate under 10%', () => {
    const s = afterN(STREAK_TO_STAGE2)
    expect(s.stage).toBe(2)
    expect(s.stage2Since).toBeTruthy()
  })
  it('does not promote when the trailing swap rate is 10%+', () => {
    let s = emptyAutonomy()
    // 40 reviews: 8 with swaps (20%) then a 10-streak
    for (let i = 0; i < 8; i++) s = recordReview(s, { lane: 'fast', swapped: true, approved: true })
    for (let i = 0; i < 22; i++) s = recordReview(s, cleanFast)
    expect(s.stage).toBe(1) // 8/30 = 27% swap rate blocks promotion despite streak 22
  })
})

describe('trailing swap rate window', () => {
  it('is computed over the last 50 only', () => {
    let s = emptyAutonomy()
    for (let i = 0; i < 10; i++) s = recordReview(s, { lane: 'standard', swapped: true, approved: true })
    for (let i = 0; i < 50; i++) s = recordReview(s, { lane: 'standard', swapped: false, approved: true })
    expect(s.reviewedLog.length).toBe(50)
    expect(trailingSwapRate(s.reviewedLog)).toBe(0)
  })
})

describe('demotions', () => {
  it('any audit intervention drops Stage 2 → 1 immediately, with a logged reason', () => {
    let s = afterN(STREAK_TO_STAGE2)
    expect(s.stage).toBe(2)
    s = applyIntervention(s, 'pulled')
    expect(s.stage).toBe(1)
    expect(s.currentStreak).toBe(0)
    expect(s.demotions.at(-1)?.reason).toBe('audit pulled')
  })
  it('Stage 3 intervention drops to Stage 2 (not 1) when swap rate is fine', () => {
    let s = afterN(STREAK_TO_STAGE2)
    s = { ...s, stage: 3 }
    s = applyIntervention(s, 'swapped')
    expect(s.stage).toBe(2)
  })
  it('a swap-rate breach during ongoing reviews demotes to Stage 1', () => {
    let s = afterN(STREAK_TO_STAGE2)
    expect(s.stage).toBe(2)
    // burst of swap-heavy reviews pushes trailing rate over 10%
    for (let i = 0; i < 5; i++) s = recordReview(s, { lane: 'standard', swapped: true, approved: true })
    expect(s.stage).toBe(1)
    expect(s.demotions.at(-1)?.reason).toMatch(/trailing swap rate/)
  })
})

describe('Stage 3 promotion', () => {
  it('requires 30 consecutive clean days in Stage 2', () => {
    let s = afterN(STREAK_TO_STAGE2)
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 86400000).toISOString()
    s = { ...s, stage2Since: thirtyOneDaysAgo }
    expect(checkStage3Promotion(s).stage).toBe(3)
  })
  it('is blocked by an intervention inside the window', () => {
    let s = afterN(STREAK_TO_STAGE2)
    s = {
      ...s,
      stage2Since: new Date(Date.now() - 31 * 86400000).toISOString(),
      lastInterventionAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    }
    expect(checkStage3Promotion(s).stage).toBe(2)
  })
  it('is not triggered early', () => {
    let s = afterN(STREAK_TO_STAGE2)
    s = { ...s, stage2Since: new Date(Date.now() - 10 * 86400000).toISOString() }
    expect(checkStage3Promotion(s).stage).toBe(2)
  })
})

describe('dashboard progress', () => {
  it('describes the next trigger per stage', () => {
    expect(autonomyProgress(emptyAutonomy()).nextTrigger).toMatch(/Stage 2 at 10/)
    const s2 = afterN(STREAK_TO_STAGE2)
    expect(autonomyProgress(s2).nextTrigger).toMatch(/Stage 3 after 30 clean days/)
    expect(autonomyProgress({ ...s2, stage: 3 }).nextTrigger).toMatch(/autonomous/i)
  })
})
