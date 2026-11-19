// STYLE INFLUENCES — the database side. A plain server module: the admin page
// (app/admin/influences, admin-gated) and a member's own picker (app/me,
// member-checked) both call in here after checking who is asking.

import 'server-only'
import { analyseInspirationImage } from '@/app/admin/ai/analyse-inspiration'
import { computeEnvelope, sampleLooks, vectorFromInspiration, type InspirationScores } from '@/lib/inspiration'
import { parseInfluenceBrief, influenceBriefIsEmpty, influenceBriefText, type StyleInfluence } from '@/lib/style-influence'

export function normaliseInfluence(r: any): StyleInfluence {
  return {
    influence_id: r.influence_id,
    name: r.name,
    slug: r.slug,
    kind: r.kind,
    handle: r.handle ?? null,
    image_url: r.image_url ?? null,
    brief: parseInfluenceBrief(r.brief),
    status: r.status,
  }
}

/** Vision-score an influence's pending pictures, then recompute its envelope. */
export async function scorePendingInfluenceImages(
  admin: any,
  influenceId: string,
  limit = 40,
): Promise<{ scored: number; failed: number }> {
  const { data: pending } = await admin
    .from('style_influence_image')
    .select('image_id, image_url')
    .eq('influence_id', influenceId)
    .eq('status', 'pending_scoring')
    .limit(limit)
  let scored = 0
  let failed = 0
  for (const row of (pending ?? []) as any[]) {
    const { data: a, error } = await analyseInspirationImage(row.image_url)
    if (error || !a) {
      failed++
      await admin.from('style_influence_image')
        .update({ scoring_error: error ?? 'Vision pass returned nothing', updated_at: new Date().toISOString() })
        .eq('image_id', row.image_id)
      continue
    }
    const scores: InspirationScores = {
      construction: a.construction, volume: a.volume, colour_story: a.colour_story,
      surface_story: a.surface_story, pattern: a.pattern, colour_depth: a.colour_depth,
      sheen: a.sheen, formality: a.formality, item_types: a.item_types,
    }
    await admin.from('style_influence_image').update({
      status: 'scored',
      scores,
      occasion_read: a.occasion_read,
      score_confidence: a.score_confidence,
      vector: vectorFromInspiration(scores, a.occasion_read),
      scoring_error: null,
      updated_at: new Date().toISOString(),
    }).eq('image_id', row.image_id)
    scored++
  }
  await recomputeInfluenceEnvelope(admin, influenceId)
  return { scored, failed }
}

/**
 * Mean + spread of every scored picture, and the pictures kept whole beside it
 * (the same shape as a stylist's envelope). One picture is enough: an influence
 * is reference she chose, not a style that has to earn go-live.
 */
export async function recomputeInfluenceEnvelope(admin: any, influenceId: string): Promise<number> {
  const { data } = await admin.from('style_influence_image')
    .select('vector').eq('influence_id', influenceId).eq('status', 'scored')
  const vectors = ((data ?? []) as any[]).map((r) => r.vector).filter((v) => Array.isArray(v) && v.length)
  const env = vectors.length ? computeEnvelope(vectors, 1) : null
  await admin.from('style_influence').update({
    envelope: env ? { mean: env.mean, spread: env.spread, looks: sampleLooks(vectors), n: vectors.length } : null,
    updated_at: new Date().toISOString(),
  }).eq('influence_id', influenceId)
  return vectors.length
}

export interface MemberInfluence extends StyleInfluence {
  source: 'chloe' | 'member' | 'application'
  envelope: { mean: number[]; spread: number[]; looks?: number[][] } | null
}

/** The people a member is inspired by, in the order she named them. */
export async function loadMemberInfluences(admin: any, memberId: string): Promise<MemberInfluence[]> {
  const { data, error } = await admin
    .from('member_style_influence')
    .select('source, created_at, influence:influence_id(*)')
    .eq('member_id', memberId)
    .order('created_at', { ascending: true })
  // Before migration 0109 runs there is no table: no influences, nothing breaks.
  if (error) return []
  return ((data ?? []) as any[])
    .filter((r) => r.influence)
    .map((r) => ({
      ...normaliseInfluence(r.influence),
      source: r.source,
      envelope: r.influence.envelope?.mean?.length ? r.influence.envelope : null,
    }))
}

/**
 * Her influences as one lens: every scored picture of every person she named,
 * pooled into one envelope plus the looks kept whole. Null when none of them
 * has a scored picture yet — a name alone reaches the words, not the numbers.
 */
export function influenceLens(influences: MemberInfluence[], weight: number):
  { envelope: { mean: number[]; spread: number[] }; looks: number[][] | null; weight: number } | null {
  const withEnv = influences.filter((i) => i.envelope)
  if (!withEnv.length) return null
  const looks = withEnv.flatMap((i) => (i.envelope!.looks ?? []).filter((v) => Array.isArray(v) && v.length))
  // Pool the looks when we have them; otherwise average the means (older rows).
  const env = looks.length ? computeEnvelope(looks, 1) : computeEnvelope(withEnv.map((i) => i.envelope!.mean), 1)
  if (!env) return null
  return { envelope: { mean: env.mean, spread: env.spread }, looks: looks.length ? sampleLooks(looks) : null, weight }
}

/** Her influences in words, for member-memory and the look check. */
export function influencesText(influences: MemberInfluence[]): string {
  if (!influences.length) return ''
  const lines = influences.map((i) =>
    influenceBriefIsEmpty(i.brief) ? i.name : influenceBriefText(i.name, i.brief))
  return `${lines.join(' | ')}. Borrow their eye — the shapes, palette and finish — in pieces she can buy; never costume, never a copy of a red-carpet look.`
}
