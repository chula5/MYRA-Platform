'use server'

// The browser-callable surface of ./analyse-image.ts — admin only. Every export here
// checks the admin before doing anything. Server code that runs without an
// admin session (cron, lib, /me actions) imports ./analyse-image directly instead.

import { assertAdmin } from '@/lib/admin-audit'
import * as impl from './analyse-image'

export async function analyseProductImage(...args: Parameters<typeof impl.analyseProductImage>): Promise<Awaited<ReturnType<typeof impl.analyseProductImage>>> {
  await assertAdmin()
  return impl.analyseProductImage(...args)
}
