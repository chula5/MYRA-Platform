'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

export async function addOutfitToLookbook(
  outfitId: string,
  lookbookId: string,
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const { error } = await supabase
      .from('lookbook_outfit')
      .insert({ outfit_id: outfitId, lookbook_id: lookbookId })
    if (error) throw error
    revalidatePath('/')
    return {}
  } catch (err: unknown) {
    console.error('[addOutfitToLookbook]', err)
    return { error: err instanceof Error ? err.message : 'Failed to add to lookbook' }
  }
}

export async function removeOutfitFromLookbook(
  outfitId: string,
  lookbookId: string,
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const { error } = await supabase
      .from('lookbook_outfit')
      .delete()
      .eq('outfit_id', outfitId)
      .eq('lookbook_id', lookbookId)
    if (error) throw error
    revalidatePath('/')
    return {}
  } catch (err: unknown) {
    console.error('[removeOutfitFromLookbook]', err)
    return { error: err instanceof Error ? err.message : 'Failed to remove from lookbook' }
  }
}
