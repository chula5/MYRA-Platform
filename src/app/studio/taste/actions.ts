'use server'

// Taste Inspector — verify the brand-affinity system end to end: brand map,
// per-member inspection, onboarding simulator, health checks.

import { createAdminClient, createServerClient } from '@/lib/supabase-server'
import { analyseOutfit } from '@/app/admin/ai/analyse-outfit'
import { buildOutfitVector } from '@/lib/taste-vector'
import {
  brandCosine, brandKey, centroidOf, codesComplete, codesVector, computeSimilarBrands,
  expansionSeeds, getSimilarBrands, ghostCodes, pairIdentitySimilarity,
  invalidateSimilarityCache, isThinBrand, loadAffinities, loadBrandGraph, pcaProject1D,
  positioningBand, priceProximity, rankFeedForUser, recomputeBrandVectors, resolveBrandNames,
  runHealthChecks, seedUserAffinities, SEED,
  type AffinityConfig, type BrandGraph, type FeedRow, type HealthReport, type SimilarBrand,
} from '@/lib/brand-affinity'
import { revalidatePath } from 'next/cache'

const PATH = '/studio/taste'

async function requireAdmin(): Promise<void> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) throw new Error('Not authorised')
}

// ── inspector load ──────────────────────────────────────────────────────────

export interface MapBrand {
  brand_id: string
  name: string
  price_tier: number
  status: string
  x: number | null // 1-D PCA projection of brand_vector
  thin: boolean
  itemCount: number
  familyIds: string[]
  price_position: number | null // ln £; null = no price data (falls back to tier pseudo-price client-side)
  band: number | null // 0..5 positioning band
  medianPrice: number | null
  coreCategory: string | null
  coded: boolean // all 11 brand codes authored — codes drive similarity + map position
}

export interface InspectorData {
  migrationNeeded?: boolean
  brands: MapBrand[]
  families: Array<{ family_id: string; name: string; description: string | null; members: Array<{ brand_id: string; weight: string }> }>
  exclusions: Array<{ brand_a: string; brand_b: string; a_name: string; b_name: string }>
  members: Array<{ member_id: string; name: string; is_synthetic: boolean }>
  latestReport: HealthReport | null
  badges: { orphans: number; incoherent: number; starved: number; dead: number }
  config: AffinityConfig
  error?: string
}

