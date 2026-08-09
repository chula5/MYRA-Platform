'use server'

import { revalidatePath } from 'next/cache'
import { recomputeStyleModel } from '@/lib/style-brain-store'
import { createAdminClient } from '@/lib/supabase-server'
import { buildCalibrationReport } from '@/lib/calibration'

// Rebuild the learned model from the full decision log (e.g. after the feature
// logic changes). Returns how many decisions were processed.
export async function recomputeAction(): Promise<{ count?: number; error?: string }> {
  try {
    const count = await recomputeStyleModel()
    revalidatePath('/admin/style-brain')
    return { count }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Recompute failed' }
  }
}

// Quarantine verdicts — the weekly "retire or keep?" list.
// RETIRE archives the item (out of every pool, kept in existing live outfits).
export async function retireQuarantinedItem(itemId: string): Promise<{ ok?: true; error?: string }> {
  try {
    const admin = createAdminClient()
    const { error } = await (admin.from('item') as any).update({ status: 'archived' }).eq('item_id', itemId)
    if (error) throw error
    revalidatePath('/admin/style-brain')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Retire failed' }
  }
}

// KEEP wipes the item's ejection history — its counter restarts from zero and
// it re-enters the composer pools.
export async function keepQuarantinedItem(itemId: string): Promise<{ ok?: true; error?: string }> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('item_ejection' as any).delete().eq('item_id', itemId)
    if (error) throw error
    revalidatePath('/admin/style-brain')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Keep failed' }
  }
}

// Generate this week's calibration report on demand (the Monday cron does the
// same automatically).
export async function generateCalibrationReport(): Promise<{ ok?: true; error?: string }> {
  const res = await buildCalibrationReport()
  if (!res) return { error: 'Report failed' }
  revalidatePath('/admin/style-brain')
  return { ok: true }
}
