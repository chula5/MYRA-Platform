'use server'

// The browser-callable surface of ./stock-check.ts — admin only. Every export here
// checks the admin before doing anything. Server code that runs without an
// admin session (cron, lib, /me actions) imports ./stock-check directly instead.

import { assertAdmin } from '@/lib/admin-audit'
import * as impl from './stock-check'

export async function checkItemStock(...args: Parameters<typeof impl.checkItemStock>): Promise<Awaited<ReturnType<typeof impl.checkItemStock>>> {
  await assertAdmin()
  return impl.checkItemStock(...args)
}

export async function listItemsForStockSweep(...args: Parameters<typeof impl.listItemsForStockSweep>): Promise<Awaited<ReturnType<typeof impl.listItemsForStockSweep>>> {
  await assertAdmin()
  return impl.listItemsForStockSweep(...args)
}
