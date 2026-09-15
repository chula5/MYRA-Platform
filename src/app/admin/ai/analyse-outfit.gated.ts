'use server'

// The browser-callable surface of ./analyse-outfit.ts — admin only. Every export here
// checks the admin before doing anything. Server code that runs without an
// admin session (cron, lib, /me actions) imports ./analyse-outfit directly instead.

import { assertAdmin } from '@/lib/admin-audit'
import * as impl from './analyse-outfit'

export async function analyseOutfit(...args: Parameters<typeof impl.analyseOutfit>): Promise<Awaited<ReturnType<typeof impl.analyseOutfit>>> {
  await assertAdmin()
  return impl.analyseOutfit(...args)
}