export async function loadTasteInspector(): Promise<InspectorData> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const empty: InspectorData = {
    brands: [], families: [], exclusions: [], members: [], latestReport: null,
    badges: { orphans: 0, incoherent: 0, starved: 0, dead: 0 },
    config: { bandBounds: [150, 350, 700, 1200, 2500], priceK: 1.8 },
  }
  const { error: probe } = await admin.from('brand_family').select('family_id').limit(1)
  if (probe) return { ...empty, migrationNeeded: true, error: `0032 missing: ${probe.message}` }
  const { error: probe35 } = await admin.from('brand').select('price_position').limit(1)
  if (probe35) return { ...empty, migrationNeeded: true, error: `0035 missing: ${probe35.message}` }

  const graph = await loadBrandGraph(admin)
  // X axis: PCA over AUTHORED BRAND CODES (10 non-price dims, centred) for
  // fully coded brands. Brands with incomplete codes fall back to the
  // item-centroid PCA — a PROVISIONAL position (hollow dot) so the map stays
  // navigable during the scoring campaign. No codes AND no trustworthy
  // centroid → pinned to the left margin, price only.
  const codedBrands = graph.brands.filter((b) => codesComplete(b))
  const codesProj = pcaProject1D(codedBrands.map((b) => codesVector(b.codes!).map((v) => v - 3)))
  const xById = new Map(codedBrands.map((b, i) => [b.brand_id, codesProj[i]]))
  const provisionalBrands = graph.brands.filter((b) => !codesComplete(b) && b.brand_vector && !isThinBrand(b))
  const vecProj = pcaProject1D(provisionalBrands.map((b) => b.brand_vector!))
  provisionalBrands.forEach((b, i) => xById.set(b.brand_id, vecProj[i]))

  const brands: MapBrand[] = graph.brands
    .map((b) => ({
      brand_id: b.brand_id, name: b.name, price_tier: b.price_tier, status: b.status,
      x: xById.get(b.brand_id) ?? null,
      thin: isThinBrand(b),
      itemCount: b.vector_item_count,
      familyIds: graph.memberships.filter((m) => m.brand_id === b.brand_id).map((m) => m.family_id),
      price_position: b.price_position,
      band: positioningBand(b.price_position, graph.config.bandBounds),
      medianPrice: b.median_price_overall,
      coreCategory: b.core_category,
      coded: codesComplete(b),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const families = graph.families.map((f) => ({
    ...f,
    members: graph.memberships.filter((m) => m.family_id === f.family_id).map((m) => ({ brand_id: m.brand_id, weight: m.weight })),
  }))
  const nameById = new Map(graph.brands.map((b) => [b.brand_id, b.name]))
  const exclusions = graph.exclusions.map((e) => ({
    ...e, a_name: nameById.get(e.brand_a) ?? '?', b_name: nameById.get(e.brand_b) ?? '?',
  }))

  const { data: members } = await admin
    .from('pilot_member').select('member_id, name, is_synthetic')
    .order('is_synthetic').order('name')

  const { data: reportRow } = await admin
    .from('brand_health_report').select('report').order('week_start', { ascending: false }).limit(1).maybeSingle()
  const latestReport = (reportRow?.report ?? null) as HealthReport | null

  return {
    brands, families, exclusions,
    members: members ?? [],
    latestReport,
    config: graph.config,
    badges: {
      orphans: latestReport?.orphan_brands.length ?? 0,
      incoherent: latestReport?.incoherent_families.length ?? 0,
      starved: latestReport?.starved_feeds.length ?? 0,
      dead: latestReport?.dead_expansions.length ?? 0,
    },
  }
}

// ── brand detail panel ──────────────────────────────────────────────────────

export interface BrandDetail {
  thin: boolean // no identity yet (no complete codes, no trustworthy centroid) — lists suppressed
  neighbours: Array<{ brand_id: string; name: string; aesthetic: number; priceFactor: number; combined: number; basis: 'codes' | 'vector' }>
  similar: SimilarBrand[]
  error?: string
}

export async function loadBrandDetail(brandId: string): Promise<BrandDetail> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const graph = await loadBrandGraph(admin)
  const self = graph.byId.get(brandId)
  const similar = await getSimilarBrands(admin, brandId, graph)
  const hasIdentity = self && (codesComplete(self) || (self.brand_vector && !isThinBrand(self)))
  if (!self || !hasIdentity) {
    // no identity at all: neither complete codes nor a trustworthy centroid —
    // family memberships (curation) are all that survives until scored
    return { thin: true, neighbours: [], similar: similar.filter((s) => s.mechanism !== 'vector') }
  }
  const neighbours = graph.brands
    .filter((b) => b.brand_id !== brandId)
    .map((b) => {
      const id = pairIdentitySimilarity(self, b)
      if (!id) return null
      const pp = priceProximity(self, b, graph.config.priceK)
      const priceFactor = pp?.factor ?? 1
      return {
        brand_id: b.brand_id, name: b.name, aesthetic: id.sim, priceFactor: +priceFactor.toFixed(3),
        combined: +(id.sim * priceFactor).toFixed(3), basis: id.basis,
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.combined - a.combined)
    .slice(0, 10) as BrandDetail['neighbours']
  return { thin: false, neighbours, similar }
}

// ── curation actions ────────────────────────────────────────────────────────

export async function createFamily(name: string, description: string): Promise<{ error?: string }> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const { error } = await admin.from('brand_family').insert({ name: name.trim(), description: description.trim() || null })
  await invalidateSimilarityCache(admin)
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}

export async function deleteFamily(familyId: string): Promise<void> {
  await requireAdmin()
  const admin = createAdminClient() as any
  await admin.from('brand_family').delete().eq('family_id', familyId)
  await invalidateSimilarityCache(admin)
  revalidatePath(PATH)
}

export async function setMembership(familyId: string, brandId: string, weight: 'core' | 'adjacent' | null): Promise<void> {
  await requireAdmin()
  const admin = createAdminClient() as any
  if (weight === null) {
    await admin.from('brand_family_membership').delete().eq('family_id', familyId).eq('brand_id', brandId)
  } else {
    await admin.from('brand_family_membership').upsert({ family_id: familyId, brand_id: brandId, weight }, { onConflict: 'family_id,brand_id' })
  }
  await invalidateSimilarityCache(admin)
  revalidatePath(PATH)
}

export async function addExclusion(brandA: string, brandB: string, note: string): Promise<{ error?: string }> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const [a, b] = [brandA, brandB].sort()
  const { error } = await admin.from('brand_exclusion').insert({ brand_a: a, brand_b: b, note: note.trim() || null })
  await invalidateSimilarityCache(admin)
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}

export async function removeExclusion(brandA: string, brandB: string): Promise<void> {
  await requireAdmin()
  const admin = createAdminClient() as any
  await admin.from('brand_exclusion').delete().eq('brand_a', brandA).eq('brand_b', brandB)
  await invalidateSimilarityCache(admin)
  revalidatePath(PATH)
}

// Reference brands: not stocked, named at onboarding (Rouje, Réalisation Par).
// Vector comes from vision-scoring 5-10 reference product images.
export async function addReferenceBrand(
  name: string, priceTier: number, imageUrls: string[], typicalPrice?: number | null,
): Promise<{ scored?: number; failed?: number; error?: string }> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const clean = name.trim()
  if (!clean) return { error: 'Name required' }
  const urls = imageUrls.map((u) => u.trim()).filter(Boolean).slice(0, 10)
  if (urls.length < 3) return { error: 'Give at least 3 reference image URLs (5-10 is ideal)' }

  const vectors: number[][] = []
  let failed = 0
  for (const url of urls) {
    const { data: a, error } = await analyseOutfit(url)
    if (error || !a) { failed++; continue }
    const pseudo = { ...(a as any), occasion_tags: (a as any).occasion_tags ?? [], outfit_item: [] }
    vectors.push(buildOutfitVector(pseudo as any))
  }
  if (!vectors.length) return { error: 'No reference image could be scored' }
  const vector = centroidOf(vectors)

  const { data: existing } = await admin.from('brand').select('brand_id, status').ilike('name', clean).limit(1)
  const row: Record<string, unknown> = {
    brand_vector: vector, vector_item_count: vectors.length,
    vector_updated_at: new Date().toISOString(), price_tier: priceTier,
  }
  // price_position for reference brands is manual — a typical dress/bag price
  if (typicalPrice && typicalPrice > 0) {
    row.price_position = +Math.log(typicalPrice).toFixed(4)
    row.median_price_overall = typicalPrice
    row.median_price_by_category = { dresses: { median: typicalPrice, count: 1 } }
    row.core_category = 'dresses'
  }
  if ((existing ?? []).length) {
    // reference-scoring also works for STOCKED brands (thin-vector rescue) —
    // never flip their status
    await admin.from('brand').update({ ...row, status: existing[0].status ?? 'reference' }).eq('brand_id', existing[0].brand_id)
  } else {
    await admin.from('brand').insert({
      name: clean, era_orientation: 3, aesthetic_output: 3, cultural_legibility: 3, creative_behaviour: 3,
      status: 'reference',
      ...row,
    })
  }
  await invalidateSimilarityCache(admin)
  revalidatePath(PATH)
  return { scored: vectors.length, failed }
}

