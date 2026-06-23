'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'

export interface ClipInput {
  title: string
  caption: string
  videoUrl: string
  posterUrl: string
  sortOrder: number
}

export async function addClip(input: ClipInput): Promise<{ error?: string }> {
  try {
    if (!input.title.trim() || !input.videoUrl.trim()) return { error: 'Title and video link are required' }
    const admin = createAdminClient()
    const { error } = await (admin.from('product_view_clip') as any).insert({
      title: input.title.trim(),
      caption: input.caption.trim() || null,
      video_url: input.videoUrl.trim(),
      poster_url: input.posterUrl.trim() || null,
      sort_order: input.sortOrder ?? 0,
    })
    if (error) throw error
    revalidatePath('/admin/product-view')
    return {}
  } catch (err: unknown) {
    console.error('[addClip]', err)
    return { error: err instanceof Error ? err.message : 'Failed to add clip' }
  }
}

export async function updateClip(clipId: string, input: ClipInput): Promise<{ error?: string }> {
  try {
    if (!input.title.trim() || !input.videoUrl.trim()) return { error: 'Title and video link are required' }
    const admin = createAdminClient()
    const { error } = await (admin.from('product_view_clip') as any)
      .update({
        title: input.title.trim(),
        caption: input.caption.trim() || null,
        video_url: input.videoUrl.trim(),
        poster_url: input.posterUrl.trim() || null,
        sort_order: input.sortOrder ?? 0,
      })
      .eq('clip_id', clipId)
    if (error) throw error
    revalidatePath('/admin/product-view')
    return {}
  } catch (err: unknown) {
    console.error('[updateClip]', err)
    return { error: err instanceof Error ? err.message : 'Failed to update clip' }
  }
}

export async function deleteClip(clipId: string): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('product_view_clip').delete().eq('clip_id', clipId)
    if (error) throw error
    revalidatePath('/admin/product-view')
    return {}
  } catch (err: unknown) {
    console.error('[deleteClip]', err)
    return { error: err instanceof Error ? err.message : 'Failed to delete clip' }
  }
}
