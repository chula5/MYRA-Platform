'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase-server'
import { syncAllNetworks, syncNetwork, type SyncOutcome } from '@/lib/networks/sync'
import { fetchMetaSpend, backfillAdSpend } from '@/lib/networks/meta-ads'
import type { NetworkId } from '@/lib/networks/types'

/** Every action here reads live money data — gate on the admin user, not just RLS. */
async function assertAdmin(): Promise<void> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) throw new Error('Not authorised')
}

export async function syncCommissions(network?: NetworkId, days = 60): Promise<SyncOutcome[]> {
  await assertAdmin()
  const out = network ? [await syncNetwork(network, days)] : await syncAllNetworks(days)
  revalidatePath('/admin/commissions')
  revalidatePath('/admin')
  return out
}

export async function syncMetaSpend(days = 60): Promise<{ status: string; rows: number; message?: string }> {
  await assertAdmin()

  const result = await fetchMetaSpend(days)
  if (!result.ok) {
    return {
      status: result.reason,
      rows: 0,
      message: result.reason === 'not_configured' ? `Missing: ${result.missing.join(', ')}` : result.message,
    }
  }

  const written = await backfillAdSpend(result.rows)
  revalidatePath('/admin/ad-spend')
  revalidatePath('/admin')
  if (written.error) return { status: 'error', rows: 0, message: written.error }
  return { status: 'ok', rows: written.written }
}
