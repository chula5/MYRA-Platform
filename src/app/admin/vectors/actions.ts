'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { analyseOutfit } from '@/app/admin/ai/analyse-outfit'

// Re-score one outfit by scanning its IMAGE with Claude vision and writing the
// occasion + construction scores back onto the row. Preserves the curated
// occasion_tags and aesthetic_label — only the numeric scores are updated.
// (dress_* columns don't exist on the outfit table, so they're excluded.)
export async function rescoreOutfitFromImage(
  outfitId: string,
): Promise<{ ok?: true; formality?: number; time_of_day?: number; error?: string }> {
  try {
    const admin = createAdminClient()
    const { data: o } = await admin
      .from('outfit')
      .select('outfit_id, image_url')
      .eq('outfit_id', outfitId)
      .maybeSingle()
    const imageUrl = (o as any)?.image_url
    if (!imageUrl) return { error: 'No image to scan' }

    const { data: a, error } = await analyseOutfit(imageUrl)
    if (error || !a) return { error: error ?? 'Vision analysis failed' }

    const update: Record<string, number | null> = {
      // Occasion scores — read from the image (the whole point of this pass).
      formality: a.formality,
      planning: a.planning,
      wearer_priority: a.wearer_priority,
      time_of_day: a.time_of_day,
      // Outfit-level construction scores.
      construction: a.construction,
      surface_story: a.surface_story,
      volume: a.volume,
      colour_story: a.colour_story,
      intent: a.intent,
      // Slot scores (nullable; only the columns that exist on the table).
      outerwear_construction: a.outerwear_construction,
      outerwear_volume: a.outerwear_volume,
      outerwear_material_weight: a.outerwear_material_weight,
      outerwear_material_formality: a.outerwear_material_formality,
      top_construction: a.top_construction,
      top_volume: a.top_volume,
      top_material_weight: a.top_material_weight,
      top_material_formality: a.top_material_formality,
      bottom_construction: a.bottom_construction,
      bottom_volume: a.bottom_volume,
      bottom_rise: a.bottom_rise,
      bottom_leg_opening: a.bottom_leg_opening,
      bottom_material_weight: a.bottom_material_weight,
      shoe_formality: a.shoe_formality,
      shoe_style: a.shoe_style,
      bag_formality: a.bag_formality,
      jewellery_scale: a.jewellery_scale,
      jewellery_formality: a.jewellery_formality,
    }

    const { error: upErr } = await (admin.from('outfit') as any).update(update).eq('outfit_id', outfitId)
    if (upErr) return { error: upErr.message }

    return { ok: true, formality: a.formality, time_of_day: a.time_of_day }
  } catch (err) {
    console.error('[rescoreOutfitFromImage]', err)
    return { error: err instanceof Error ? err.message : 'Failed' }
  }
}
