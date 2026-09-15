'use server'

// The browser-callable surface of ./higgsfield-actions.ts — admin only. Every export here
// checks the admin before doing anything. Server code that runs without an
// admin session (cron, lib, /me actions) imports ./higgsfield-actions directly instead.

import { assertAdmin } from '@/lib/admin-audit'
import * as impl from './higgsfield-actions'

export async function generateHiggsfieldShoot(...args: Parameters<typeof impl.generateHiggsfieldShoot>): Promise<Awaited<ReturnType<typeof impl.generateHiggsfieldShoot>>> {
  await assertAdmin()
  return impl.generateHiggsfieldShoot(...args)
}

export async function generateHiggsfieldShootForOutfit(...args: Parameters<typeof impl.generateHiggsfieldShootForOutfit>): Promise<Awaited<ReturnType<typeof impl.generateHiggsfieldShootForOutfit>>> {
  await assertAdmin()
  return impl.generateHiggsfieldShootForOutfit(...args)
}