export async function recomputeVectorsNow(): Promise<{ updated: number }> {
  await requireAdmin()
  const result = await recomputeBrandVectors()
  revalidatePath(PATH)
  return result
}

// Starter curation: French contemporary = Sézane, Claudie Pierlot, Maje, Sandro (core)
export async function seedStarterFamily(): Promise<{ error?: string }> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const names = ['Sézane', 'Claudie Pierlot', 'Maje', 'Sandro']
  const graph = await loadBrandGraph(admin)
  const ids: string[] = []
  for (const n of names) {
    const hit = graph.brands.find((b) => brandKey(b.name) === brandKey(n))
    if (hit) { ids.push(hit.brand_id); continue }
    const { data: created } = await admin.from('brand').insert({
      name: n, price_tier: 2, era_orientation: 3, aesthetic_output: 3,
      cultural_legibility: 3, creative_behaviour: 3, status: 'reference',
    }).select('brand_id').single()
    if (created) ids.push(created.brand_id)
  }
  const { data: fam } = await admin.from('brand_family')
    .upsert({ name: 'French contemporary', description: 'Parisian contemporary houses — polished, feminine, wearable' }, { onConflict: 'name' })
    .select('family_id').single()
  if (!fam) return { error: 'Could not create family' }
  for (const id of ids) {
    await admin.from('brand_family_membership').upsert(
      { family_id: fam.family_id, brand_id: id, weight: 'core' }, { onConflict: 'family_id,brand_id' })
  }
  await invalidateSimilarityCache(admin)
  revalidatePath(PATH)
  return {}
}

