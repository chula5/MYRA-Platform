// Brand affinity system — brand vectors, curated families, similarity
// resolution, per-user brand taste with learning, feed ranking with discovery
// slots, and health checks. Verified in /studio/taste (Taste Inspector).
//
// Spaces: brand_vector lives in the SAME 34-dim space as outfit.taste_vector
// and user taste vectors — the centroid of single-item pseudo-outfit vectors
// over the brand's scored items (outfit-only dims sit neutral at 0.5, so they
// don't differentiate brands). Reference brands (not stocked) get a manual
// vector from vision-scored reference images.

import { createAdminClient } from '@/lib/supabase-server'
import { buildOutfitVector, cosine, unit, isZero, VECTOR_DIM } from '@/lib/taste-vector'

// ── constants ───────────────────────────────────────────────────────────────

export const SEED = {
  named: 1.0,
  coreFamily: 0.6,
  adjacentFamily: 0.45,
  vectorOnly: 0.35,
  baseline: 0.1,
} as const

export const POSITIVE_STEP = 0.05
export const DECAY_STEP = 0.1
export const AFFINITY_FLOOR = 0.05
export const SKIPS_BEFORE_DECAY = 5
export const VECTOR_WEIGHT = 0.6
export const AFFINITY_WEIGHT = 0.4
export const HERO_WEIGHT = 2
export const DISCOVERY_EVERY_N = 6
export const THIN_VECTOR_ITEMS = 8
export const MIN_VECTOR_NEIGHBOUR = 0.5 // below this an unfamilied brand is an orphan
export const WARM_START_WEIGHT = 10 // ≈ 2-3 swipes' worth; real swipes dominate by ~20 events
export const RE_EXPANSION_THRESHOLD = 0.8
export const POSITIVE_EVENTS = ['yes', 'save', 'click_out', 'purchase']

// ── shared types ────────────────────────────────────────────────────────────

export interface BrandLite {
  brand_id: string
  name: string
  aliases: string[]
  price_tier: number
  status: 'stocked' | 'reference'
  brand_vector: number[] | null
  vector_item_count: number
}

export interface FamilyRow { family_id: string; name: string; description: string | null }
export interface MembershipRow { family_id: string; brand_id: string; weight: 'core' | 'adjacent' }
export interface ExclusionRow { brand_a: string; brand_b: string; note?: string | null }

export interface BrandGraph {
  brands: BrandLite[]
  byId: Map<string, BrandLite>
  families: FamilyRow[]
  memberships: MembershipRow[]
  exclusions: ExclusionRow[]
}

export interface SimilarBrand {
  brand_id: string
  name: string
  mechanism: 'core_family' | 'adjacent_family' | 'vector'
  family_name?: string
  score?: number // cosine, for vector mechanism
}

export interface AffinityRow {
  user_id: string
  brand_id: string
  affinity: number
  source: 'onboarded' | 'expanded' | 'learned'
  expansion_trace: string | null
  hidden: boolean
  positive_count: number
  skip_count: number
}

// ── pure: names and vectors ─────────────────────────────────────────────────

// One canonical key for brand identity (same rules as brand-logos slug()).
export function brandKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// A single item as a pseudo-outfit → 34-dim vector in the shared space.
export function itemPseudoVector(item: any): number[] {
  const pseudo = { occasion_tags: [], outfit_item: [{ item }] }
  return buildOutfitVector(pseudo as any)
}

export function centroidOf(vectors: number[][]): number[] | null {
  if (!vectors.length) return null
  const c = new Array(vectors[0].length).fill(0)
  for (const v of vectors) for (let i = 0; i < c.length; i++) c[i] += v[i] / vectors.length
  return c.map((x) => +x.toFixed(4))
}

// An item counts toward the brand vector when it's actually been scored.
export function isScoredItem(item: any): boolean {
  return item?.colour_family != null || item?.structure != null || item?.surface != null
}

// ── pure: similarity resolution ─────────────────────────────────────────────

function excluded(a: string, b: string, exclusions: ExclusionRow[]): boolean {
  return exclusions.some(
    (e) => (e.brand_a === a && e.brand_b === b) || (e.brand_a === b && e.brand_b === a),
  )
}

function sharedFamilies(a: string, b: string, memberships: MembershipRow[]): MembershipRow[] {
  const aFams = new Set(memberships.filter((m) => m.brand_id === a).map((m) => m.family_id))
  return memberships.filter((m) => m.brand_id === b && aFams.has(m.family_id))
}

