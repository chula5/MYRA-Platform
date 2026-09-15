// Vision-score every inspiration picture still pending for a house style.
//
// A plain server module: the admin action (stylists/inspiration-actions.ts,
// admin-gated) and a client's own INSPIRATION uploads (app/me/inspiration/
// board-actions.ts, member-checked) both call this after checking who is
// asking. Nothing here is browser-callable.

import 'server-only'
import { analyseInspirationImage } from '@/app/admin/ai/analyse-inspiration'
import { vectorFromInspiration, type InspirationScores } from '@/lib/inspiration'

export async function scorePendingInspiration(
  admin: any,
  personaId: string,
  limit = 40,
): Promise<{ scored?: number; failed?: number; error?: string }> {
  try {
    const { data: pending, error } = await admin
      .from('inspiration_image')
      .select('image_id, image_url')
      .eq('persona_id', personaId)
      .eq('status', 'pending_scoring')
      .limit(limit)
    if (error) return { error: error.message }
    if (!pending?.length) return { scored: 0, failed: 0 }

    let scored = 0
    let failed = 0
    for (const row of pending) {
      const { data: a, error: verr } = await analyseInspirationImage(row.image_url)
      if (verr || !a) {
        failed++
        await admin.from('inspiration_image')
          .update({ scoring_error: verr ?? 'Vision pass returned nothing', updated_at: new Date().toISOString() })
          .eq('image_id', row.image_id)
        continue
      }
      const scores: InspirationScores = {
        construction: a.construction, volume: a.volume, colour_story: a.colour_story,
        surface_story: a.surface_story, pattern: a.pattern, colour_depth: a.colour_depth,
        sheen: a.sheen, formality: a.formality, item_types: a.item_types,
      }
      await admin.from('inspiration_image').update({
        status: 'scored',
        scores,
        scores_original: scores, // frozen: corrections stay measurable against it
        occasion_read: a.occasion_read,
        score_confidence: a.score_confidence,
        vector: vectorFromInspiration(scores, a.occasion_read),
        scoring_error: null,
        updated_at: new Date().toISOString(),
      }).eq('image_id', row.image_id)
      scored++
    }
    return { scored, failed }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Scoring failed' }
  }
}
