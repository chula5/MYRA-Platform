'use server'

import { revalidatePath } from 'next/cache'
import { recomputeStyleModel } from '@/lib/style-brain-store'

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