// similar_brands(brand): family first (core before adjacent), then
// vector-similar outside shared families; >1 price tier away is out unless a
// curated family overrides; exclusions override everything.
export function computeSimilarBrands(
  brandId: string,
  graph: Pick<BrandGraph, 'brands' | 'families' | 'memberships' | 'exclusions'>,
  maxVector = 12,
): SimilarBrand[] {
  const self = graph.brands.find((b) => b.brand_id === brandId)
  if (!self) return []
  const famName = new Map(graph.families.map((f) => [f.family_id, f.name]))
  const out: SimilarBrand[] = []
  const seen = new Set<string>([brandId])

  // 1. same-family, core before adjacent
  for (const weight of ['core', 'adjacent'] as const) {
    const rows: Array<{ b: BrandLite; family: string }> = []
    for (const other of graph.brands) {
      if (seen.has(other.brand_id)) continue
      const shared = sharedFamilies(brandId, other.brand_id, graph.memberships)
      const match = shared.find((m) => m.weight === weight)
      if (!match) continue
      if (excluded(brandId, other.brand_id, graph.exclusions)) continue
      rows.push({ b: other, family: famName.get(match.family_id) ?? 'family' })
    }
    rows.sort((a, b) => a.b.name.localeCompare(b.b.name))
    for (const r of rows) {
      seen.add(r.b.brand_id)
      out.push({
        brand_id: r.b.brand_id, name: r.b.name,
        mechanism: weight === 'core' ? 'core_family' : 'adjacent_family',
        family_name: r.family,
      })
    }
  }

  // 2. vector-similar, not in a shared family
  if (self.brand_vector) {
    const rows: Array<{ b: BrandLite; score: number }> = []
    for (const other of graph.brands) {
      if (seen.has(other.brand_id)) continue
      if (!other.brand_vector) continue
      // hard tier rule — only curation can cross more than 1 tier
      if (Math.abs(other.price_tier - self.price_tier) > 1) continue
      if (excluded(brandId, other.brand_id, graph.exclusions)) continue
      const score = cosine(self.brand_vector, other.brand_vector)
      if (score <= 0) continue
      rows.push({ b: other, score })
    }
    rows.sort((a, b) => b.score - a.score)
    for (const r of rows.slice(0, maxVector)) {
      out.push({ brand_id: r.b.brand_id, name: r.b.name, mechanism: 'vector', score: +r.score.toFixed(3) })
    }
  }
  return out
}

// ── pure: onboarding expansion ──────────────────────────────────────────────

export interface ExpansionSeed {
  brand_id: string
  value: number
  trace: string // "core family 'French contemporary' via Sézane"
  seeded_from: string // named brand_id
  mechanism: string
}

export function expansionSeeds(
  named: BrandLite[],
  similarByBrand: Map<string, SimilarBrand[]>,
): Map<string, ExpansionSeed> {
  const out = new Map<string, ExpansionSeed>()
  const namedIds = new Set(named.map((b) => b.brand_id))
  for (const n of named) {
    for (const s of similarByBrand.get(n.brand_id) ?? []) {
      if (namedIds.has(s.brand_id)) continue
      const value =
        s.mechanism === 'core_family' ? SEED.coreFamily :
        s.mechanism === 'adjacent_family' ? SEED.adjacentFamily : SEED.vectorOnly
      const mechanism =
        s.mechanism === 'vector' ? `vector ${s.score}` :
        `${s.mechanism === 'core_family' ? 'core' : 'adjacent'} family '${s.family_name}'`
      const trace = `${mechanism} via ${n.name}`
      const existing = out.get(s.brand_id)
      if (!existing || value > existing.value) {
        out.set(s.brand_id, { brand_id: s.brand_id, value, trace, seeded_from: n.brand_id, mechanism })
      }
    }
  }
  return out
}

// ── pure: feed maths ────────────────────────────────────────────────────────

const HERO_SLOT_ORDER = ['dress', 'top', 'bottom', 'outerwear']

export function heroBrandOf(outfit: any): { brand_id: string | null; name: string | null } {
  const rows: any[] = outfit?.outfit_item ?? []
  for (const slot of HERO_SLOT_ORDER) {
    const r = rows.find((x) => x.slot === slot && x.item?.brand)
    if (r) return { brand_id: r.item.brand.brand_id ?? r.item.brand_id ?? null, name: r.item.brand.name ?? null }
  }
  const first = rows.find((x) => x.item?.brand)
  return first
    ? { brand_id: first.item.brand.brand_id ?? first.item.brand_id ?? null, name: first.item.brand.name ?? null }
    : { brand_id: null, name: null }
}

