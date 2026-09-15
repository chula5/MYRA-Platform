'use server'

// The browser-callable surface of ./occasion-tags.ts — admin only. Every export here
// checks the admin before doing anything. Server code that runs without an
// admin session (cron, lib, /me actions) imports ./occasion-tags directly instead.

import { assertAdmin } from '@/lib/admin-audit'
import * as impl from './occasion-tags'

export async function generateOccasionTags(...args: Parameters<typeof impl.generateOccasionTags>): Promise<Awaited<ReturnType<typeof impl.generateOccasionTags>>> {
  await assertAdmin()
  return impl.generateOccasionTags(...args)
}