// ── member inspector ────────────────────────────────────────────────────────

export interface MemberInspection {
  member: { member_id: string; name: string; occasions: string[]; taste_vector: number[] | null }
  onboarded: Array<{ name: string; rank?: number; matched: boolean }>
  unmatched: string[]
  affinities: Array<{
    brand_id: string; brand_name: string; affinity: number; source: string
    expansion_trace: string | null; hidden: boolean
    positive_count: number; skip_count: number
    spark: number[] // last 20 affinity values, oldest first
  }>
  discoveries: Array<{ brand: string; mechanism: string | null; outcome: string; context: string; created_at: string }>
  feed: Array<{
    outfit_id: string; image_url: string | null; hero: string | null
    occasionMatch: boolean; vecSim: number | null; brandAff: number; combined: number
    discovery: boolean; attribution: string | null
  }>
  error?: string
}

function memberOccasions(occasions: any): string[] {
  if (!occasions) return []
  if (Array.isArray(occasions)) return occasions.map(String)
  return Object.entries(occasions)
    .filter(([, v]) => v && v !== 'never')
    .map(([k]) => k)
}

function feedRowsForUi(rows: FeedRow[]): MemberInspection['feed'] {
  return rows.map((r) => ({
    outfit_id: r.outfit_id,
    image_url: r.outfit.image_url ?? r.outfit.outfit_item?.[0]?.item?.image_url ?? null,
    hero: r.heroBrandName,
    occasionMatch: r.occasionMatch,
    vecSim: r.vecSim, brandAff: r.brandAff, combined: r.combined,
    discovery: !!r.discovery, attribution: r.attribution ?? null,
  }))
}