// Weighted mean of the user's affinities over the outfit's brands, hero ×2.
export function outfitBrandAffinity(
  outfit: any,
  affinity: Map<string, number>,
  baseline = SEED.baseline,
): number {
  const rows: any[] = outfit?.outfit_item ?? []
  const hero = heroBrandOf(outfit).brand_id
  let sum = 0
  let weight = 0
  for (const r of rows) {
    const bid = r.item?.brand?.brand_id ?? r.item?.brand_id
    if (!bid) continue
    const w = bid === hero ? HERO_WEIGHT : 1
    sum += (affinity.get(bid) ?? baseline) * w
    weight += w
  }
  return weight ? sum / weight : baseline
}

export function combinedTaste(vecSim: number | null, brandAff: number): number {
  if (vecSim == null) return brandAff
  return VECTOR_WEIGHT * vecSim + AFFINITY_WEIGHT * brandAff
}

export interface FeedRow {
  outfit: any
  outfit_id: string
  occasionMatch: boolean
  vecSim: number | null
  brandAff: number
  combined: number
  heroBrandId: string | null
  heroBrandName: string | null
  discovery?: boolean
  attribution?: string | null
}

// Every Nth position guarantees an untouched expanded-brand outfit (ranking
// never filters; this only re-orders).
export function applyDiscoverySlots(ranked: FeedRow[], discoverable: Set<string>, everyN = DISCOVERY_EVERY_N): FeedRow[] {
  const discoveryQueue = ranked.filter((r) => r.heroBrandId && discoverable.has(r.heroBrandId))
  const used = new Set<string>()
  const out: FeedRow[] = []
  let mainIdx = 0
  const nextMain = () => {
    while (mainIdx < ranked.length && used.has(ranked[mainIdx].outfit_id)) mainIdx++
    return mainIdx < ranked.length ? ranked[mainIdx++] : null
  }
  for (let pos = 0; out.length < ranked.length; pos++) {
    let row: FeedRow | null = null
    if ((pos + 1) % everyN === 0) {
      row = discoveryQueue.find((r) => !used.has(r.outfit_id)) ?? null
      if (row) row = { ...row, discovery: true }
    }
    if (!row) row = nextMain()
    if (!row) break
    used.add(row.outfit_id)
    out.push(row)
  }
  return out
}

// ── pure: 1-D PCA for the brand map (power iteration, mean-centred) ─────────

export function pcaProject1D(vectors: number[][]): number[] {
  if (!vectors.length) return []
  const dim = vectors[0].length
  const mean = new Array(dim).fill(0)
  for (const v of vectors) for (let i = 0; i < dim; i++) mean[i] += v[i] / vectors.length
  const centred = vectors.map((v) => v.map((x, i) => x - mean[i]))
  let w = new Array(dim).fill(0).map((_, i) => Math.sin(i + 1)) // deterministic start
  for (let iter = 0; iter < 60; iter++) {
    const next = new Array(dim).fill(0)
    for (const v of centred) {
      let d = 0
      for (let i = 0; i < dim; i++) d += v[i] * w[i]
      for (let i = 0; i < dim; i++) next[i] += d * v[i]
    }
    const mag = Math.sqrt(next.reduce((s, x) => s + x * x, 0)) || 1
    w = next.map((x) => x / mag)
  }
  const proj = centred.map((v) => v.reduce((s, x, i) => s + x * w[i], 0))
  const min = Math.min(...proj)
  const max = Math.max(...proj)
  const span = max - min || 1
  return proj.map((p) => +((p - min) / span).toFixed(4))
}

// ── pure: affinity arithmetic ───────────────────────────────────────────────

export function stepPositive(a: number): number { return Math.min(1, +(a + POSITIVE_STEP).toFixed(4)) }
export function stepDecay(a: number): number { return Math.max(AFFINITY_FLOOR, +(a - DECAY_STEP).toFixed(4)) }

// ── db: graph loading ───────────────────────────────────────────────────────

type Admin = ReturnType<typeof createAdminClient>

export async function loadBrandGraph(adminIn?: Admin): Promise<BrandGraph> {
  const admin = (adminIn ?? createAdminClient()) as any
  const [{ data: brands }, { data: families }, { data: memberships }, { data: exclusions }] = await Promise.all([
    admin.from('brand').select('brand_id, name, aliases, price_tier, status, brand_vector, vector_item_count').limit(3000),
    admin.from('brand_family').select('*').order('name'),
    admin.from('brand_family_membership').select('family_id, brand_id, weight'),
    admin.from('brand_exclusion').select('brand_a, brand_b, note'),
  ])
  const list: BrandLite[] = (brands ?? []).map((b: any) => ({
    ...b,
    aliases: b.aliases ?? [],
    status: b.status ?? 'stocked',
    brand_vector: Array.isArray(b.brand_vector) ? b.brand_vector : null,
    vector_item_count: b.vector_item_count ?? 0,
  }))
  return {
    brands: list,
    byId: new Map(list.map((b) => [b.brand_id, b])),
    families: families ?? [],
    memberships: memberships ?? [],
    exclusions: exclusions ?? [],
  }
}

