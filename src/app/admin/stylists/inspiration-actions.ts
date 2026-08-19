'use server'

// INSPIRATION PIPELINE — a persona's moodboard as scored, reviewable records.
//
//   ingest → re-host on Cloudinary → vision-score → review + correct → confirm
//   → envelope (confirmed only) → proposed rules → the existing mask/seed/live steps
//
// Two rules hold this together:
//   · Only CONFIRMED images shape the envelope. Pending and rejected images
//     have no influence at all.
//   · After go-live the envelope never moves silently. New confirmed images
//     recompute it and flag the persona "needs_review" instead.

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { persistImageToCloudinary } from '@/lib/cloudinary-persist'
import { analyseInspirationImage } from '@/app/admin/ai/analyse-inspiration'
import { getStylist } from '@/lib/stylist-store'
import {
  computeEnvelope,
  envelopeToRange,
  proposeRulesFromEnvelope,
  vectorFromInspiration,
  occasionProfile,
  MIN_CONFIRMED_IMAGES,
  type InspirationImage,
  type InspirationScores,
  type InspirationSource,
} from '@/lib/inspiration'

const PATH = '/admin/stylists'

function normaliseRow(r: any): InspirationImage {
  return {
    image_id: r.image_id,
    persona_id: r.persona_id,
    user_id: r.user_id ?? null,
    image_url: r.image_url,
    source_url: r.source_url ?? null,
    source: r.source,
    status: r.status,
    scores: r.scores ?? null,
    scores_original: r.scores_original ?? null,
    corrected_fields: r.corrected_fields ?? [],
    corrected_at: r.corrected_at ?? null,
    occasion_read: r.occasion_read ?? null,
    score_confidence: r.score_confidence ?? null,
    vector: Array.isArray(r.vector) ? r.vector : null,
    scoring_error: r.scoring_error ?? null,
    created_at: r.created_at,
  }
}

/** Review order: lowest confidence first — weak reads need eyes most. */
export async function loadInspirationImages(personaId: string): Promise<{
  images: InspirationImage[]
  confirmed: number
  minRequired: number
  error?: string
}> {
  try {
    const admin = createAdminClient() as any
    const { data, error } = await admin
      .from('inspiration_image')
      .select('*')
      .eq('persona_id', personaId)
      .order('score_confidence', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
    if (error) return { images: [], confirmed: 0, minRequired: MIN_CONFIRMED_IMAGES, error: error.message }
    const images = (data ?? []).map(normaliseRow)
    return {
      images,
      confirmed: images.filter((i: InspirationImage) => i.status === 'confirmed').length,
      minRequired: MIN_CONFIRMED_IMAGES,
    }
  } catch (err) {
    return { images: [], confirmed: 0, minRequired: MIN_CONFIRMED_IMAGES, error: err instanceof Error ? err.message : 'Load failed' }
  }
}

/**
 * Step 1 — ingest moodboard URLs. Every image is re-hosted on Cloudinary before
 * it is stored: borrowed links rot, hotlink-block, and change underneath you,
 * and an envelope built on images that later 404 can't be re-examined.
 */
export async function ingestInspirationImages(
  personaId: string,
  urls: string[],
  source: InspirationSource = 'curator_seed',
  userId?: string | null,
): Promise<{ added?: number; failed?: number; error?: string }> {
  try {
    const clean = urls.map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u))
    if (!clean.length) return { error: 'No usable image URLs' }
    const admin = createAdminClient() as any

    const { data: existing } = await admin
      .from('inspiration_image').select('source_url').eq('persona_id', personaId)
    const seen = new Set((existing ?? []).map((r: any) => r.source_url).filter(Boolean))

    const rows: any[] = []
    let failed = 0
    for (const url of clean) {
      if (seen.has(url)) continue
      const hosted = await persistImageToCloudinary(url, {
        folder: `inspiration/${personaId}`,
        publicId: `insp-${personaId.slice(0, 8)}-${rows.length}-${Date.now()}`,
      })
      if (!hosted) { failed++; continue }
      rows.push({
        persona_id: personaId,
        user_id: userId ?? null,
        image_url: hosted,
        source_url: url,
        source,
        status: 'pending_scoring',
      })
    }
    if (rows.length) {
      const { error } = await admin.from('inspiration_image').insert(rows)
      if (error) return { error: error.message }
    }
    revalidatePath(PATH)
    return { added: rows.length, failed }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Ingest failed' }
  }
}

/** Step 2 — vision-score everything still pending. */
export async function scoreInspirationImages(
  personaId: string,
  limit = 40,
): Promise<{ scored?: number; failed?: number; error?: string }> {
  try {
    const admin = createAdminClient() as any
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
    revalidatePath(PATH)
    return { scored, failed }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Scoring failed' }
  }
}

/**
 * Step 3 — a correction from the review grid. The original vision output is
 * never overwritten; corrected_fields records exactly what a human disagreed
 * with, which is the training signal for the scorer.
 */