export async function loadMemberInspection(memberId: string, logPreview = false): Promise<MemberInspection | { error: string }> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member')
    .select('member_id, name, brands, brands_input_only, occasions, taste_vector')
    .eq('member_id', memberId).single()
  if (!member) return { error: 'Member not found' }

  const graph = await loadBrandGraph(admin)
  const namedRaw: Array<{ name: string; rank?: number }> = [
    ...((member.brands ?? []) as any[]).map((b: any) => ({ name: b.name, rank: b.rank })),
    ...((member.brands_input_only ?? []) as string[]).map((n) => ({ name: n })),
  ]
  const { matched } = resolveBrandNames(graph, namedRaw.map((n) => n.name))
  const matchedKeys = new Set(matched.map((m) => brandKey(m.name)))
  const onboarded = namedRaw.map((n) => ({ ...n, matched: matchedKeys.has(brandKey(n.name)) }))

  const { data: unmatchedRows } = await admin.from('unmatched_brand_log')
    .select('raw_name').eq('user_id', memberId).order('created_at')
  const unmatched: string[] = Array.from(new Set<string>((unmatchedRows ?? []).map((r: any) => String(r.raw_name))))

  const affinityRows = await loadAffinities(admin, memberId)
  const { data: events } = await admin.from('brand_affinity_event')
    .select('brand_id, new_value, created_at').eq('user_id', memberId).order('created_at').limit(4000)
  const sparkByBrand = new Map<string, number[]>()
  for (const e of events ?? []) {
    const list = sparkByBrand.get(e.brand_id) ?? []
    list.push(Number(e.new_value))
    sparkByBrand.set(e.brand_id, list)
  }
  const affinities = Array.from(affinityRows.values())
    .filter((r) => r.affinity > SEED.baseline || r.hidden || r.source !== 'expanded' || (r.expansion_trace && r.expansion_trace !== 'baseline'))
    .map((r) => ({
      brand_id: r.brand_id,
      brand_name: graph.byId.get(r.brand_id)?.name ?? r.brand_id,
      affinity: Number(r.affinity), source: r.source, expansion_trace: r.expansion_trace,
      hidden: r.hidden, positive_count: r.positive_count, skip_count: r.skip_count,
      spark: (sparkByBrand.get(r.brand_id) ?? [Number(r.affinity)]).slice(-20),
    }))
    .sort((a, b) => b.affinity - a.affinity)

  const { data: imps } = await admin.from('discovery_impression')
    .select('hero_brand_id, mechanism, outcome, context, created_at')
    .eq('user_id', memberId).order('created_at', { ascending: false }).limit(60)
  const discoveries = (imps ?? []).map((i: any) => ({
    brand: graph.byId.get(i.hero_brand_id)?.name ?? '?',
    mechanism: i.mechanism, outcome: i.outcome, context: i.context, created_at: i.created_at,
  }))

  const feedRows = await rankFeedForUser(admin, {
    userId: memberId,
    tasteVector: member.taste_vector,
    occasions: memberOccasions(member.occasions),
    limit: 12,
    logImpressions: logPreview ? 'preview' : false,
  })

  return {
    member: { member_id: member.member_id, name: member.name, occasions: memberOccasions(member.occasions), taste_vector: member.taste_vector },
    onboarded, unmatched, affinities, discoveries, feed: feedRowsForUi(feedRows),
  }
}

export async function seedMemberFromIntake(memberId: string): Promise<{ named?: number; expanded?: number; baseline?: number; unmatched?: string[]; error?: string }> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('brands, brands_input_only').eq('member_id', memberId).single()
  if (!member) return { error: 'Member not found' }
  const names = [
    ...((member.brands ?? []) as any[]).map((b: any) => String(b.name)),
    ...((member.brands_input_only ?? []) as string[]),
  ]
  if (!names.length) return { error: 'Member has no onboarded brands' }
  const result = await seedUserAffinities(admin, memberId, names)
  revalidatePath(PATH)
  return result
}

