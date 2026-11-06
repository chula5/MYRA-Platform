'use server'

// BLACK FRIDAY admin: pause a brand's sale (never shown, never told) or let it run.

import { revalidatePath } from 'next/cache'
import { assertAdmin } from '@/lib/admin-audit'
import { createAdminClient } from '@/lib/supabase-server'

export async function setSalePaused(brandId: string, paused: boolean): Promise<{ error?: string }> {
  await assertAdmin()
  const { error } = await (createAdminClient() as any).from('brand_sale')
    .update({ paused, updated_at: new Date().toISOString() }).eq('brand_id', brandId)
  revalidatePath('/admin/sales')
  return error ? { error: error.message } : {}
}