export async function correctInspirationScores(
  imageId: string,
  patch: Partial<InspirationScores>,
): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient() as any
    const { data: row, error } = await admin
      .from('inspiration_image').select('*').eq('image_id', imageId).single()
    if (error || !row) return { error: error?.message ?? 'Image not found' }

    const current: InspirationScores = row.scores ?? {}
    const next: InspirationScores = { ...current, ...patch }
    const original: InspirationScores = row.scores_original ?? current

    const corrected = new Set<string>(row.corrected_fields ?? [])
    for (const key of Object.keys(patch) as (keyof InspirationScores)[]) {
      const a = JSON.stringify((original as any)[key] ?? null)
      const b = JSON.stringify((next as any)[key] ?? null)
      if (a === b) corrected.delete(key as string)
      else corrected.add(key as string)
    }

    await admin.from('inspiration_image').update({
      scores: next,
      corrected_fields: Array.from(corrected),
      corrected_at: corrected.size ? new Date().toISOString() : null,
      // The vector must follow the corrected reading, not the original.
      vector: vectorFromInspiration(next, row.occasion_read ?? []),
      updated_at: new Date().toISOString(),
    }).eq('image_id', imageId)

    revalidatePath(PATH)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Correction failed' }
  }
}

/** Confirm or reject a reviewed image. Only confirmed images reach the envelope. */
export async function setInspirationStatus(
  imageId: string,
  status: 'confirmed' | 'rejected' | 'scored',
): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient() as any
    const { data: row } = await admin
      .from('inspiration_image').select('persona_id').eq('image_id', imageId).single()
    const { error } = await admin.from('inspiration_image')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('image_id', imageId)
    if (error) return { error: error.message }

    // A live persona whose confirmed set changed must not drift silently.
    if (row?.persona_id) await flagIfLive(admin, row.persona_id)
    revalidatePath(PATH)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Update failed' }
  }
}

/** Bulk confirm — for a grid where most reads were right. */
export async function confirmAllScored(personaId: string): Promise<{ confirmed?: number; error?: string }> {
  try {
    const admin = createAdminClient() as any
    const { data, error } = await admin.from('inspiration_image')
      .update({ status: 'confirmed', updated_at: new Date().toISOString() })
      .eq('persona_id', personaId)
      .eq('status', 'scored')
      .select('image_id')
    if (error) return { error: error.message }
    await flagIfLive(admin, personaId)
    revalidatePath(PATH)
    return { confirmed: (data ?? []).length }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Bulk confirm failed' }
  }
}

async function flagIfLive(admin: any, personaId: string): Promise<void> {
  const { data } = await admin.from('stylist').select('status, envelope').eq('stylist_id', personaId).single()
  if (data?.status === 'live' && data?.envelope) {
    await admin.from('stylist')
      .update({ envelope_status: 'needs_review', updated_at: new Date().toISOString() })
      .eq('stylist_id', personaId)
  }
}

/**
 * Step 4 — the persona constitution. Envelope from CONFIRMED images only:
 * per-dimension mean (the centre) and spread (the tolerance). The spread is
 * carried into the range rather than replaced by one global margin.
 *
 * Step 5 — from the envelope, propose the rules for the existing edit + confirm
 * step. An existing hand-edited constitution is never overwritten.
 */
export async function recomputeEnvelope(personaId: string): Promise<{
  confirmed?: number
  tightness?: number
  belowMinimum?: boolean
  error?: string
}> {
  try {
    const admin = createAdminClient() as any
    const { data, error } = await admin
      .from('inspiration_image')
      .select('vector, scores, occasion_read')
      .eq('persona_id', personaId)
      .eq('status', 'confirmed')
    if (error) return { error: error.message }

    const rows = data ?? []
    const vectors = rows.map((r: any) => r.vector).filter((v: any) => Array.isArray(v))
    const env = computeEnvelope(vectors, 1)
    if (!env) return { confirmed: 0, belowMinimum: true, error: 'No confirmed images with vectors yet' }

    const itemTypeCounts: Record<string, number> = {}
    for (const r of rows) {
      for (const t of r.scores?.item_types ?? []) itemTypeCounts[t] = (itemTypeCounts[t] ?? 0) + 1
    }
    const occasions = occasionProfile(rows.map((r: any) => r.occasion_read ?? []))

    const stylist = await getStylist(personaId)
    const range = envelopeToRange(env)
    const proposed = proposeRulesFromEnvelope(env, itemTypeCounts)

    await admin.from('stylist').update({
      envelope: { ...env, item_types: itemTypeCounts, occasions },
      envelope_computed_at: new Date().toISOString(),
      envelope_status: 'current',
      vector_range: range,
      centroid: env.mean,
      // Only scaffold rules when Chloe hasn't written her own.
      constitution: stylist?.constitution ?? proposed,
      updated_at: new Date().toISOString(),
    }).eq('stylist_id', personaId)

    revalidatePath(PATH)
    return {
      confirmed: env.n,
      tightness: env.tightness,
      belowMinimum: env.n < MIN_CONFIRMED_IMAGES,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Envelope failed' }
  }
}

/** Guard for go-live: a persona needs a real moodboard behind it. */
export async function confirmedImageCount(personaId: string): Promise<number> {
  try {
    const admin = createAdminClient() as any
    const { count } = await admin
      .from('inspiration_image')
      .select('image_id', { count: 'exact', head: true })
      .eq('persona_id', personaId)
      .eq('status', 'confirmed')
    return count ?? 0
  } catch {
    return 0
  }
}
