'use server'

// The browser-callable surface of ./ask-actions.ts — admin only.

import { assertAdmin } from '@/lib/admin-audit'
import * as impl from './ask-actions'

export async function composeFromAsk(...args: Parameters<typeof impl.composeFromAsk>): Promise<Awaited<ReturnType<typeof impl.composeFromAsk>>> {
  await assertAdmin()
  return impl.composeFromAsk(...args)
}