// Admin overrides — every one logged to brand_affinity_event.
export async function overrideAffinity(memberId: string, brandId: string, value: number): Promise<void> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const clamped = Math.max(0, Math.min(1, value))
  const { data: old } = await admin.from('user_brand_affinity')
    .select('affinity').eq('user_id', memberId).eq('brand_id', brandId).maybeSingle()
  await admin.from('user_brand_affinity').upsert(
    { user_id: memberId, brand_id: brandId, affinity: clamped, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,brand_id' })
  await admin.from('brand_affinity_event').insert({
    user_id: memberId, brand_id: brandId, old_value: old?.affinity ?? null, new_value: clamped,
    source: 'admin_override', reason: 'manual edit in Taste Inspector',
  })
  revalidatePath(PATH)
}

export async function setBrandHidden(memberId: string, brandId: string, hidden: boolean): Promise<void> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const { data: old } = await admin.from('user_brand_affinity')
    .select('affinity').eq('user_id', memberId).eq('brand_id', brandId).maybeSingle()
  await admin.from('user_brand_affinity').upsert(
    { user_id: memberId, brand_id: brandId, hidden, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,brand_id' })
  await admin.from('brand_affinity_event').insert({
    user_id: memberId, brand_id: brandId, old_value: old?.affinity ?? null,
    new_value: old?.affinity ?? SEED.baseline,
    source: 'hidden', reason: hidden ? 'brand hidden for this user' : 'brand unhidden',
  })
  revalidatePath(PATH)
}

export async function forceAddBrand(memberId: string, brandName: string): Promise<{ error?: string }> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const graph = await loadBrandGraph(admin)
  const { matched } = resolveBrandNames(graph, [brandName])
  if (!matched.length) return { error: `Unknown brand "${brandName}" — add it as a reference brand first` }
  const b = matched[0]
  const { data: old } = await admin.from('user_brand_affinity')
    .select('affinity').eq('user_id', memberId).eq('brand_id', b.brand_id).maybeSingle()
  await admin.from('user_brand_affinity').upsert(
    { user_id: memberId, brand_id: b.brand_id, affinity: 1.0, source: 'onboarded', updated_at: new Date().toISOString() },
    { onConflict: 'user_id,brand_id' })
  await admin.from('brand_affinity_event').insert({
    user_id: memberId, brand_id: b.brand_id, old_value: old?.affinity ?? null, new_value: 1.0,
    source: 'admin_override', reason: 'force-added in Taste Inspector',
  })
  revalidatePath(PATH)
  return {}
}

// ── simulator: hypothetical onboarding, zero writes ─────────────────────────

export interface SimulationResult {
  seeded: Array<{ brand: string; affinity: number; source: string; trace: string | null }>
  unmatched: string[]
  feed: MemberInspection['feed']
  error?: string
}

export async function simulateOnboarding(names: string[]): Promise<SimulationResult> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const graph = await loadBrandGraph(admin)
  const { matched, unmatched } = resolveBrandNames(graph, names)
  if (!matched.length) return { seeded: [], unmatched, feed: [], error: 'No brand matched' }

  const similarByBrand = new Map<string, SimilarBrand[]>()
  for (const b of matched) similarByBrand.set(b.brand_id, computeSimilarBrands(b.brand_id, graph))
  const seeds = expansionSeeds(matched, similarByBrand)

  const affinityMap = new Map<string, number>()
  const seeded: SimulationResult['seeded'] = []
  for (const b of matched) {
    affinityMap.set(b.brand_id, SEED.named)
    seeded.push({ brand: b.name, affinity: SEED.named, source: 'onboarded', trace: null })
  }
  const seedRows = Array.from(seeds.values())
  for (const s of seedRows) {
    affinityMap.set(s.brand_id, s.value)
    seeded.push({ brand: graph.byId.get(s.brand_id)?.name ?? s.brand_id, affinity: s.value, source: 'expanded', trace: s.trace })
  }
  seeded.sort((a, b) => b.affinity - a.affinity)

  const warmVector = centroidOf(matched.map((b) => b.brand_vector).filter(Boolean) as number[][])
  const feedRows = await rankFeedForUser(admin, { affinityMap, tasteVector: warmVector, limit: 12 })
  return { seeded, unmatched, feed: feedRowsForUi(feedRows) }
}

// ── health ──────────────────────────────────────────────────────────────────

// Band boundaries + price-proximity k, editable in the inspector.
export async function saveAffinityConfig(bandBounds: number[], priceK: number): Promise<{ error?: string }> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const bounds = bandBounds.map(Number).filter((n) => !isNaN(n) && n > 0).sort((a, b) => a - b)
  if (bounds.length !== 5) return { error: 'Exactly 5 ascending band boundaries required' }
  if (!(priceK > 0.2 && priceK < 10)) return { error: 'k must be between 0.2 and 10' }
  const { error } = await admin.from('brand_affinity_config').upsert({ id: 1, band_bounds: bounds, price_k: priceK, updated_at: new Date().toISOString() })
  if (error) return { error: error.message }
  await invalidateSimilarityCache(admin)
  revalidatePath(PATH)
  return {}
}

export async function runHealthNow(): Promise<HealthReport> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const report = await runHealthChecks(admin)
  const monday = new Date()
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  await admin.from('brand_health_report').upsert(
    { week_start: monday.toISOString().slice(0, 10), report }, { onConflict: 'week_start' })
  revalidatePath(PATH)
  return report
}
