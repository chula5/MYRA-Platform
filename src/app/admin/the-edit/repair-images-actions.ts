'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { isCloudinaryUrl, persistImageToCloudinary } from '@/lib/cloudinary-persist'

/**
 * Migrate live outfits whose display image is NOT hosted on Cloudinary
 * (raw retailer URLs, ephemeral generation CDNs) onto Cloudinary, so the
 * public feed stops depending on hosts that block hotlinking / the image
 * optimizer. Processes a small batch per call to stay inside serverless
 * time limits — click again until `remaining` is 0.
 */
export async function repairLiveOutfitImages(
  batch = 8,
): Promise<{ repaired: number; failed: number; remaining: number; error?: string }> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('outfit')
      .select('outfit_id, image_url')
      .eq('status', 'live')
      .order('created_at', { ascending: false })
    if (error) throw error

    const rows = (data ?? []) as unknown as Array<{ outfit_id: string; image_url: string | null }>
    const broken = rows.filter(
      (o) => o.image_url && /^https?:\/\//i.test(o.image_url) && !isCloudinaryUrl(o.image_url),
    )

    let repaired = 0
    let failed = 0
    for (const o of broken.slice(0, batch)) {
      const stable = await persistImageToCloudinary(o.image_url as string, {
        folder: 'outfit-saves',
        publicId: `outfit-${o.outfit_id}`,
      })
      if (stable) {
        const { error: upErr } = await (supabase.from('outfit') as any)
          .update({ image_url: stable })
          .eq('outfit_id', o.outfit_id)
        if (upErr) failed++
        else repaired++
      } else {
        failed++
      }
    }

    if (repaired > 0) {
      revalidatePath('/')
      revalidatePath('/admin/the-edit')
    }

    return { repaired, failed, remaining: Math.max(0, broken.length - repaired - failed) }
  } catch (err: unknown) {
    console.error('[repairLiveOutfitImages]', err)
    return { repaired: 0, failed: 0, remaining: 0, error: err instanceof Error ? err.message : 'Repair failed' }
  }
}
