'use server'

import { createServerClient, createAdminClient } from '@/lib/supabase-server'

// IDs of every outfit the current user has saved.
export async function getSavedOutfitIds(): Promise<string[]> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []
    const admin = createAdminClient()
    const { data } = await admin.from('saved_outfit').select('outfit_id').eq('user_id', user.id)
    return ((data ?? []) as { outfit_id: string }[]).map((r) => r.outfit_id)
  } catch {
    return []
  }
}

// Toggle a save. Returns the new saved state.
export async function toggleSaveOutfit(outfitId: string): Promise<{ saved?: boolean; error?: string }> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Not signed in' }
    const admin = createAdminClient()

    const { data: existing } = await admin
      .from('saved_outfit')
      .select('outfit_id')
      .eq('user_id', user.id)
      .eq('outfit_id', outfitId)
      .maybeSingle()

    if (existing) {
      await admin.from('saved_outfit').delete().eq('user_id', user.id).eq('outfit_id', outfitId)
      return { saved: false }
    }
    const { error } = await (admin.from('saved_outfit') as any).insert({ user_id: user.id, outfit_id: outfitId })
    if (error) throw error
    return { saved: true }
  } catch (err: unknown) {
    console.error('[toggleSaveOutfit]', err)
    return { error: err instanceof Error ? err.message : 'Failed to save' }
  }
}