export function resolveBrandNames(graph: BrandGraph, names: string[]): { matched: BrandLite[]; unmatched: string[] } {
  const index = new Map<string, BrandLite>()
  for (const b of graph.brands) {
    index.set(brandKey(b.name), b)
    for (const a of b.aliases) index.set(brandKey(a), b)
  }
  const matched: BrandLite[] = []
  const unmatched: string[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const key = brandKey(raw)
    if (!key) continue
    const hit = index.get(key)
    if (hit && !seen.has(hit.brand_id)) { matched.push(hit); seen.add(hit.brand_id) }
    else if (!hit) unmatched.push(raw.trim())
  }
  return { matched, unmatched }
}

// ── db: brand vectors ───────────────────────────────────────────────────────

// Centroid of single-item pseudo-outfit vectors over each brand's scored
// items. Reference brands are skipped — their vectors are set manually from
// vision-scored reference images.
export async function recomputeBrandVectors(adminIn?: Admin, onlyBrandIds?: string[]): Promise<{ updated: number }> {
  const admin = (adminIn ?? createAdminClient()) as any
  const byBrand = new Map<string, number[][]>()
  for (let from = 0; ; from += 1000) {
    let q = admin
      .from('item')
      .select('brand_id, item_type, colour_family, structure, surface, colour_depth, pattern, sheen, material_formality, material_weight, length, fit, brand:brand_id(brand_id, price_tier, era_orientation, aesthetic_output, cultural_legibility, creative_behaviour)')
      .in('status', ['ready', 'live', 'draft'])
      .order('item_id')
      .range(from, from + 999)
    if (onlyBrandIds?.length) q = q.in('brand_id', onlyBrandIds)
    const { data } = await q
    for (const item of data ?? []) {
      if (!item.brand_id || !isScoredItem(item)) continue
      const list = byBrand.get(item.brand_id) ?? []
      list.push(itemPseudoVector(item))
      byBrand.set(item.brand_id, list)
    }
    if (!data || data.length < 1000) break
  }
  const { data: refs } = await admin.from('brand').select('brand_id').eq('status', 'reference')
  const refIds = new Set((refs ?? []).map((r: any) => r.brand_id))
  let updated = 0
  const entries = Array.from(byBrand.entries())
  for (const [brandId, vectors] of entries) {
    if (refIds.has(brandId)) continue
    const c = centroidOf(vectors)
    if (!c) continue
    await admin
      .from('brand')
      .update({ brand_vector: c, vector_item_count: vectors.length, vector_updated_at: new Date().toISOString() })
      .eq('brand_id', brandId)
    updated++
  }
  await admin.from('brand_similarity_cache').delete().gte('computed_at', '1970-01-01')
  return { updated }
}

// ── db: similarity with cache ───────────────────────────────────────────────

export async function getSimilarBrands(adminIn: Admin | undefined, brandId: string, graphIn?: BrandGraph): Promise<SimilarBrand[]> {
  const admin = (adminIn ?? createAdminClient()) as any
  const { data: cached } = await admin.from('brand_similarity_cache').select('results').eq('brand_id', brandId).maybeSingle()
  if (cached?.results) return cached.results as SimilarBrand[]
  const graph = graphIn ?? (await loadBrandGraph(admin))
  const results = computeSimilarBrands(brandId, graph)
  await admin.from('brand_similarity_cache').upsert({ brand_id: brandId, results, computed_at: new Date().toISOString() })
  return results
}

export async function invalidateSimilarityCache(adminIn?: Admin): Promise<void> {
  const admin = (adminIn ?? createAdminClient()) as any
  await admin.from('brand_similarity_cache').delete().gte('computed_at', '1970-01-01')
}

// ── db: affinity writes (never delete; always log) ──────────────────────────

async function writeAffinity(
  admin: any, userId: string, brandId: string,
  patch: Partial<AffinityRow> & { affinity?: number },
  logSource: string, reason: string | null, oldValue: number | null,
): Promise<void> {
  await admin.from('user_brand_affinity').upsert(
    { user_id: userId, brand_id: brandId, updated_at: new Date().toISOString(), ...patch },
    { onConflict: 'user_id,brand_id' },
  )
  if (patch.affinity != null && patch.affinity !== oldValue) {
    await admin.from('brand_affinity_event').insert({
      user_id: userId, brand_id: brandId, old_value: oldValue, new_value: patch.affinity,
      source: logSource, reason,
    })
  }
}

