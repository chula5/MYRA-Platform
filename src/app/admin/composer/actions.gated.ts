'use server'

// The browser-callable surface of ./actions.ts — admin only. Every export here
// checks the admin before doing anything. Server code that runs without an
// admin session (cron, lib, /me actions) imports ./actions directly instead.

import { assertAdmin } from '@/lib/admin-audit'
import * as impl from './actions'

export async function approveCandidate(...args: Parameters<typeof impl.approveCandidate>): Promise<Awaited<ReturnType<typeof impl.approveCandidate>>> {
  await assertAdmin()
  return impl.approveCandidate(...args)
}

export async function composeForAnchor(...args: Parameters<typeof impl.composeForAnchor>): Promise<Awaited<ReturnType<typeof impl.composeForAnchor>>> {
  await assertAdmin()
  return impl.composeForAnchor(...args)
}

export async function getSwapOptions(...args: Parameters<typeof impl.getSwapOptions>): Promise<Awaited<ReturnType<typeof impl.getSwapOptions>>> {
  await assertAdmin()
  return impl.getSwapOptions(...args)
}

export async function recordFastLaneOutcome(...args: Parameters<typeof impl.recordFastLaneOutcome>): Promise<Awaited<ReturnType<typeof impl.recordFastLaneOutcome>>> {
  await assertAdmin()
  return impl.recordFastLaneOutcome(...args)
}

export async function recordReviewOutcome(...args: Parameters<typeof impl.recordReviewOutcome>): Promise<Awaited<ReturnType<typeof impl.recordReviewOutcome>>> {
  await assertAdmin()
  return impl.recordReviewOutcome(...args)
}

export async function recordSkipDecision(...args: Parameters<typeof impl.recordSkipDecision>): Promise<Awaited<ReturnType<typeof impl.recordSkipDecision>>> {
  await assertAdmin()
  return impl.recordSkipDecision(...args)
}

export async function recordSwap(...args: Parameters<typeof impl.recordSwap>): Promise<Awaited<ReturnType<typeof impl.recordSwap>>> {
  await assertAdmin()
  return impl.recordSwap(...args)
}

export async function rescoreCandidate(...args: Parameters<typeof impl.rescoreCandidate>): Promise<Awaited<ReturnType<typeof impl.rescoreCandidate>>> {
  await assertAdmin()
  return impl.rescoreCandidate(...args)
}

export async function searchAnchorItems(...args: Parameters<typeof impl.searchAnchorItems>): Promise<Awaited<ReturnType<typeof impl.searchAnchorItems>>> {
  await assertAdmin()
  return impl.searchAnchorItems(...args)
}
