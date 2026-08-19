'use server'

// STYLIST ADMIN — persona seeding pipeline + Chloe backfill + brand demo.
//
// Personas: draft (name + moodboard) → vision-score the moodboard → proposed
// vector_range + draft constitution (edit + confirm) → auto item mask (manual
// overrides win) → seed styling sets composed under the persona's rules →
// reviewed in MY queue tagged with the persona → live.

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { analyseOutfit } from '@/app/admin/ai/analyse-outfit'
import { buildOutfitVector } from '@/lib/taste-vector'
import type { OutfitWithItems } from '@/types/database'
import {
  listStylists,
  getStylist,
  rangeFromVectors,
  scoreItemMaskForStylist,
  runChloeBackfill,
  loadAutonomy,
  type Stylist,
} from '@/lib/stylist-store'
import { composeStylingSet, composeBrandDemo } from '@/app/admin/pipeline/set-actions'
import { ingestInspirationImages, confirmedImageCount } from './inspiration-actions'
import { MIN_CONFIRMED_IMAGES } from '@/lib/inspiration'
import { CONSTITUTION_ARTICLES } from '@/lib/house-style'
import { autonomyProgress, type AutonomyProgress } from '@/lib/autonomy'

export interface StylistListEntry extends Stylist {
  autonomy: AutonomyProgress
  liveOutfits: number
  pendingSeeds: number
}

export async function loadStylistList(): Promise<StylistListEntry[]> {
  const stylists = await listStylists()
  const admin = createAdminClient()
  const out: StylistListEntry[] = []
  for (const s of stylists) {
    const [autonomyState, { count: liveOutfits }, { count: pendingSeeds }] = await Promise.all([
      loadAutonomy(s.stylist_id),
      admin.from('outfit' as any).select('*', { count: 'exact', head: true }).eq('stylist_id', s.stylist_id).eq('status', 'live'),
      admin.from('composed_outfit' as any).select('*', { count: 'exact', head: true }).eq('stylist_id', s.stylist_id).eq('status', 'pending'),
    ])
    out.push({
      ...s,
      autonomy: autonomyProgress(autonomyState),
      liveOutfits: liveOutfits ?? 0,
      pendingSeeds: pendingSeeds ?? 0,
    })
  }
  return out
}

const slugify = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

// Step 1 — create the persona in draft with its moodboard images.
export async function createPersonaDraft(
  name: string,
  moodboardUrls: string[],
): Promise<{ stylistId?: string; error?: string }> {
  try {
    if (!name.trim()) return { error: 'Name required' }
    const urls = moodboardUrls.map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u))
    const admin = createAdminClient()
    const { data, error } = await (admin.from('stylist') as any)
      .insert({
        name: name.trim(),
        slug: slugify(name),
        type: 'persona',
        status: 'draft',
        moodboard: urls.map((url) => ({ url })),
      })
      .select('stylist_id')
      .single()
    if (error) throw error
    // Personas always start at Stage 1 with their own independent learning state.
    await (admin.from('stylist_autonomy') as any).upsert(
      { stylist_id: (data as any).stylist_id, stage: 1 },
      { onConflict: 'stylist_id' },
    )
    // Moodboard images become scored, persistent records: re-hosted on
    // Cloudinary and queued for the vision pass. stylist.moodboard keeps the
    // raw URLs only as provenance for personas created before 0039.
    const stylistId = (data as any).stylist_id
    if (urls.length) await ingestInspirationImages(stylistId, urls, 'curator_seed')

    revalidatePath('/admin/stylists')
    return { stylistId }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Create failed' }
  }
}

// Step 2 — vision-score the moodboard into the 34-dim space → propose a
// vector_range (observed min/max + margin), centroid, and a draft constitution
// scaffolded from the House Style structure for Chloe to edit.
export async function scoreMoodboard(stylistId: string): Promise<{
  scored?: number
  failed?: number
  error?: string
}> {
  try {
    const stylist = await getStylist(stylistId)
    if (!stylist) return { error: 'Stylist not found' }
    if (!stylist.moodboard.length) return { error: 'No moodboard images — add some first' }

    const vectors: number[][] = []
    const scoredBoard: { url: string; vector?: number[] }[] = []
    let failed = 0
    for (const entry of stylist.moodboard.slice(0, 12)) {
      const { data: a, error } = await analyseOutfit(entry.url)
      if (error || !a) {
        failed++
        scoredBoard.push({ url: entry.url })
        continue
      }
      // The analysed outfit fields ARE outfit-row fields — build the vector
      // from a pseudo outfit (no items; item-driven dims sit neutral).
      const pseudo = { ...(a as any), occasion_tags: (a as any).occasion_tags ?? [], outfit_item: [] } as unknown as OutfitWithItems
      const v = buildOutfitVector(pseudo)
      vectors.push(v)
      scoredBoard.push({ url: entry.url, vector: v })
    }
    if (!vectors.length) return { error: 'No moodboard image could be scored' }

    const range = rangeFromVectors(vectors, 0.1)
    const centroid = new Array(vectors[0].length).fill(0)
    for (const v of vectors) for (let i = 0; i < centroid.length; i++) centroid[i] += v[i] / vectors.length

    // Draft constitution: House Style structure with editable placeholders.
    const draftConstitution = {
      note: 'DRAFT — proposed from the moodboard. Edit each article to this persona’s rules, then confirm.',
      articles: CONSTITUTION_ARTICLES.map((a) => ({ title: a.title, rules: [...a.rules] })),
    }

    const admin = createAdminClient()
    await (admin.from('stylist') as any)
      .update({
        moodboard: scoredBoard,
        vector_range: range,
        centroid: centroid.map((x: number) => +x.toFixed(4)),
        constitution: stylist.constitution ?? draftConstitution,
        updated_at: new Date().toISOString(),
      })
      .eq('stylist_id', stylistId)
    revalidatePath('/admin/stylists')
    return { scored: vectors.length, failed }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Moodboard scoring failed' }
  }
}