export async function loadAffinities(adminIn: Admin | undefined, userId: string): Promise<Map<string, AffinityRow>> {
  const admin = (adminIn ?? createAdminClient()) as any
  const { data } = await admin.from('user_brand_affinity').select('*').eq('user_id', userId).limit(3000)
  return new Map((data ?? []).map((r: any) => [r.brand_id, r as AffinityRow]))
}

// Onboarding seeding: named 1.0 · expanded 0.6/0.45/0.35 with a one-line
// trace · every other stocked brand 0.1 (never zero). Never lowers an
// existing value. Also warm-starts the member's 34-dim taste vector toward
// the named-brand centroid, lightly.
export async function seedUserAffinities(
  adminIn: Admin | undefined, userId: string, namedNames: string[],
  opts: { warmStartPilotVector?: boolean } = {},
): Promise<{ named: number; expanded: number; baseline: number; unmatched: string[] }> {
  const admin = (adminIn ?? createAdminClient()) as any
  const graph = await loadBrandGraph(admin)
  const { matched, unmatched } = resolveBrandNames(graph, namedNames)
  for (const raw of unmatched) {
    await admin.from('unmatched_brand_log').insert({ raw_name: raw, user_id: userId })
  }
  const existing = await loadAffinities(admin, userId)

  for (const b of matched) {
    const old = existing.get(b.brand_id)
    if (old && old.affinity >= SEED.named && old.source === 'onboarded') continue
    await writeAffinity(admin, userId, b.brand_id,
      { affinity: SEED.named, source: 'onboarded', expansion_trace: null },
      'onboarded', `named at onboarding`, old?.affinity ?? null)
  }

  const similarByBrand = new Map<string, SimilarBrand[]>()
  for (const b of matched) similarByBrand.set(b.brand_id, await getSimilarBrands(admin, b.brand_id, graph))
  const seeds = expansionSeeds(matched, similarByBrand)
  let expanded = 0
  const seedList = Array.from(seeds.values())
  for (const s of seedList) {
    const old = existing.get(s.brand_id)
    if (old && old.affinity >= s.value) continue
    await writeAffinity(admin, userId, s.brand_id,
      { affinity: s.value, source: old?.source === 'learned' ? 'learned' : 'expanded', expansion_trace: s.trace },
      'expanded', s.trace, old?.affinity ?? null)
    expanded++
  }

  let baseline = 0
  const namedIds = new Set(matched.map((b) => b.brand_id))
  for (const b of graph.brands) {
    if (b.status !== 'stocked') continue
    if (namedIds.has(b.brand_id) || seeds.has(b.brand_id) || existing.has(b.brand_id)) continue
    await admin.from('user_brand_affinity').upsert(
      { user_id: userId, brand_id: b.brand_id, affinity: SEED.baseline, source: 'expanded', expansion_trace: 'baseline' },
      { onConflict: 'user_id,brand_id', ignoreDuplicates: true },
    )
    baseline++
  }

  if (opts.warmStartPilotVector !== false) {
    const namedVectors = matched.map((b) => b.brand_vector).filter(Boolean) as number[][]
    const c = centroidOf(namedVectors)
    if (c) {
      const { data: member } = await admin.from('pilot_member').select('taste_vector').eq('member_id', userId).maybeSingle()
      if (member) {
        const current: number[] = Array.isArray(member.taste_vector) ? member.taste_vector : new Array(VECTOR_DIM).fill(0)
        const u = unit(c)
        const next = current.map((x, i) => +(x + WARM_START_WEIGHT * u[i]).toFixed(4))
        await admin.from('pilot_member').update({ taste_vector: next }).eq('member_id', userId)
      }
    }
  }

  return { named: matched.length, expanded, baseline, unmatched }
}

