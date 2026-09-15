'use server'

// The browser-callable surface of ./actions.ts — admin only. Every export here
// checks the admin before doing anything. Server code that runs without an
// admin session (cron, lib, /me actions) imports ./actions directly instead.

import { assertAdmin } from '@/lib/admin-audit'
import * as impl from './actions'

export async function rescoreOutfitFromImage(...args: Parameters<typeof impl.rescoreOutfitFromImage>): Promise<Awaited<ReturnType<typeof impl.rescoreOutfitFromImage>>> {
  await assertAdmin()
  return impl.rescoreOutfitFromImage(...args)
}