// Step 2b — Chloe edits + confirms the proposal.
export async function updateStylist(
  stylistId: string,
  patch: { name?: string; voice_notes?: string; constitution?: string },
): Promise<{ ok?: true; error?: string }> {
  try {
    const admin = createAdminClient()
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patch.name?.trim()) update.name = patch.name.trim()
    if (patch.voice_notes != null) update.voice_notes = patch.voice_notes
    if (patch.constitution != null) {
      try {
        update.constitution = JSON.parse(patch.constitution)
      } catch {
        return { error: 'Constitution is not valid JSON' }
      }
    }
    await (admin.from('stylist') as any).update(update).eq('stylist_id', stylistId)
    revalidatePath('/admin/stylists')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Update failed' }
  }
}

// Step 3 — compute the item eligibility mask (auto; manual overrides survive).
export async function computeStylistMask(stylistId: string): Promise<{ eligible?: number; excluded?: number; error?: string }> {
  try {
    const res = await scoreItemMaskForStylist(stylistId)
    revalidatePath('/admin/stylists')
    return res
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Mask computation failed' }
  }
}

// Step 4 — compose seed styling sets under the persona's constitution. They
// enter MY review queue tagged with the persona; my approvals and swaps
// calibrate the persona's own learning state.
export async function composeSeedSets(stylistId: string, nSets = 3): Promise<{ sets?: number; staged?: number; error?: string }> {
  try {
    const admin = createAdminClient()
    const { data: mask } = await admin
      .from('stylist_item_mask' as any)
      .select('item_id')
      .eq('stylist_id', stylistId)
      .eq('eligibility', 'eligible')
      .limit(2000)
    const eligibleIds = new Set(((mask ?? []) as any[]).map((r) => r.item_id))
    if (!eligibleIds.size) return { error: 'No eligible items — compute the mask first' }

    const HERO_TYPES = ['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress', 'shirt', 'blouse', 'knitwear', 'trousers', 'jeans', 'skirt']
    const { data: items } = await admin
      .from('item' as any)
      .select('item_id, item_type')
      .in('status', ['ready', 'live'])
      .in('item_type', HERO_TYPES)
      .limit(500)
    const heroes = ((items ?? []) as any[]).filter((it) => eligibleIds.has(it.item_id)).slice(0, nSets)
    if (!heroes.length) return { error: 'No eligible hero garments for this persona' }

    let sets = 0
    let staged = 0
    for (const h of heroes) {
      const res = await composeStylingSet(h.item_id, { stylistId })
      if (res.staged) {
        sets++
        staged += res.staged
      }
    }
    await (admin.from('stylist') as any).update({ status: 'seeding', updated_at: new Date().toISOString() }).eq('stylist_id', stylistId)
    revalidatePath('/admin/stylists')
    revalidatePath('/admin/pipeline')
    return { sets, staged }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Seed composition failed' }
  }
}

// Step 5 — go live, gated on the seed sets being fully reviewed.
export async function setStylistLive(stylistId: string): Promise<{ ok?: true; error?: string }> {
  try {
    const admin = createAdminClient()
    const [{ count: pending }, { count: approved }] = await Promise.all([
      admin.from('composed_outfit' as any).select('*', { count: 'exact', head: true }).eq('stylist_id', stylistId).eq('status', 'pending'),
      admin.from('composed_outfit' as any).select('*', { count: 'exact', head: true }).eq('stylist_id', stylistId).eq('status', 'approved'),
    ])
    if ((pending ?? 0) > 0) return { error: `${pending} seed variants still awaiting review` }
    if ((approved ?? 0) === 0) return { error: 'No approved seed variants yet — review the seed sets first' }

    // A persona is only as real as the moodboard behind it. Personas created
    // before 0039 have no inspiration rows at all — those keep the old path.
    const confirmed = await confirmedImageCount(stylistId)
    const { data: hasAny } = await (admin.from('inspiration_image') as any)
      .select('image_id').eq('persona_id', stylistId).limit(1)
    if ((hasAny ?? []).length && confirmed < MIN_CONFIRMED_IMAGES) {
      return { error: `${confirmed}/${MIN_CONFIRMED_IMAGES} confirmed inspiration images — confirm more before going live` }
    }
    await (admin.from('stylist') as any).update({ status: 'live', updated_at: new Date().toISOString() }).eq('stylist_id', stylistId)
    revalidatePath('/admin/stylists')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Go-live failed' }
  }
}

// Chloe as stylist 001 — idempotent backfill.
export async function runStylistBackfill(): Promise<Awaited<ReturnType<typeof runChloeBackfill>>> {
  const res = await runChloeBackfill()
  revalidatePath('/admin/stylists')
  revalidatePath('/admin')
  return res
}

// Brand demo mode (never auto-publishes; draft project output).
export async function runBrandDemo(brandId: string, nSets: number): Promise<Awaited<ReturnType<typeof composeBrandDemo>>> {
  return composeBrandDemo(brandId, nSets)
}

export async function listBrandsForDemo(): Promise<{ brand_id: string; name: string }[]> {
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('brand' as any).select('brand_id, name').order('name')
    return (data ?? []) as any[]
  } catch {
    return []
  }
}