// Learning loop. Positive: +0.05 capped at 1.0, expanded→learned on first
// positive. Negative: 5+ skips with no positive → decay 0.1 steps, floor 0.05.
export async function applyBrandSignals(
  adminIn: Admin | undefined, userId: string, brandNames: string[], eventType: string,
): Promise<void> {
  const admin = (adminIn ?? createAdminClient()) as any
  const graph = await loadBrandGraph(admin)
  const { matched } = resolveBrandNames(graph, brandNames)
  if (!matched.length) return
  const existing = await loadAffinities(admin, userId)
  const positive = POSITIVE_EVENTS.includes(eventType)

  for (const b of matched) {
    const old = existing.get(b.brand_id)
    if (positive) {
      const oldVal = old?.affinity ?? SEED.baseline
      await writeAffinity(admin, userId, b.brand_id, {
        affinity: stepPositive(oldVal),
        source: 'learned', // first positive on an expanded brand confirms the hypothesis
        positive_count: (old?.positive_count ?? 0) + 1,
        expansion_trace: old?.expansion_trace ?? null,
      }, 'learned', eventType, old?.affinity ?? null)
      await admin.from('discovery_impression')
        .update({ outcome: 'engaged', outcome_at: new Date().toISOString() })
        .eq('user_id', userId).eq('hero_brand_id', b.brand_id).eq('outcome', 'ignored')
    } else {
      const skips = (old?.skip_count ?? 0) + 1
      const shouldDecay = skips >= SKIPS_BEFORE_DECAY && (old?.positive_count ?? 0) === 0
      const oldVal = old?.affinity ?? SEED.baseline
      await writeAffinity(admin, userId, b.brand_id, {
        affinity: shouldDecay ? stepDecay(oldVal) : oldVal,
        source: old?.source ?? 'expanded',
        skip_count: skips,
        expansion_trace: old?.expansion_trace ?? null,
      }, 'decayed', `skip ${skips}`, old?.affinity ?? null)
      await admin.from('discovery_impression')
        .update({ outcome: 'skipped', outcome_at: new Date().toISOString() })
        .eq('user_id', userId).eq('hero_brand_id', b.brand_id).eq('outcome', 'ignored')
    }
  }
}

// ── db: feed ranking (occasion → combined taste → recency) ──────────────────

export async function rankFeedForUser(
  adminIn: Admin | undefined,
  opts: {
    userId?: string // when set, affinities + hidden come from the DB
    affinityMap?: Map<string, number> // simulator: pass directly, no user
    tasteVector?: number[] | null
    occasions?: string[]
    limit?: number
    logImpressions?: 'preview' | 'delivery' | 'feed' | false
  },
): Promise<FeedRow[]> {
  const admin = (adminIn ?? createAdminClient()) as any
  const { data: outfits } = await admin
    .from('outfit')
    .select('*, outfit_item(*, item(*, brand(*)))')
    .eq('status', 'live')
    .order('published_at', { ascending: false })
    .limit(400)

  let affinity = opts.affinityMap ?? new Map<string, number>()
  const hiddenBrands = new Set<string>()
  const discoverable = new Set<string>()
  let traceByBrand = new Map<string, string>()
  if (opts.userId) {
    const rows = await loadAffinities(admin, opts.userId)
    affinity = new Map()
    const rowList = Array.from(rows.values())
    for (const r of rowList) {
      affinity.set(r.brand_id, r.affinity)
      if (r.hidden) hiddenBrands.add(r.brand_id)
      if (r.source === 'expanded' && r.positive_count === 0 && r.skip_count === 0 && r.expansion_trace && r.expansion_trace !== 'baseline') {
        discoverable.add(r.brand_id)
        traceByBrand.set(r.brand_id, r.expansion_trace)
      }
    }
  }

  const occasions = new Set((opts.occasions ?? []).map((o) => o.toLowerCase()))
  const vec = opts.tasteVector && !isZero(opts.tasteVector) ? opts.tasteVector : null

  const rows: FeedRow[] = []
  for (const o of outfits ?? []) {
    const hero = heroBrandOf(o)
    // hidden brands are the ONE hard filter — affinity itself only ranks
    const brandIds = (o.outfit_item ?? []).map((r: any) => r.item?.brand?.brand_id).filter(Boolean)
    if (brandIds.some((id: string) => hiddenBrands.has(id))) continue
    const vecSim = vec ? cosine(vec, buildOutfitVector(o)) : null
    const brandAff = outfitBrandAffinity(o, affinity)
    rows.push({
      outfit: o,
      outfit_id: o.outfit_id,
      occasionMatch: occasions.size ? (o.occasion_tags ?? []).some((t: string) => occasions.has(String(t).toLowerCase())) : false,
      vecSim: vecSim != null ? +vecSim.toFixed(3) : null,
      brandAff: +brandAff.toFixed(3),
      combined: +combinedTaste(vecSim, brandAff).toFixed(3),
      heroBrandId: hero.brand_id,
      heroBrandName: hero.name,
      attribution: hero.brand_id ? traceByBrand.get(hero.brand_id) ?? null : null,
    })
  }
  rows.sort((a, b) =>
    Number(b.occasionMatch) - Number(a.occasionMatch) ||
    b.combined - a.combined ||
    String(b.outfit.published_at ?? '').localeCompare(String(a.outfit.published_at ?? '')),
  )
  const slotted = applyDiscoverySlots(rows, discoverable).slice(0, opts.limit ?? 60)

  if (opts.logImpressions && opts.userId) {
    const impressions = slotted
      .filter((r) => r.discovery)
      .map((r) => ({
        user_id: opts.userId, outfit_id: r.outfit_id, hero_brand_id: r.heroBrandId,
        mechanism: r.attribution, context: opts.logImpressions,
      }))
    if (impressions.length) await admin.from('discovery_impression').insert(impressions)
  }
  return slotted
}

