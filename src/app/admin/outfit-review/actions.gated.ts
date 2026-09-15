'use server'

// The browser-callable surface of ./actions.ts — admin only. Every export here
// checks the admin before doing anything. Server code that runs without an
// admin session (cron, lib, /me actions) imports ./actions directly instead.

import { assertAdmin } from '@/lib/admin-audit'
import * as impl from './actions'

export async function composeForReview(...args: Parameters<typeof impl.composeForReview>): Promise<Awaited<ReturnType<typeof impl.composeForReview>>> {
  await assertAdmin()
  return impl.composeForReview(...args)
}

export async function getReviewAddOptions(...args: Parameters<typeof impl.getReviewAddOptions>): Promise<Awaited<ReturnType<typeof impl.getReviewAddOptions>>> {
  await assertAdmin()
  return impl.getReviewAddOptions(...args)
}

export async function getReviewQueue(...args: Parameters<typeof impl.getReviewQueue>): Promise<Awaited<ReturnType<typeof impl.getReviewQueue>>> {
  await assertAdmin()
  return impl.getReviewQueue(...args)
}

export async function getReviewSwapOptions(...args: Parameters<typeof impl.getReviewSwapOptions>): Promise<Awaited<ReturnType<typeof impl.getReviewSwapOptions>>> {
  await assertAdmin()
  return impl.getReviewSwapOptions(...args)
}