// ── db: health checks ───────────────────────────────────────────────────────

export interface HealthReport {
  generated_at: string
  orphan_brands: Array<{ brand_id: string; name: string }>
  incoherent_families: Array<{ family: string; avg_similarity: number }>
  tier_violations: Array<{ family: string; brands: string; tiers: string }>
  stale_vectors: Array<{ brand_id: string; name: string; reason: string }>
  starved_feeds: Array<{ user_id: string; brands: number }>
  dead_expansions: Array<{ brand: string; impressions: number }>
  runaway_learning: Array<{ user_id: string; brand: string; moved: number }>
  free_text_brands: Array<{ raw_name: string; count: number }>
}

const FAMILY_COHERENCE_FLOOR = 0.55

export async function runHealthChecks(adminIn?: Admin): Promise<HealthReport> {
  const admin = (adminIn ?? createAdminClient()) as any
  const graph = await loadBrandGraph(admin)
  const now = Date.now()

  const orphan_brands: HealthReport['orphan_brands'] = []
  const inFamily = new Set(graph.memberships.map((m) => m.brand_id))
  for (const b of graph.brands) {
    if (b.status !== 'stocked' || inFamily.has(b.brand_id) || !b.brand_vector) continue
    const best = Math.max(0, ...graph.brands
      .filter((o) => o.brand_id !== b.brand_id && o.brand_vector)
      .map((o) => cosine(b.brand_vector!, o.brand_vector!)))
    if (best < MIN_VECTOR_NEIGHBOUR) orphan_brands.push({ brand_id: b.brand_id, name: b.name })
  }

  const incoherent_families: HealthReport['incoherent_families'] = []
  const tier_violations: HealthReport['tier_violations'] = []
  for (const f of graph.families) {
    const members = graph.memberships.filter((m) => m.family_id === f.family_id)
      .map((m) => graph.byId.get(m.brand_id)).filter(Boolean) as BrandLite[]
    const withVec = members.filter((m) => m.brand_vector)
    if (withVec.length >= 2) {
      let total = 0; let pairs = 0
      for (let i = 0; i < withVec.length; i++) for (let j = i + 1; j < withVec.length; j++) {
        total += cosine(withVec[i].brand_vector!, withVec[j].brand_vector!); pairs++
      }
      const avg = total / pairs
      if (avg < FAMILY_COHERENCE_FLOOR) incoherent_families.push({ family: f.name, avg_similarity: +avg.toFixed(3) })
    }
    const tiers = members.map((m) => m.price_tier)
    if (tiers.length && Math.max(...tiers) - Math.min(...tiers) > 1) {
      tier_violations.push({
        family: f.name,
        brands: members.map((m) => m.name).join(', '),
        tiers: `${Math.min(...tiers)}–${Math.max(...tiers)}`,
      })
    }
  }

  const stale_vectors: HealthReport['stale_vectors'] = []
  for (const b of graph.brands) {
    if (b.status !== 'stocked') continue
    const { data: row } = await admin.from('brand').select('vector_updated_at').eq('brand_id', b.brand_id).single()
    const updatedAt = row?.vector_updated_at ? Date.parse(row.vector_updated_at) : null
    if (!b.brand_vector) stale_vectors.push({ brand_id: b.brand_id, name: b.name, reason: 'no vector' })
    else if (b.vector_item_count < THIN_VECTOR_ITEMS) stale_vectors.push({ brand_id: b.brand_id, name: b.name, reason: `${b.vector_item_count} items` })
    else if (updatedAt && now - updatedAt > 14 * 86_400_000) stale_vectors.push({ brand_id: b.brand_id, name: b.name, reason: '14+ days old' })
  }

  // user-side
  const starved_feeds: HealthReport['starved_feeds'] = []
  const runaway_learning: HealthReport['runaway_learning'] = []
  const { data: members } = await admin.from('pilot_member').select('member_id, name, taste_vector, occasions, is_synthetic').eq('is_synthetic', false)
  for (const m of members ?? []) {
    const feed = await rankFeedForUser(admin, { userId: m.member_id, tasteVector: m.taste_vector, limit: 20 })
    const brands = new Set(feed.map((r) => r.heroBrandId).filter(Boolean))
    if (feed.length >= 20 && brands.size <= 3) starved_feeds.push({ user_id: m.member_id, brands: brands.size })
  }
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString()
  const { data: recentEvents } = await admin
    .from('brand_affinity_event')
    .select('user_id, brand_id, old_value, new_value')
    .gte('created_at', weekAgo)
    .limit(5000)
  const movement = new Map<string, number>()
  for (const e of recentEvents ?? []) {
    const key = `${e.user_id}|${e.brand_id}`
    movement.set(key, (movement.get(key) ?? 0) + Math.abs((e.new_value ?? 0) - (e.old_value ?? e.new_value ?? 0)))
  }
  const movementEntries = Array.from(movement.entries())
  for (const [key, moved] of movementEntries) {
    if (moved > 0.3) {
      const [user_id, brand_id] = key.split('|')
      runaway_learning.push({ user_id, brand: graph.byId.get(brand_id)?.name ?? brand_id, moved: +moved.toFixed(2) })
    }
  }

  const dead_expansions: HealthReport['dead_expansions'] = []
  const { data: impressions } = await admin
    .from('discovery_impression')
    .select('hero_brand_id, outcome')
    .limit(10000)
  const byBrand = new Map<string, { total: number; engaged: number }>()
  for (const i of impressions ?? []) {
    if (!i.hero_brand_id) continue
    const t = byBrand.get(i.hero_brand_id) ?? { total: 0, engaged: 0 }
    t.total++
    if (i.outcome === 'engaged') t.engaged++
    byBrand.set(i.hero_brand_id, t)
  }
  const impressionEntries = Array.from(byBrand.entries())
  for (const [brandId, t] of impressionEntries) {
    if (t.total >= 10 && t.engaged === 0) {
      dead_expansions.push({ brand: graph.byId.get(brandId)?.name ?? brandId, impressions: t.total })
    }
  }

  const { data: freeText } = await admin.from('unmatched_brand_log').select('raw_name').limit(2000)
  const counts = new Map<string, number>()
  for (const r of freeText ?? []) {
    const k = brandKey(r.raw_name)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const free_text_brands = Array.from(counts.entries())
    .map(([raw_name, count]) => ({ raw_name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30)

  return {
    generated_at: new Date().toISOString(),
    orphan_brands, incoherent_families, tier_violations, stale_vectors,
    starved_feeds, dead_expansions, runaway_learning, free_text_brands,
  }
}

// ── weekly job: vectors → re-expansion → health report ──────────────────────

export async function runBrandAffinityWeekly(adminIn?: Admin): Promise<{ vectors: number; reExpanded: number; report: HealthReport }> {
  const admin = (adminIn ?? createAdminClient()) as any
  const { updated } = await recomputeBrandVectors(admin)

  // taste keeps widening from CONFIRMED brands: re-run expansion for brands
  // upgraded to learned ≥ 0.8
  let reExpanded = 0
  const { data: confirmed } = await admin
    .from('user_brand_affinity')
    .select('user_id, brand_id')
    .eq('source', 'learned')
    .gte('affinity', RE_EXPANSION_THRESHOLD)
    .limit(2000)
  const graph = await loadBrandGraph(admin)
  const byUser = new Map<string, string[]>()
  for (const r of confirmed ?? []) {
    const list = byUser.get(r.user_id) ?? []
    list.push(r.brand_id)
    byUser.set(r.user_id, list)
  }
  const userEntries = Array.from(byUser.entries())
  for (const [userId, brandIds] of userEntries) {
    const named = brandIds.map((id) => graph.byId.get(id)).filter(Boolean) as BrandLite[]
    const similarByBrand = new Map<string, SimilarBrand[]>()
    for (const b of named) similarByBrand.set(b.brand_id, await getSimilarBrands(admin, b.brand_id, graph))
    const seeds = expansionSeeds(named, similarByBrand)
    const existing = await loadAffinities(admin, userId)
    const seedRows = Array.from(seeds.values())
    for (const s of seedRows) {
      const old = existing.get(s.brand_id)
      if (old && old.affinity >= s.value) continue
      await writeAffinity(admin, userId, s.brand_id,
        { affinity: s.value, source: old?.source === 'learned' ? 'learned' : 'expanded', expansion_trace: s.trace },
        'expanded', `weekly re-expansion: ${s.trace}`, old?.affinity ?? null)
      reExpanded++
    }
  }

  const report = await runHealthChecks(admin)
  const monday = new Date()
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  await admin.from('brand_health_report').upsert(
    { week_start: monday.toISOString().slice(0, 10), report },
    { onConflict: 'week_start' },
  )
  return { vectors: updated, reExpanded, report }
}
