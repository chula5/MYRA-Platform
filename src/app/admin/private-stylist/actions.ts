// NOT a 'use server' module, on purpose: every export of a 'use server' file is
// callable by anyone from the browser, and these run without an admin session
// (cron, src/lib pipelines, /me client actions). The admin UI calls the admin-gated
// wrappers in ./actions.gated.ts. Don't add 'use server' here.

// PRIVATE STYLIST — always-on stylist pilot, admin-only, nothing public.
//
// The weekly loop: request (or anticipation move) → assemble 3 looks,
// room-weighted, occasion-tilted → stock + size checked at send → she responds
// yes / no / why (enum, not prose) → clicks + purchases logged → weekly
// recompute of room weights from responses.
//
// Contamination rule: is_synthetic rows test the PLUMBING, never train the
// taste. Real members' recomputes read only non-synthetic rows; nothing in
// this section writes to the live taste tables at all.

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import {
  applyBrandSignals,
  seedUserAffinities,
  loadBrandGraph,
  codesComplete,
  codesVector,
  pcaProject1D,
  isThinBrand,
  resolveBrandNames,
} from '@/lib/brand-affinity'
import {
  type RoomWeights,
  type OccasionId,
  type WorkDressCode,
  type Frequency,
  type RankedBrand,
  type LookItem,
  type ResponseReason,
  SYNTH_PERSONAS,
  PILOT_SIGNAL_WEIGHTS,
  type PilotTasteEventType,
  effectiveWeights,
  roomWeightsFromBrands,
  replayEvents,
  lookTasteVector,
  calibrationPlan,
  validateDelivery,
  normalise,
  readStylePrefs,
  readPriceBands,
  type StylePrefs,
  type PriceBands,
} from '@/lib/pilot-stylist'
import { accumulate, zeroVector } from '@/lib/taste-vector'
import { getAllItems, type ItemWithBrand } from '@/lib/admin-queries'
import {
  composeMemberLooks,
  composeMemberVariants,
  rankAlternates,
  toLookItem,
  lookSignature,
  DEFAULT_OWNED_TARGET_SHARE,
  type ComposeOptions,
  type MemberTaste,
  type OccasionContext,
  type PersonaLens,
  type ComposeHistory,
} from '@/lib/pilot-composer'
import { listOwnedItems, looksUsingItems } from '@/lib/wardrobe/store'
import { ownerRefsForMember, isOwnedItem, styledInCounts } from '@/lib/wardrobe/owned-items'
import { resolveClientMember, firstNameOf } from '@/lib/client-member'
import { whyThisSuitsHer } from '@/lib/look-why'
import { CLIENT_OCCASIONS, occasionsForMember } from '@/lib/client-occasions'
import { checkRenderFidelity } from '@/app/admin/ai/render-fidelity'
import { loadMemberSizeProfile, filterItemsForShopper } from '@/lib/size-availability'
import { checkSizesForMember } from '@/lib/look-size-check'
import { judgeLooksForMember, hasPieceOutOfSize } from '@/lib/look-check'
import { pendingAlertsForUser, markDelivered, ALERT_COPY } from '@/lib/stock-alerts'
import { personaWeight, PERSONA_START_WEIGHT } from '@/lib/user-persona'
import { slotForItemType, type Slot } from '@/lib/composer'
import {
  HIGGSFIELD_COMBOS,
  buildGenerationPrompt,
  buildReferenceUrls,
  type ShootItem,
} from '@/lib/higgsfield-shoot'
import { runHiggsfieldGeneration } from '@/app/admin/projects/higgsfield-actions'
import { buildTraitModel, type TraitModel, type TraitItem, type TraitDecision } from '@/lib/member-traits'
import { readTrust, trustHeadline, TRAILING, type LookOutcome, type TrustRead } from '@/lib/member-trust'
import { explainTraits } from '@/lib/member-traits'
import { type ClimateId } from '@/lib/climate'
import { DEFAULT_SCOPE, parsePatternKey, type LearnedRuleMatch } from '@/lib/learning-scope'
import { tooSimilarVariant, REFERENCE_LENS_WEIGHT } from '@/lib/pilot-composer'
import { pieceVerdicts } from '@/lib/piece-verdicts'
import { rulesForMember, type MemberRules } from '@/lib/style-rules'
import { loadStyleModel, recordStyleDecision } from '@/lib/style-brain-store'
import { computeEnvelope } from '@/lib/inspiration'
import { linkMemberToStyleProfile } from '@/lib/style-profile-store'
import { correctPaleColour } from '@/lib/pale-colour-store'
import { loadEjectionConstraints } from '@/lib/pipeline-store'
import { loadLearnedMaterialPairs } from '@/lib/house-style-store'

const PATH = '/admin/private-stylist'

// ── Types shared with the client ────────────────────────────────────────────

export interface PilotMember {
  member_id: string
  name: string
  is_synthetic: boolean
  brands: RankedBrand[]
  brands_input_only: string[]
  room_weights: RoomWeights
  occasions: Partial<Record<OccasionId, Frequency>>
  work_dress_code: WorkDressCode | null
  sizes: Record<string, string>
  budget_ceiling: Record<string, number>
  never_wears: string | null
  notes: string | null
  // Authored style preferences (migration 0045) — what she says about her own
  // taste, as opposed to what the feedback loop infers.
  colours_loved: string[]
  colours_avoided: string[]
  shapes_loved: string[]
  shapes_avoided: string[]
  types_loved: string[]
  types_avoided: string[]
  /** What she actually spends, per bucket (migration 0049). */
  price_bands: PriceBands
  created_at: string
  // Σ signal_weight × look vector across her taste events — the 34-dim view
  taste_vector: number[] | null
  taste_event_counts: Record<PilotTasteEventType, number>
  // Soft persona assignment — the lens her looks are composed through.
  persona_id: string | null
  persona_name: string | null
  persona_weight: number | null
  persona_has_envelope: boolean
  // Wardrobe import (migration 0046): her login, if linked, and how many owned
  // pieces are approved and composable.
  auth_user_id: string | null
  owned_count: number
  events: { event_id: string; label: string; event_date: string; done: boolean }[]
  wardrobe: {
    wardrobe_id: string
    label: string
    brand: string | null
    item_type: string | null
    colour: string | null
    notes: string | null
  }[]
  snapshots: { snapshot_id: string; room_weights: RoomWeights; source: string; note: string | null; created_at: string }[]
}

export interface PilotLook {
  look_id: string
  delivery_id: string
  position: number
  room_mix: RoomWeights
  items: LookItem[]
  image_url: string | null
  notes: string | null
  response: 'yes' | 'no' | null
  response_reason: ResponseReason | null
  responded_at: string | null
  approved_at: string | null
  shoot_history: { url: string; pose?: string; created_at?: string }[]
  /** Looks that style the same hero several ways share a variant_group. */
  variant_group: string | null
  /** She can see this one in her own area. */
  visible_to_client?: boolean
  published_at?: string | null
  hero_item_id: string | null
}

export interface PilotDelivery {
  delivery_id: string
  member_id: string
  trigger: 'request' | 'anticipation' | 'calibration'
  request_text: string | null
  occasion: OccasionId | null // null = calibration set (no occasion tilt)
  effective_weights: RoomWeights
  status: 'draft' | 'sent' | 'responded'
  is_synthetic: boolean
  dry_run_brief: string | null
  created_at: string
  sent_at: string | null
  looks: PilotLook[]
}

export interface PilotActivity {
  activity_id: string
  member_id: string
  delivery_id: string | null
  look_id: string | null
  type: 'click_out' | 'purchase' | 'save' | 'unprompted_return' | 'stock_moved' | 'note'
  detail: string | null
  is_synthetic: boolean
  created_at: string
}

export interface ExitArtefact {
  intakeWeights: RoomWeights | null
  currentWeights: RoomWeights
  deliveriesSent: number
  looksSent: number
  looksResponded: number
  acceptedOverall: number
  newBrandLooksSent: number
  newBrandLooksAccepted: number
  clicks: number
  purchases: number
  saves: number
  unpromptedReturns: number
  stockChecks: number
  stockMoved: number
}

export interface PilotData {
  ready: boolean
  missingMigration: '0029' | '0030' | null
  /** False until 0045 adds the style-preference columns — the editor says so
   *  rather than letting a save fail silently far from the button. */
  stylePrefsReady: boolean
  /** False until 0049 adds price_bands. */
  priceBandsReady: boolean
  members: PilotMember[]
  deliveries: PilotDelivery[]
  activity: PilotActivity[]
  artefacts: Record<string, ExitArtefact>
  /** Live/seeding personas a member can be styled through. */
  personas: { stylist_id: string; name: string; hasEnvelope: boolean }[]
}

// ── Load everything (pilot scale: two members, weeks of data — tiny) ────────

export async function loadPilotData(): Promise<PilotData> {
  const admin = createAdminClient()
  const [membersRes, eventsRes, wardrobeRes, snapshotsRes, deliveriesRes, looksRes, activityRes, tasteRes] =
    await Promise.all([
      admin.from('pilot_member' as any).select('*').order('created_at'),
      admin.from('pilot_known_event' as any).select('*').order('event_date'),
      admin.from('pilot_wardrobe_item' as any).select('*').order('created_at'),
      admin.from('pilot_weight_snapshot' as any).select('*').order('created_at'),
      admin.from('pilot_delivery' as any).select('*').order('created_at', { ascending: false }),
      admin.from('pilot_look' as any).select('*').order('position'),
      admin.from('pilot_activity' as any).select('*').order('created_at', { ascending: false }),
      admin.from('pilot_taste_event' as any).select('*').order('created_at'),
    ])

  // Table missing → migration not run. Render the section with a notice
  // instead of crashing the whole admin.
  if (membersRes.error) {
    return { ready: false, missingMigration: '0029', stylePrefsReady: false, priceBandsReady: false, members: [], deliveries: [], activity: [], artefacts: {}, personas: [] }
  }
  if (tasteRes.error) {
    return { ready: false, missingMigration: '0030', stylePrefsReady: false, priceBandsReady: false, members: [], deliveries: [], activity: [], artefacts: {}, personas: [] }
  }

  // Personas a member can be styled through, and who is currently assigned.
  // Both degrade to empty if migrations 0039/0043 haven't been run.
  const adminAny = admin as any
  const [personaRes, assignRes] = await Promise.all([
    adminAny.from('stylist').select('stylist_id, name, envelope, type').eq('type', 'persona').order('name'),
    adminAny.from('user_persona').select('user_id, persona_id, weight').eq('subject_kind', 'pilot_member'),
  ])
  const personas = ((personaRes?.data ?? []) as any[]).map((p) => ({
    stylist_id: p.stylist_id,
    name: p.name,
    hasEnvelope: Boolean(p.envelope?.mean?.length),
  }))
  const personaById = new Map(personas.map((p) => [p.stylist_id, p]))
  const assignByMember = new Map(((assignRes?.data ?? []) as any[]).map((a) => [a.user_id, a]))

  const events = (eventsRes.data ?? []) as any[]
  const wardrobe = (wardrobeRes.data ?? []) as any[]
  const snapshots = (snapshotsRes.data ?? []) as any[]
  const looks = (looksRes.data ?? []) as any[]
  const tasteEvents = (tasteRes.data ?? []) as any[]

  // A pre-0045 row simply has no preference keys — that is how we know.
  const firstRow = ((membersRes.data ?? []) as any[])[0]
  const stylePrefsReady = firstRow ? 'colours_loved' in firstRow : true
  const priceBandsReady = firstRow ? 'price_bands' in firstRow : true

  // Approved owned pieces per member (0 everywhere before migration 0046).
  const ownedCount = new Map<string, number>()
  try {
    const { data: ownedRows } = await adminAny.from('item').select('owner_user_id').eq('ownership', 'owned').neq('status', 'archived').limit(5000)
    for (const r of (ownedRows ?? []) as any[]) ownedCount.set(r.owner_user_id, (ownedCount.get(r.owner_user_id) ?? 0) + 1)
  } catch { /* pre-migration */ }

  const members: PilotMember[] = ((membersRes.data ?? []) as any[]).map((m) => {
    const mine = tasteEvents.filter((t) => t.member_id === m.member_id)
    const counts = { yes: 0, no: 0, save: 0, click_out: 0, purchase: 0 } as Record<PilotTasteEventType, number>
    for (const t of mine) if (t.event_type in counts) counts[t.event_type as PilotTasteEventType]++
    return {
      ...m,
      ...readStylePrefs(m),
      price_bands: readPriceBands(m),
      taste_vector: m.taste_vector ?? null,
      taste_event_counts: counts,
      events: events.filter((e) => e.member_id === m.member_id),
      wardrobe: wardrobe.filter((w) => w.member_id === m.member_id),
      snapshots: snapshots.filter((s) => s.member_id === m.member_id),
      persona_id: assignByMember.get(m.member_id)?.persona_id ?? null,
      persona_name: personaById.get(assignByMember.get(m.member_id)?.persona_id)?.name ?? null,
      persona_weight: assignByMember.get(m.member_id)?.weight ?? null,
      persona_has_envelope: personaById.get(assignByMember.get(m.member_id)?.persona_id)?.hasEnvelope ?? false,
      auth_user_id: m.auth_user_id ?? null,
      owned_count: (ownedCount.get(m.member_id) ?? 0) + (m.auth_user_id ? ownedCount.get(m.auth_user_id) ?? 0 : 0),
    }
  })

  const deliveries: PilotDelivery[] = ((deliveriesRes.data ?? []) as any[]).map((d) => ({
    ...d,
    looks: looks.filter((l) => l.delivery_id === d.delivery_id),
  }))

  const activity = (activityRes.data ?? []) as PilotActivity[]

  const artefacts: Record<string, ExitArtefact> = {}
  for (const m of members) {
    artefacts[m.member_id] = buildArtefact(m, deliveries, activity)
  }

  return { ready: true, missingMigration: null, stylePrefsReady, priceBandsReady, members, personas, deliveries, activity, artefacts }
}

function buildArtefact(
  m: PilotMember,
  deliveries: PilotDelivery[],
  activity: PilotActivity[],
): ExitArtefact {
  const mine = deliveries.filter((d) => d.member_id === m.member_id && d.status !== 'draft')
  const named = new Set(m.brands.map((b) => b.name.toLowerCase()))
  let looksSent = 0
  let looksResponded = 0
  let acceptedOverall = 0
  let newBrandLooksSent = 0
  let newBrandLooksAccepted = 0
  for (const d of mine) {
    for (const l of d.looks) {
      looksSent++
      const introducesNew = l.items.some((it) => !it.owned && !named.has(it.brand.toLowerCase()))
      if (introducesNew) newBrandLooksSent++
      if (l.response) {
        looksResponded++
        if (l.response === 'yes') {
          acceptedOverall++
          if (introducesNew) newBrandLooksAccepted++
        }
      }
    }
  }
  const acts = activity.filter((a) => a.member_id === m.member_id)
  const stockChecks = mine.flatMap((d) => d.looks).flatMap((l) => l.items).filter((it) => !it.owned && it.stock_checked_at).length
  return {
    intakeWeights: m.snapshots.find((s) => s.source === 'intake')?.room_weights ?? null,
    currentWeights: m.room_weights,
    deliveriesSent: mine.length,
    looksSent,
    looksResponded,
    acceptedOverall,
    newBrandLooksSent,
    newBrandLooksAccepted,
    clicks: acts.filter((a) => a.type === 'click_out').length,
    purchases: acts.filter((a) => a.type === 'purchase').length,
    saves: acts.filter((a) => a.type === 'save').length,
    unpromptedReturns: acts.filter((a) => a.type === 'unprompted_return').length,
    stockChecks,
    stockMoved: acts.filter((a) => a.type === 'stock_moved').length,
  }
}

// ── Members ─────────────────────────────────────────────────────────────────

export async function createMember(input: {
  name: string
  is_synthetic?: boolean
  brands: RankedBrand[]
  brands_input_only: string[]
  room_weights?: RoomWeights // omit to compute from brands
  occasions: Partial<Record<OccasionId, Frequency>>
  work_dress_code: WorkDressCode | null
  sizes?: Record<string, string>
  budget_ceiling?: Record<string, number>
  never_wears?: string
  notes?: string
}): Promise<{ member_id?: string; error?: string }> {
  const admin = createAdminClient()
  const weights = normalise(input.room_weights ?? roomWeightsFromBrands(input.brands))
  const { data, error } = await admin
    .from('pilot_member' as any)
    .insert({
      name: input.name,
      is_synthetic: input.is_synthetic ?? false,
      brands: input.brands,
      brands_input_only: input.brands_input_only,
      room_weights: weights,
      occasions: input.occasions,
      work_dress_code: input.work_dress_code,
      sizes: input.sizes ?? {},
      budget_ceiling: input.budget_ceiling ?? {},
      never_wears: input.never_wears ?? null,
      notes: input.notes ?? null,
    })
    .select('member_id')
    .single()
  if (error) return { error: error.message }
  const memberId = (data as any).member_id as string
  await admin.from('pilot_weight_snapshot' as any).insert({
    member_id: memberId,
    room_weights: weights,
    source: 'intake',
    note: 'Intake — computed at onboarding',
  })
  // Brand-affinity onboarding seed: named brands 1.0, similar brands expanded
  // with a trace, everything else at baseline; warm-starts the taste vector.
  // Best-effort — onboarding must not fail if 0032 hasn't run yet.
  try {
    const names = [...input.brands.map((b) => b.name), ...(input.brands_input_only ?? [])]
    if (names.length) await seedUserAffinities(admin, memberId, names)
  } catch { /* brand affinity is additive; ignore */ }
  revalidatePath(PATH)
  return { member_id: memberId }
}

// Add a brand to a member's world by hand, or take one out. The graph is the
// place Chloe spots a wrong suggestion, so it is the place to correct it.
export async function addMemberBrand(memberId: string, brandName: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const name = brandName.trim()
  if (!name) return { error: 'NO BRAND NAME' }
  try {
    const graph = await loadBrandGraph(admin)
    const { matched } = resolveBrandNames(graph, [name])
    if (!matched.length) return { error: `${name.toUpperCase()} IS NOT IN MYRA'S BRAND TABLE` }
    const b = matched[0]
    const { error } = await admin.from('user_brand_affinity').upsert(
      { user_id: memberId, brand_id: b.brand_id, affinity: 1, source: 'onboarded', expansion_trace: null, hidden: false },
      { onConflict: 'user_id,brand_id' },
    )
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// Removing is a judgement ("not her"), so it is remembered as hidden rather
// than deleted — a later re-seed must not quietly bring it back.
export async function removeMemberBrand(memberId: string, brandId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { error } = await admin
    .from('user_brand_affinity')
    .update({ hidden: true, affinity: 0.05 })
    .eq('user_id', memberId)
    .eq('brand_id', brandId)
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}

export async function restoreMemberBrand(memberId: string, brandId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { error } = await admin
    .from('user_brand_affinity')
    .update({ hidden: false })
    .eq('user_id', memberId)
    .eq('brand_id', brandId)
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}

// ── Per-member brand map ────────────────────────────────────────────────────
// The same positions as the Taste Inspector map, but coloured for ONE member:
// which brands she named, which MYRA expanded to from those, which have been
// confirmed by her responses, and which are just stock she has no relationship
// with. This is the check that the right brands are reaching her composer.

export interface MemberBrandDot {
  brand_id: string
  name: string
  x: number | null // codes PCA (or provisional item-centroid PCA)
  price_position: number | null // ln £
  medianPrice: number | null
  coded: boolean
  itemCount: number
  affinity: number
  role: 'named' | 'suggested' | 'learned' | 'baseline' | 'hidden'
  trace: string | null // "because you like X"
}

export interface MemberBrandMap {
  dots: MemberBrandDot[]
  counts: Record<string, number>
  unmatched: string[] // named brands with no brand row — they influence nothing
  migrationNeeded?: boolean
  error?: string
}

export async function loadMemberBrandMap(memberId: string): Promise<MemberBrandMap> {
  const admin = createAdminClient() as any
  const empty: MemberBrandMap = { dots: [], counts: {}, unmatched: [] }
  try {
    const graph = await loadBrandGraph(admin)

    // Identical X-axis derivation to the Taste Inspector, so a brand sits in
    // the same place on both maps.
    const coded = graph.brands.filter((b: any) => codesComplete(b))
    const codesProj = pcaProject1D(coded.map((b: any) => codesVector(b.codes!).map((v: number) => v - 3)))
    const xById = new Map<string, number>(coded.map((b: any, i: number) => [b.brand_id, codesProj[i]]))
    const provisional = graph.brands.filter((b: any) => !codesComplete(b) && b.brand_vector && !isThinBrand(b))
    const vecProj = pcaProject1D(provisional.map((b: any) => b.brand_vector!))
    provisional.forEach((b: any, i: number) => xById.set(b.brand_id, vecProj[i]))

    const { data: affRows } = await admin
      .from('user_brand_affinity')
      .select('brand_id, affinity, source, expansion_trace, hidden, positive_count')
      .eq('user_id', memberId)
    const affById = new Map<string, any>((affRows ?? []).map((r: any) => [r.brand_id, r]))

    const { data: member } = await admin.from('pilot_member').select('brands, brands_input_only').eq('member_id', memberId).single()
    const namedRaw: string[] = [
      ...(((member?.brands ?? []) as RankedBrand[]).map((b) => b.name)),
      ...((member?.brands_input_only ?? []) as string[]),
    ]
    // Use the SAME resolver the recommender uses — a plain lowercase compare
    // misses "Sessun" → "Sessùn" and "Adolfo Domingues" → "Adolfo Domínguez",
    // and would wrongly report a live brand as reaching nothing.
    const { matched: namedBrands, unmatched } = resolveBrandNames(graph, namedRaw)
    const namedIds = new Set(namedBrands.map((b: any) => b.brand_id))

    const counts: Record<string, number> = { named: 0, suggested: 0, learned: 0, baseline: 0, hidden: 0 }
    const dots: MemberBrandDot[] = graph.brands.map((b: any) => {
      const a = affById.get(b.brand_id)
      const isNamed = namedIds.has(b.brand_id) || a?.source === 'onboarded'
      let role: MemberBrandDot['role'] = 'baseline'
      if (a?.hidden) role = 'hidden'
      else if (isNamed) role = 'named'
      else if (a?.source === 'learned') role = 'learned'
      else if (a?.expansion_trace && a.expansion_trace !== 'baseline') role = 'suggested'
      counts[role]++
      return {
        brand_id: b.brand_id,
        name: b.name,
        x: xById.get(b.brand_id) ?? null,
        price_position: b.price_position,
        medianPrice: b.median_price_overall,
        coded: codesComplete(b),
        itemCount: b.vector_item_count,
        affinity: a?.affinity ?? 0,
        role,
        trace: a?.expansion_trace && a.expansion_trace !== 'baseline' ? a.expansion_trace : null,
      }
    })

    // A named brand MYRA has no row for cannot reach the composer at all.
    return { dots, counts, unmatched }
  } catch (e) {
    return { ...empty, migrationNeeded: true, error: e instanceof Error ? e.message : String(e) }
  }
}

// Edit a member's ranked brands after onboarding. Ranks are renumbered from
// the order given, so moving a brand up is just a reorder. Room weights are
// deliberately NOT recomputed from the new list — they have been learning from
// her responses since intake, and recomputing would throw that away.
export async function setMemberBrands(
  memberId: string,
  brands: RankedBrand[],
  inputOnly: string[],
): Promise<{ error?: string; unmatched?: string[] }> {
  const admin = createAdminClient()
  const clean: RankedBrand[] = []
  const seen = new Set<string>()
  for (const b of brands) {
    const name = (b.name ?? '').trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    clean.push({ name, rank: clean.length + 1, inferred_why: b.inferred_why?.trim() || undefined })
  }
  const cleanInputOnly = Array.from(
    new Map(inputOnly.map((n) => [n.trim().toLowerCase(), n.trim()])).values(),
  ).filter(Boolean)

  const { error } = await admin
    .from('pilot_member' as any)
    .update({ brands: clean, brands_input_only: cleanInputOnly, updated_at: new Date().toISOString() })
    .eq('member_id', memberId)
  if (error) return { error: error.message }

  // Dropping a brand must also drop what it dragged in. Expansions carry
  // "... via <BRAND>" in their trace, so an expansion whose source is no
  // longer named is retired — unless her own responses have since confirmed
  // it, in which case it stands on its own evidence.
  try {
    const keep = new Set(clean.map((b) => b.name.toLowerCase()))
    const { data: rows } = await admin
      .from('user_brand_affinity')
      .select('brand_id, expansion_trace, source, positive_count')
      .eq('user_id', memberId)
    for (const r of (rows ?? []) as any[]) {
      const via = /via (.+)$/.exec(r.expansion_trace ?? '')?.[1]?.trim().toLowerCase()
      if (!via || keep.has(via)) continue
      if (r.source === 'learned' || (r.positive_count ?? 0) > 0) continue
      await admin.from('user_brand_affinity').delete().eq('user_id', memberId).eq('brand_id', r.brand_id)
    }
  } catch { /* best-effort */ }

  // Re-seed so a newly named brand actually reaches the recommender. Safe to
  // re-run: seeding skips anything already at or above its seed value and
  // never demotes a learned affinity.
  let unmatched: string[] = []
  try {
    const names = [...clean.map((b) => b.name), ...cleanInputOnly]
    if (names.length) {
      const res = await seedUserAffinities(admin as any, memberId, names)
      unmatched = res.unmatched ?? []
    }
  } catch { /* brand affinity is additive; ignore */ }

  revalidatePath(PATH)
  // A name MYRA has no brand row for cannot influence anything — say so.
  return unmatched.length ? { unmatched } : {}
}

export async function updateMember(
  memberId: string,
  patch: Partial<{
    name: string
    brands: RankedBrand[]
    brands_input_only: string[]
    room_weights: RoomWeights
    occasions: Partial<Record<OccasionId, Frequency>>
    work_dress_code: WorkDressCode | null
    sizes: Record<string, string>
    budget_ceiling: Record<string, number>
    never_wears: string | null
    notes: string | null
    colours_loved: string[]
    colours_avoided: string[]
    shapes_loved: string[]
    shapes_avoided: string[]
    types_loved: string[]
    types_avoided: string[]
    price_bands: PriceBands
  }>,
): Promise<{ error?: string }> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('pilot_member' as any)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('member_id', memberId)
  revalidatePath(PATH)
  if (!error) return {}
  // The style-preference columns arrive with 0045 — say so rather than
  // showing a raw PostgREST column error.
  // PostgREST says either "column ... does not exist" or, for an update,
  // "Could not find the 'x' column of 'pilot_member' in the schema cache".
  if (/does not exist|schema cache/i.test(error.message)) {
    const which = /price_bands/.test(error.message) ? '0049_pilot_price_bands.sql' : '0045_pilot_style_preferences.sql'
    return { error: `${error.message} — RUN MIGRATION ${which} IN SUPABASE` }
  }
  return { error: error.message }
}

export async function deleteMember(memberId: string): Promise<{ error?: string }> {
  const admin = createAdminClient()
  const { error } = await admin.from('pilot_member' as any).delete().eq('member_id', memberId)
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}

// ── Dry-run seeding (§4b) ───────────────────────────────────────────────────

export async function seedSyntheticPersonas(): Promise<{ seeded?: number; error?: string }> {
  const admin = createAdminClient()
  const { data: existing, error: exErr } = await admin
    .from('pilot_member' as any)
    .select('name')
    .eq('is_synthetic', true)
  if (exErr) return { error: exErr.message }
  const have = new Set(((existing ?? []) as any[]).map((m) => m.name))
  let seeded = 0
  for (const p of SYNTH_PERSONAS) {
    if (have.has(p.name)) continue
    const res = await createMember({
      name: p.name,
      is_synthetic: true,
      brands: p.brands,
      brands_input_only: p.brands_input_only,
      room_weights: p.room_weights, // spec's hand-set guesses, not computed
      occasions: p.occasions,
      work_dress_code: p.work_dress_code,
      notes: p.notes,
    })
    if (res.error) return { error: res.error }
    for (const e of p.known_events) {
      await admin.from('pilot_known_event' as any).insert({
        member_id: res.member_id,
        label: e.label,
        event_date: e.event_date,
      })
    }
    for (const w of p.wardrobe) {
      await admin.from('pilot_wardrobe_item' as any).insert({
        member_id: res.member_id,
        label: w.label,
        brand: w.brand,
        item_type: w.item_type,
      })
    }
    seeded++
  }
  revalidatePath(PATH)
  return { seeded }
}

// ── Events & wardrobe ───────────────────────────────────────────────────────

export async function addKnownEvent(memberId: string, label: string, eventDate: string) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('pilot_known_event' as any)
    .insert({ member_id: memberId, label, event_date: eventDate })
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}

export async function removeKnownEvent(eventId: string) {
  const admin = createAdminClient()
  const { error } = await admin.from('pilot_known_event' as any).delete().eq('event_id', eventId)
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}

export async function addWardrobeItem(
  memberId: string,
  item: { label: string; brand?: string; item_type?: string; colour?: string; notes?: string },
) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('pilot_wardrobe_item' as any)
    .insert({ member_id: memberId, ...item })
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}

export async function removeWardrobeItem(wardrobeId: string) {
  const admin = createAdminClient()
  const { error } = await admin.from('pilot_wardrobe_item' as any).delete().eq('wardrobe_id', wardrobeId)
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}

// ── Deliveries & looks ──────────────────────────────────────────────────────

export async function createDelivery(input: {
  member_id: string
  trigger: 'request' | 'anticipation'
  request_text: string
  occasion: OccasionId
  // Hot, mild or cold where she is going. Unstated behaves exactly as before.
  climate?: ClimateId | null
  dry_run_brief?: string
}): Promise<{ delivery_id?: string; error?: string }> {
  const admin = createAdminClient()
  const { data: member, error: mErr } = await admin
    .from('pilot_member' as any)
    .select('room_weights, work_dress_code, is_synthetic')
    .eq('member_id', input.member_id)
    .single()
  if (mErr || !member) return { error: mErr?.message ?? 'MEMBER NOT FOUND' }
  const m = member as any
  const weights = effectiveWeights(m.room_weights, input.occasion, m.work_dress_code)
  const row: Record<string, unknown> = {
    member_id: input.member_id,
    trigger: input.trigger,
    request_text: input.request_text,
    occasion: input.occasion,
    effective_weights: weights,
    is_synthetic: m.is_synthetic,
    dry_run_brief: input.dry_run_brief ?? null,
  }
  if (input.climate) row.climate = input.climate
  const { data, error } = await admin.from('pilot_delivery' as any).insert(row).select('delivery_id').single()
  // Saving the delivery WITHOUT the climate was the wrong trade. A hot holiday
  // with the weather quietly dropped composes knee-high boots and a cashmere
  // poncho, and nothing on screen says why — the single most important input
  // for that delivery is the one thing that went missing. Fail, and name the
  // migration.
  if (error && /schema cache|does not exist/i.test(error.message) && input.climate) {
    return { error: 'Run migration 0051 in Supabase first — the weather cannot be saved without it, and a hot holiday would come back in wool.' }
  }
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return { delivery_id: (data as any).delivery_id }
}

// Taste-calibration onboarding: one delivery with 3 scaffolded looks, one per
// room, ordered dominant → weakest. Chloe assembles the actual outfits into
// the scaffolds; the member then LIKEs / DISLIKEs each. No occasion tilt —
// effective weights snapshot her raw weighting.
export async function createCalibrationSet(
  memberId: string,
): Promise<{ delivery_id?: string; error?: string }> {
  const admin = createAdminClient()
  const { data: member, error: mErr } = await admin
    .from('pilot_member' as any)
    .select('name, brands, room_weights, is_synthetic')
    .eq('member_id', memberId)
    .single()
  if (mErr || !member) return { error: mErr?.message ?? 'MEMBER NOT FOUND' }
  const m = member as any
  const { data, error } = await admin
    .from('pilot_delivery' as any)
    .insert({
      member_id: memberId,
      trigger: 'calibration',
      request_text: 'Taste calibration — like / dislike each look',
      occasion: null,
      effective_weights: m.room_weights,
      is_synthetic: m.is_synthetic,
    })
    .select('delivery_id')
    .single()
  if (error) return { error: error.message }
  const deliveryId = (data as any).delivery_id as string
  for (const plan of calibrationPlan(m.brands ?? [], m.room_weights)) {
    const { error: lErr } = await admin.from('pilot_look' as any).insert({
      delivery_id: deliveryId,
      position: plan.position,
      room_mix: plan.room_mix,
      taste_vector: lookTasteVector(plan.room_mix),
      items: [],
      notes: plan.note,
    })
    if (lErr) return { error: lErr.message }
  }
  revalidatePath(PATH)
  return { delivery_id: deliveryId }
}

export async function deleteDelivery(deliveryId: string) {
  const admin = createAdminClient()
  const { error } = await admin.from('pilot_delivery' as any).delete().eq('delivery_id', deliveryId)
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}

export async function saveLook(input: {
  look_id?: string
  delivery_id: string
  position: number
  room_mix: RoomWeights
  items: LookItem[]
  image_url?: string
  notes?: string
}): Promise<{ look_id?: string; error?: string }> {
  const admin = createAdminClient()
  const mix = normalise(input.room_mix)
  const row = {
    delivery_id: input.delivery_id,
    position: input.position,
    room_mix: mix,
    // every look carries its 34-dim vector (room-centroid blend) so any
    // signal against it can teach the member's taste vector
    taste_vector: lookTasteVector(mix),
    items: input.items,
    image_url: input.image_url || null,
    notes: input.notes || null,
  }
  if (input.look_id) {
    const { error } = await admin.from('pilot_look' as any).update(row).eq('look_id', input.look_id)
    revalidatePath(PATH)
    return error ? { error: error.message } : { look_id: input.look_id }
  }
  const { data, error } = await admin.from('pilot_look' as any).insert(row).select('look_id').single()
  revalidatePath(PATH)
  return error ? { error: error.message } : { look_id: (data as any).look_id }
}

async function wipeLookLearning(admin: any, lookIds: string[]): Promise<number> {
  if (!lookIds.length) return 0
  const { count } = await admin
    .from('pilot_look_feedback').select('feedback_id', { count: 'exact', head: true }).in('look_id', lookIds)
  await admin.from('pilot_look_feedback').delete().in('look_id', lookIds)
  await admin.from('pilot_taste_event').delete().in('look_id', lookIds)
  await admin.from('pilot_activity').delete().in('look_id', lookIds).eq('type', 'note')
  return count ?? 0
}

/**
 * Remove a look from the delivery entirely.
 *
 * Its learning goes with it. Deleting used to leave the feedback rows behind —
 * they survive with a null look_id, because the foreign key is ON DELETE SET
 * NULL, and carry on feeding the trait model. Alison had 197 of them: a third
 * of everything the composer had learned came from looks that no longer exist.
 * A look nobody kept is not a taste signal.
 */
export async function deleteLook(lookId: string) {
  const admin = createAdminClient() as any
  await wipeLookLearning(admin, [lookId])
  const { error } = await admin.from('pilot_look').delete().eq('look_id', lookId)
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}

/**
 * Empty a look and undo everything it taught.
 *
 * Not a delete: the look stays in the delivery, in position, ready to be
 * composed into again. What goes is its contents — the items, the shoot, the
 * approval, her verdict — and every trace it left in the learning: the swap
 * and removal rows that feed the trait model, the taste events that move her
 * vector, the notes.
 *
 * The point is a look that was simply wrong — wrong brief, wrong weather, a
 * mistake — leaving no mark at all. Deleting it was not enough on its own,
 * because the feedback rows survive a delete with a null look_id and keep
 * teaching from a composition that was thrown away.
 */
// Everything a look holds, back to how it arrived.
const EMPTY_LOOK = {
  items: [],
  image_url: null,
  shoot_history: [],
  approved_at: null,
  response: null,
  response_reason: null,
  responded_at: null,
}

export async function clearLook(lookId: string): Promise<{ cleared?: number; error?: string }> {
  const admin = createAdminClient() as any
  try {
    const cleared = await wipeLookLearning(admin, [lookId])
    const { error } = await admin.from('pilot_look').update(EMPTY_LOOK).eq('look_id', lookId)
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { cleared }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not clear the look' }
  }
}

/** Every look in a delivery, emptied the same way. The looks stay. */
export async function clearDeliveryLooks(deliveryId: string): Promise<{ looks?: number; cleared?: number; error?: string }> {
  const admin = createAdminClient() as any
  try {
    const { data: looks } = await admin.from('pilot_look').select('look_id').eq('delivery_id', deliveryId)
    const ids = (looks ?? []).map((l: any) => l.look_id)
    if (!ids.length) return { looks: 0, cleared: 0 }
    const cleared = await wipeLookLearning(admin, ids)
    const { error } = await admin.from('pilot_look').update(EMPTY_LOOK).in('look_id', ids)
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { looks: ids.length, cleared }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not clear the looks' }
  }
}

// Stamp every buyable item in the delivery as stock-checked now.
// "Stock checked 10am, moves fast."
/**
 * Delete a delivery, and forget what it taught.
 *
 * The plain delete leaves the learning in place: its feedback rows survive the
 * cascade with null ids and keep shaping compositions. That is the right
 * default when the delivery is simply finished — her decisions were real. It
 * is the wrong one when the whole delivery was a mistake: wrong brief, wrong
 * weather, a test run. Then it should leave nothing behind.
 */
export async function deleteDeliveryAndMemory(deliveryId: string): Promise<{ cleared?: number; error?: string }> {
  const admin = createAdminClient() as any
  try {
    const { data: looks } = await admin.from('pilot_look').select('look_id').eq('delivery_id', deliveryId)
    const ids = (looks ?? []).map((l: any) => l.look_id)
    // By delivery AND by look: rows whose look was already deleted keep the
    // delivery id, and rows on live looks are found by look id.
    const { count } = await admin
      .from('pilot_look_feedback').select('feedback_id', { count: 'exact', head: true }).eq('delivery_id', deliveryId)
    await admin.from('pilot_look_feedback').delete().eq('delivery_id', deliveryId)
    if (ids.length) await admin.from('pilot_look_feedback').delete().in('look_id', ids)
    await admin.from('pilot_taste_event').delete().eq('delivery_id', deliveryId)
    await admin.from('pilot_activity').delete().eq('delivery_id', deliveryId)
    const { error } = await admin.from('pilot_delivery').delete().eq('delivery_id', deliveryId)
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { cleared: count ?? 0 }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not delete the delivery' }
  }
}

/**
 * Amend a delivery's brief after the fact — her words, the occasion, the
 * weather. Changing the occasion re-derives the effective weights, because
 * they are a snapshot of the tilt at creation and a brief that has changed
 * should not keep composing to the old one.
 */
export async function updateDelivery(
  deliveryId: string,
  patch: { request_text?: string; occasion?: OccasionId; climate?: ClimateId | null },
): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  try {
    const { data: d } = await admin.from('pilot_delivery').select('member_id, occasion').eq('delivery_id', deliveryId).single()
    if (!d) return { error: 'Delivery not found' }
    const row: Record<string, unknown> = {}
    if (patch.request_text !== undefined) row.request_text = patch.request_text
    if (patch.climate !== undefined) row.climate = patch.climate
    if (patch.occasion && patch.occasion !== d.occasion) {
      row.occasion = patch.occasion
      const { data: m } = await admin.from('pilot_member')
        .select('room_weights, work_dress_code').eq('member_id', d.member_id).single()
      if (m) row.effective_weights = effectiveWeights(m.room_weights, patch.occasion, m.work_dress_code)
    }
    if (!Object.keys(row).length) return {}
    const { error } = await admin.from('pilot_delivery').update(row).eq('delivery_id', deliveryId)
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not update the delivery' }
  }
}

/**
 * Put a finished delivery back into draft so it can be worked on again.
 *
 * A brief that landed well is the best starting point there is — the occasion,
 * the weighting and her verdicts are all still right, and the only thing
 * missing is more looks. Sending used to be one-way, so the alternative was
 * recreating the brief from memory and losing the thread that made it good.
 *
 * Nothing is undone: her responses, the shoots and every recorded decision
 * stay exactly as they are. Only the status moves.
 */
export async function reopenDelivery(deliveryId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { error } = await admin.from('pilot_delivery')
    .update({ status: 'draft' }).eq('delivery_id', deliveryId)
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}

// STOCK CHECK used to stamp the date without checking anything. It now reads
// every piece's sizes from the retailer and records what it found — a size
// sold out since the look was built is exactly what this button is for.
export async function markStockChecked(deliveryId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const [{ data: delivery }, { data: looks, error }] = await Promise.all([
    admin.from('pilot_delivery').select('member_id').eq('delivery_id', deliveryId).single(),
    admin.from('pilot_look').select('look_id, items').eq('delivery_id', deliveryId),
  ])
  if (error) return { error: error.message }
  if (!delivery) return { error: 'Delivery not found' }
  const all = ((looks ?? []) as any[]).flatMap((l) => l.items as LookItem[])
  const sizes = await checkSizesForMember(admin, delivery.member_id, all, 'all')
  const now = new Date().toISOString()
  const gone: string[] = []
  for (const l of (looks ?? []) as any[]) {
    const items = (l.items as LookItem[]).map((it) => {
      if (it.owned) return it
      const s = it.item_id ? sizes.get(it.item_id) : undefined
      if (s?.verdict === 'not_in_size') gone.push(it.product_name)
      return {
        ...it,
        stock_checked_at: now,
        in_stock: s ? s.verdict !== 'not_in_size' : it.in_stock !== false,
        ...(s?.label ? { size: s.label } : {}),
      }
    })
    await admin.from('pilot_look').update({ items }).eq('look_id', l.look_id)
  }
  revalidatePath(PATH)
  if (gone.length) return { error: `${gone.length} PIECE${gone.length === 1 ? '' : 'S'} NO LONGER IN HER SIZE — SWAP BEFORE SENDING: ${gone.join(' · ').toUpperCase()}` }
  return {}
}

// Send = validate the non-negotiables, then flip to sent.
export async function sendDelivery(deliveryId: string): Promise<{ errors?: string[]; error?: string }> {
  const admin = createAdminClient()
  const [{ data: delivery, error: dErr }, { data: looks, error: lErr }] = await Promise.all([
    admin.from('pilot_delivery' as any).select('member_id, trigger').eq('delivery_id', deliveryId).single(),
    admin.from('pilot_look' as any).select('*').eq('delivery_id', deliveryId).order('position'),
  ])
  if (dErr || !delivery) return { error: dErr?.message ?? 'DELIVERY NOT FOUND' }
  if (lErr) return { error: lErr.message }
  const { data: member } = await admin
    .from('pilot_member' as any)
    .select('brands')
    .eq('member_id', (delivery as any).member_id)
    .single()
  const brandNames = (((member as any)?.brands ?? []) as RankedBrand[]).map((b) => b.name)
  const errors = validateDelivery(
    ((looks ?? []) as any[]).map((l) => ({ room_mix: l.room_mix, items: l.items })),
    brandNames,
    { calibration: (delivery as any).trigger === 'calibration' },
  )
  if (errors.length > 0) return { errors }

  // Every piece must still be in her size at the moment it is sent — read from
  // the retailer now, not trusted from when the look was built.
  if ((delivery as any).trigger !== 'calibration') {
    const sendLooks = (looks ?? []) as any[]
    const sizes = await checkSizesForMember(admin, (delivery as any).member_id, sendLooks.flatMap((l) => l.items), 'all')
    const sizeErrors = sendLooks.flatMap((l, i) => (l.items as LookItem[])
      .filter((it) => it.item_id && sizes.get(it.item_id)?.verdict === 'not_in_size')
      .map((it) => `LOOK ${i + 1}: ${it.product_name.toUpperCase()} IS NO LONGER IN HER SIZE — SWAP IT`))
    if (sizeErrors.length) return { errors: sizeErrors }
  }

  // Her stock news rides INSIDE this delivery rather than arriving as a second
  // email from the same brand on the same day (see stock-alerts.ts, which
  // excludes private clients from the shopper digest for exactly this reason).
  const stockAlerts = await collectClientStockAlerts((delivery as any).member_id)

  const { error } = await admin
    .from('pilot_delivery' as any)
    .update({ status: 'sent', sent_at: new Date().toISOString(), stock_alerts: stockAlerts.payload })
    .eq('delivery_id', deliveryId)
  if (!error && stockAlerts.alertIds.length) await markDelivered(stockAlerts.alertIds)
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}

/** Her outstanding size/stock alerts, shaped for the delivery payload. */
async function collectClientStockAlerts(
  memberId: string,
): Promise<{ payload: unknown[]; alertIds: string[] }> {
  try {
    const admin = createAdminClient()
    const { data: member } = await admin
      .from('pilot_member' as any)
      .select('auth_user_id')
      .eq('member_id', memberId)
      .maybeSingle()
    const userId = (member as any)?.auth_user_id
    if (!userId) return { payload: [], alertIds: [] }

    const pending = await pendingAlertsForUser(userId)
    return {
      payload: pending.map((a) => ({
        item_id: a.item_id,
        kind: a.kind,
        size_label: a.size_label,
        line: ALERT_COPY[a.kind](a.size_label),
        product_name: a.item?.product_name ?? null,
        brand_name: a.item?.brand?.name ?? null,
        image_url: a.item?.image_url ?? null,
      })),
      alertIds: pending.map((a) => a.alert_id),
    }
  } catch (err) {
    // Never block a delivery on stock news.
    console.error('[collectClientStockAlerts]', err)
    return { payload: [], alertIds: [] }
  }
}

// ── Responses & activity → taste events ─────────────────────────────────────
// Every yes / no / save / click-out / purchase writes a pilot_taste_event
// carrying the look's room mix + 34-dim vector, then re-derives the member's
// accumulated taste vector from her full event history. Deterministic replay,
// same philosophy as the room weights.

async function writeTasteEvent(input: {
  member_id: string
  event_type: PilotTasteEventType
  delivery_id?: string | null
  look_id?: string | null
}): Promise<{ error?: string }> {
  const admin = createAdminClient()
  // Resolve room mix + vector: from the look when we have one, else from the
  // delivery's effective weights (a delivery-level click still carries signal)
  let roomMix = null as any
  let vector: number[] | null = null
  let deliveryId = input.delivery_id ?? null
  if (input.look_id) {
    const { data: look } = await admin
      .from('pilot_look' as any)
      .select('room_mix, taste_vector, delivery_id, items')
      .eq('look_id', input.look_id)
      .single()
    if (look) {
      roomMix = (look as any).room_mix
      vector = (look as any).taste_vector ?? lookTasteVector((look as any).room_mix)
      deliveryId = (look as any).delivery_id
      // Brand-affinity learning: the look's item brands carry the signal
      // (yes/save/click_out/purchase step up, repeated no decays). Best-effort
      // — the taste event itself must never fail on this.
      try {
        const brandNames = (((look as any).items ?? []) as Array<{ brand?: string }>)
          .map((it) => it.brand)
          .filter(Boolean) as string[]
        if (brandNames.length) await applyBrandSignals(admin, input.member_id, brandNames, input.event_type)
      } catch { /* brand affinity is additive; ignore */ }
    }
  }
  if (!roomMix && deliveryId) {
    const { data: delivery } = await admin
      .from('pilot_delivery' as any)
      .select('effective_weights')
      .eq('delivery_id', deliveryId)
      .single()
    if (delivery) {
      roomMix = (delivery as any).effective_weights
      vector = lookTasteVector((delivery as any).effective_weights)
    }
  }
  if (!roomMix) return { error: 'NO LOOK OR DELIVERY TO ATTACH THE SIGNAL TO' }

  const { data: member } = await admin
    .from('pilot_member' as any)
    .select('is_synthetic')
    .eq('member_id', input.member_id)
    .single()
  const { error } = await admin.from('pilot_taste_event' as any).insert({
    member_id: input.member_id,
    delivery_id: deliveryId,
    look_id: input.look_id ?? null,
    event_type: input.event_type,
    signal_weight: PILOT_SIGNAL_WEIGHTS[input.event_type],
    room_mix: roomMix,
    taste_vector: vector,
    is_synthetic: (member as any)?.is_synthetic ?? false,
  })
  if (error) return { error: error.message }
  return recomputeMemberVector(input.member_id)
}

// Rebuild the member's 34-dim vector from her full event history.
// Real members read only non-synthetic events — the contamination guard.
async function recomputeMemberVector(memberId: string): Promise<{ error?: string }> {
  const admin = createAdminClient()
  const { data: member } = await admin
    .from('pilot_member' as any)
    .select('is_synthetic')
    .eq('member_id', memberId)
    .single()
  let q = admin
    .from('pilot_taste_event' as any)
    .select('signal_weight, taste_vector')
    .eq('member_id', memberId)
    .order('created_at')
  if (!(member as any)?.is_synthetic) q = q.eq('is_synthetic', false)
  const { data: evts, error } = await q
  if (error) return { error: error.message }
  let acc = zeroVector()
  for (const e of (evts ?? []) as any[]) {
    if (Array.isArray(e.taste_vector)) acc = accumulate(acc, e.taste_vector, e.signal_weight)
  }
  const { error: uErr } = await admin
    .from('pilot_member' as any)
    .update({ taste_vector: acc, updated_at: new Date().toISOString() })
    .eq('member_id', memberId)
  return uErr ? { error: uErr.message } : {}
}

export async function recordResponse(
  lookId: string,
  response: 'yes' | 'no',
  reason: ResponseReason | null,
): Promise<{ error?: string }> {
  const admin = createAdminClient()
  const { data: look, error: lookErr } = await admin
    .from('pilot_look' as any)
    .update({ response, response_reason: reason, responded_at: new Date().toISOString() })
    .eq('look_id', lookId)
    .select('delivery_id, items')
    .single()
  if (lookErr) return { error: lookErr.message }
  const deliveryId = (look as any).delivery_id
  await admin.from('pilot_delivery' as any).update({ status: 'responded' }).eq('delivery_id', deliveryId)
  const { data: delivery } = await admin
    .from('pilot_delivery' as any)
    .select('member_id')
    .eq('delivery_id', deliveryId)
    .single()
  if (delivery) {
    const r = await writeTasteEvent({
      member_id: (delivery as any).member_id,
      event_type: response,
      delivery_id: deliveryId,
      look_id: lookId,
    })
    if (r.error) return r
    // Her response is the thing that fades the persona.
    await recomputeMemberPersonaWeight((delivery as any).member_id)
    // …and, from the client herself, the strongest thing the style can learn.
    await teachHouseStyle(admin, (delivery as any).member_id, ((look as any).items ?? []) as LookItem[], response === 'yes' ? 'approve' : 'skip', 'review')
  }
  revalidatePath(PATH)
  return {}
}

// A member's verbatim reaction to a shot look, logged from the Lookbook after
// Chloe reads it back to her. The quote is kept as an append-only pilot_activity
// note (re-phrasings never overwrite each other), and the yes/no rides the full
// recordResponse pipeline: taste event → 34-dim vector, brand affinity signals,
// persona weight fade. This is the loop that sharpens her vector delivery after
// delivery.
export async function recordMemberLookFeedback(
  lookId: string,
  response: 'yes' | 'no',
  reason: ResponseReason | null,
  verbatim: string,
): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { data: look, error: lerr } = await admin.from('pilot_look').select('delivery_id, items').eq('look_id', lookId).single()
  if (lerr || !look) return { error: lerr?.message ?? 'Look not found' }
  const { data: delivery } = await admin.from('pilot_delivery').select('member_id').eq('delivery_id', look.delivery_id).single()
  if (!delivery) return { error: 'Delivery not found' }

  // A verdict SUPERSEDES any earlier verdict on the same look. Without this,
  // re-logging (or correcting a yes to a no) stacked a second taste event and
  // the vector counted her twice, with the retracted opinion still in it.
  await admin.from('pilot_taste_event').delete().eq('member_id', delivery.member_id).eq('look_id', lookId)
  // Per-item rows likewise: the wearer's verdict is the authority on the look,
  // so it replaces any earlier per-item verdict (Chloe's review included).
  // Brand-pair rows carry no item_in and are left alone.
  await admin.from('pilot_look_feedback').delete().eq('look_id', lookId).not('item_in', 'is', null)

  const text = verbatim.trim()
  if (text) {
    const r = await logActivity({
      member_id: delivery.member_id,
      type: 'note',
      detail: text,
      delivery_id: look.delivery_id,
      look_id: lookId,
    })
    if (r.error) return r
  }

  // The composer's avoid/favour list reads pilot_look_feedback — so her verdict
  // also lands there per item, exactly like Chloe's approve/skip review does.
  // A NO means these specific pieces stop being re-composed for her.
  const items: LookItem[] = look.items ?? []
  const action = response === 'yes' ? 'accept' : 'remove'
  const fb: any[] = []
  for (const it of items) {
    if (it.item_id) fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action, slot: it.slot ?? null, item_in: it.item_id, brand_in: it.brand_id ?? null })
  }
  if (fb.length) {
    const { error: fbErr } = await insertFeedback(admin, fb)
    if (fbErr) return { error: fbErr }
  }

  return recordResponse(lookId, response, response === 'no' ? (reason ?? 'not_my_style') : reason)
}

export async function logActivity(input: {
  member_id: string
  type: PilotActivity['type']
  detail: string
  delivery_id?: string
  look_id?: string
}): Promise<{ error?: string }> {
  const admin = createAdminClient()
  const { data: member } = await admin
    .from('pilot_member' as any)
    .select('is_synthetic')
    .eq('member_id', input.member_id)
    .single()
  const { error } = await admin.from('pilot_activity' as any).insert({
    member_id: input.member_id,
    type: input.type,
    detail: input.detail || null,
    delivery_id: input.delivery_id ?? null,
    look_id: input.look_id ?? null,
    is_synthetic: (member as any)?.is_synthetic ?? false,
  })
  if (error) {
    revalidatePath(PATH)
    return { error: error.message }
  }
  // Taste-bearing signals also become taste events; returns/stock/notes don't
  if (input.type === 'click_out' || input.type === 'save' || input.type === 'purchase') {
    const r = await writeTasteEvent({
      member_id: input.member_id,
      event_type: input.type,
      delivery_id: input.delivery_id ?? null,
      look_id: input.look_id ?? null,
    })
    if (r.error) {
      revalidatePath(PATH)
      return r
    }
  }
  revalidatePath(PATH)
  return {}
}

// ── Weekly recompute ────────────────────────────────────────────────────────
// Replays every responded look from the intake snapshot forward. For a REAL
// member only non-synthetic deliveries are read (defence in depth — a real
// member should never have synthetic deliveries anyway). A synthetic member's
// recompute only ever touches that synthetic member: plumbing test, contained.

export async function recomputeWeights(memberId: string): Promise<{ weights?: RoomWeights; error?: string }> {
  const admin = createAdminClient()
  const [{ data: member, error: mErr }, { data: snaps }] = await Promise.all([
    admin.from('pilot_member' as any).select('is_synthetic').eq('member_id', memberId).single(),
    admin
      .from('pilot_weight_snapshot' as any)
      .select('room_weights, source, created_at')
      .eq('member_id', memberId)
      .eq('source', 'intake')
      .order('created_at')
      .limit(1),
  ])
  if (mErr || !member) return { error: mErr?.message ?? 'MEMBER NOT FOUND' }
  const intake = ((snaps ?? []) as any[])[0]?.room_weights
  if (!intake) return { error: 'NO INTAKE SNAPSHOT — ONBOARD FIRST' }

  // Replay the full taste-event history: every yes/no/save/click/purchase,
  // signal-weighted. Real members read only non-synthetic events.
  let eq = admin
    .from('pilot_taste_event' as any)
    .select('event_type, signal_weight, room_mix')
    .eq('member_id', memberId)
    .order('created_at')
  if (!(member as any).is_synthetic) eq = eq.eq('is_synthetic', false)
  const { data: evts, error: eErr } = await eq
  if (eErr) return { error: eErr.message }
  const tasteEvents = (evts ?? []) as any[]

  const weights = replayEvents(intake, tasteEvents)
  const { error: uErr } = await admin
    .from('pilot_member' as any)
    .update({ room_weights: weights, updated_at: new Date().toISOString() })
    .eq('member_id', memberId)
  if (uErr) return { error: uErr.message }
  await admin.from('pilot_weight_snapshot' as any).insert({
    member_id: memberId,
    room_weights: weights,
    source: 'weekly',
    note: `Recomputed from ${tasteEvents.length} taste event${tasteEvents.length === 1 ? '' : 's'}`,
  })
  revalidatePath(PATH)
  return { weights }
}


// ── COMPOSED LOOKS — the system builds, Chloe reviews, the review teaches ───
//
// composeDeliveryLooks assembles looks from the item library (ready + live)
// with the member's taste folded into generation: her brand affinities, the
// brand families around her loved brands, and every swap Chloe has made for
// her before. Swaps and approvals land in pilot_look_feedback:
//   swap item row   — item_out was wrong for HER (penalised next compose)
//   pair rows       — which brand pairings survive review (accept +1, swap −1)
// Brand affinities also nudge through the shared applyBrandSignals learning.

/**
 * Insert feedback rows, tolerating a database that has not had 0052 yet.
 *
 * Every capture writes its scope explicitly rather than relying on the column
 * default — but a column that does not exist yet rejects the whole insert, and
 * losing a swap is far worse than losing its scope. The rows go in either way;
 * the scope is dropped only if the schema cannot hold it.
 */
async function insertFeedback(admin: any, rows: any[]): Promise<{ error?: string }> {
  if (!rows.length) return {}
  const { error } = await admin.from('pilot_look_feedback').insert(rows)
  if (!error) return {}
  if (!/schema cache|does not exist/i.test(error.message)) return { error: error.message }
  const stripped = rows.map(({ scope, scope_source, ...rest }: any) => rest)
  const retry = await admin.from('pilot_look_feedback').insert(stripped)
  return retry.error ? { error: retry.error.message } : {}
}

const pairKeyOrdered = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a])

/**
 * Turn her raw accept/swap/remove rows into a trait model.
 *
 * One decision per (item, action): an item swapped away is a rejection of that
 * piece as it was shown, an accepted item is a keep. The item table supplies
 * what the piece is — brand, type, colour, material, price and the scored
 * shape dimensions — which is why the library backfill matters: an unscored
 * piece teaches nothing about shape.
 */
async function buildMemberTraitModel(admin: any, rows: any[]): Promise<TraitModel | undefined> {
  // A rejection is item_out. Skips written before that was made consistent
  // put the piece in item_in instead, and there is no other way to read them:
  // on a 'remove' row an item_in IS the rejected piece.
  const rejectedId = (r: any): string | null =>
    r.action === 'swap' ? (r.item_out ?? null)
      : r.action === 'remove' ? (r.item_out ?? r.item_in ?? null)
        : null
  const ids = new Set<string>()
  for (const r of rows) {
    const out = rejectedId(r)
    if (out) ids.add(out)
    if (r.action === 'accept' && r.item_in) ids.add(r.item_in)
  }
  if (!ids.size) return undefined

  const all = Array.from(ids)
  const items = new Map<string, TraitItem>()
  for (let i = 0; i < all.length; i += 100) {
    const { data } = await admin
      .from('item')
      .select('item_id, brand_id, item_type, colour_family, material_category, price_gbp, fit, structure, length, leg_opening, rise, pattern')
      .in('item_id', all.slice(i, i + 100))
    for (const r of data ?? []) items.set(r.item_id, r as TraitItem)
  }

  const decisions: TraitDecision[] = []
  for (const r of rows) {
    const out = rejectedId(r)
    const id = out ?? (r.action === 'accept' ? r.item_in : null)
    if (!id) continue
    const item = items.get(id)
    // A skip writes one row per piece with no slot: the whole look went, not
    // that piece. Weaker evidence, so it cannot block on its own.
    const targeted = !(r.action === 'remove' && !r.slot && !r.item_out)
    if (item) decisions.push({ item, kept: !out, targeted })
  }
  return decisions.length ? buildTraitModel(decisions) : undefined
}

/**
 * Lessons promoted from repeated rejections: to her house style (her style
 * profile) or to her stylist (seen across clients on different styles). One
 * client's quirks never get here — promotion needs the evidence first.
 */
async function loadLearnedRulesFor(admin: any, member: { stylist_id?: string | null; style_profile_id?: string | null }): Promise<LearnedRuleMatch[]> {
  const reads: Promise<any>[] = []
  if (member.style_profile_id) {
    reads.push(admin.from('learned_rule').select('pattern_key').eq('active', true).eq('scope', 'style').eq('profile_id', member.style_profile_id))
  }
  if (member.stylist_id) {
    reads.push(admin.from('learned_rule').select('pattern_key').eq('active', true).eq('scope', 'stylist').eq('stylist_id', member.stylist_id))
  }
  const out: LearnedRuleMatch[] = []
  for (const r of await Promise.all(reads)) {
    for (const row of r.data ?? []) {
      const rule = parsePatternKey(row.pattern_key)
      if (rule && rule.action !== 'liked') out.push(rule)
    }
  }
  return out
}

/**
 * Teach the client's house style from a decision made on her look, so the style
 * builds its own Style Brain (SCandi-Mum learns from SCandi-Mum clients). Never
 * throws into the decision it rides on; synthetic members never train it.
 */
async function teachHouseStyle(
  admin: any,
  memberId: string,
  items: LookItem[],
  decision: 'approve' | 'skip',
  source: 'review' | 'swap',
): Promise<void> {
  try {
    const { data: a } = await admin.from('user_persona').select('persona_id').eq('user_id', memberId).maybeSingle()
    if (!a?.persona_id) return
    const { data: m } = await admin.from('pilot_member').select('is_synthetic').eq('member_id', memberId).maybeSingle()
    if (m?.is_synthetic) return
    const ids = items.map((i) => i?.item_id).filter(Boolean) as string[]
    if (!ids.length) return
    const { data: rows } = await admin.from('item')
      .select('item_id, item_type, colour_family, pattern, material_formality, brand(name, price_tier)').in('item_id', ids)
    const features = ((rows ?? []) as any[]).map((r) => ({
      item_type: r.item_type,
      colour_family: r.colour_family ?? null,
      pattern: r.pattern ?? null,
      material_formality: r.material_formality ?? null,
      brand_name: r.brand?.name ?? null,
      price_tier: r.brand?.price_tier ?? null,
    }))
    if (!features.length) return
    await recordStyleDecision({ items: features as any, decision, source, itemIds: ids, stylistId: a.persona_id })
  } catch (err) {
    console.error('[teachHouseStyle]', err)
  }
}

/**
 * Which rules her looks are held to (lib/style-rules). Her assigned house style
 * (a persona in user_persona) wins; with none, a Chloe client gets Chloe style.
 */
async function loadMemberRules(admin: any, member: { member_id: string; stylist_id?: string | null }): Promise<MemberRules> {
  const { data: assignment } = await admin
    .from('user_persona').select('persona_id').eq('user_id', member.member_id).maybeSingle()
  if (assignment?.persona_id) {
    const { data: style } = await admin
      .from('stylist').select('name, constitution').eq('stylist_id', assignment.persona_id).maybeSingle()
    if (style?.constitution?.articles?.length) {
      return rulesForMember({ name: style.name ?? null, constitution: style.constitution }, false)
    }
  }
  let chloeStyle = false
  if (member.stylist_id) {
    const { data: stylist } = await admin.from('stylist').select('name, type').eq('stylist_id', member.stylist_id).maybeSingle()
    chloeStyle = stylist?.type === 'real' && /^chlo/i.test(stylist?.name ?? '')
  }
  return rulesForMember(null, chloeStyle)
}

export async function loadMemberTaste(admin: any, member: { member_id: string; brands: RankedBrand[]; brands_input_only: string[] } & Partial<StylePrefs>): Promise<MemberTaste> {
  const t: MemberTaste = {
    affinity: new Map(),
    families: new Map(),
    excludedPairs: new Set(),
    inputOnlyBrands: new Set((member.brands_input_only ?? []).map((b) => b.toLowerCase())),
    itemSwapOut: new Map(),
    brandSwapOut: new Map(),
    pairNet: new Map(),
    // Authored preferences ride along with the learned signals; pre-0045 rows
    // simply have none.
    prefs: readStylePrefs(member),
    priceBands: readPriceBands(member as any),
    tasteVector: Array.isArray((member as any).taste_vector) && (member as any).taste_vector.length
      ? ((member as any).taste_vector as number[]) : undefined,
  }

  // Her rules by layer, and what Chloe's rejections have taught everyone.
  try {
    const { data: styleAssignment } = await admin
      .from('user_persona').select('persona_id').eq('user_id', member.member_id).maybeSingle()
    const [rules, styleModel, houseStyleModel, learnedRules, ejections, learnedPairs] = await Promise.all([
      loadMemberRules(admin, member as any),
      loadStyleModel((member as any).stylist_id ?? null),
      styleAssignment?.persona_id ? loadStyleModel(styleAssignment.persona_id) : Promise.resolve(undefined),
      loadLearnedRulesFor(admin, member as any),
      loadEjectionConstraints(),
      loadLearnedMaterialPairs(),
    ])
    t.rules = rules
    t.styleModel = styleModel
    t.houseStyleModel = houseStyleModel
    t.learnedRules = learnedRules
    t.ejections = ejections
    t.learnedPairs = learnedPairs
  } catch (err) {
    // Her own gates still apply if this fails; the error is logged, not hidden.
    console.error('[loadMemberTaste] rules/learning', err)
  }

  const [affRes, famRes, exclRes, fbRes] = await Promise.all([
    admin.from('user_brand_affinity').select('brand_id, affinity, hidden').eq('user_id', member.member_id),
    admin.from('brand_family_membership').select('family_id, brand_id'),
    admin.from('brand_exclusion').select('brand_a, brand_b'),
    admin.from('pilot_look_feedback').select('*').eq('member_id', member.member_id),
  ])

  for (const r of affRes.data ?? []) {
    if (!r.hidden) t.affinity.set(r.brand_id, Number(r.affinity))
  }
  for (const r of famRes.data ?? []) {
    const set = t.families.get(r.brand_id) ?? new Set<string>()
    set.add(r.family_id)
    t.families.set(r.brand_id, set)
  }
  for (const r of exclRes.data ?? []) {
    const [a, b] = pairKeyOrdered(r.brand_a, r.brand_b)
    t.excludedPairs.add(`${a}|${b}`)
  }

  // Ranked onboarding picks are a floor even before any learned affinity —
  // rank 1 ≈ 0.9, falling away, never below 0.45.
  const ranked = (member.brands ?? []).filter((b) => b?.name)
  if (ranked.length) {
    // Accent/case-insensitive match — "Sessun" must find "Sessùn".
    const fold = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    const { data: brandRows } = await admin.from('brand').select('brand_id, name')
    const byName = new Map<string, string>((brandRows ?? []).map((r: any) => [fold(r.name), r.brand_id]))
    for (const b of ranked) {
      const id = byName.get(fold(b.name))
      if (!id) continue
      const fromRank = Math.max(0.45, 0.9 - 0.08 * ((b.rank ?? 1) - 1))
      t.affinity.set(id, Math.max(t.affinity.get(id) ?? 0, fromRank))
    }
  }

  // Trait learning: every decision, joined to what the piece actually IS, so
  // the composer can generalise from "not that bag" to "not black structured
  // bags by this brand". Item-level penalties alone never converged.
  t.traits = await buildMemberTraitModel(admin, fbRes.data ?? [])

  for (const r of fbRes.data ?? []) {
    const isPairRow = !r.item_out && !r.item_in
    if (isPairRow && r.brand_out && r.brand_in) {
      const [a, b] = pairKeyOrdered(r.brand_out, r.brand_in)
      const k = `${a}|${b}`
      t.pairNet.set(k, (t.pairNet.get(k) ?? 0) + (r.action === 'accept' ? 1 : -1))
    } else if ((r.action === 'swap' || r.action === 'remove') && r.item_out) {
      t.itemSwapOut.set(r.item_out, (t.itemSwapOut.get(r.item_out) ?? 0) + 1)
      if (r.brand_out) t.brandSwapOut.set(r.brand_out, (t.brandSwapOut.get(r.brand_out) ?? 0) + 1)
    }
  }
  return t
}

// The candidate pool for ONE member: the retail library (ready + live, retail
// only — getAllItems filters owned out) PLUS her approved owned pieces from the
// wardrobe import. Owned items are eligible for any slot; they never appear in
// any other member's pool.
//
// SIZE IS A HARD GATE HERE, AT COMPOSITION TIME — stricter than the public
// feed. A private lookbook is a personal recommendation, so every retail item
// in it must be available in HER size when it is built; if a slot can't be
// filled in her size the composer picks something else rather than shipping her
// a look she can't buy. Pre-loved pieces appear only if she asked for them.
//
// Her own wardrobe is exempt: she already owns those, and they already fit.
export async function loadComposableLibrary(member?: { member_id: string; auth_user_id?: string | null } | null): Promise<ItemWithBrand[]> {
  const [ready, live, owned] = await Promise.all([
    getAllItems('ready'),
    getAllItems('live'),
    member ? listOwnedItems(ownerRefsForMember(member)) : Promise.resolve([] as ItemWithBrand[]),
  ])
  const retail = [...ready, ...live]
  if (!member) return [...retail, ...owned]

  const ctx = await loadMemberSizeProfile(member.member_id)
  const inHerSize = await filterItemsForShopper(retail as any[], ctx, { strict: true })
  return [...(inHerSize as ItemWithBrand[]), ...owned]
}


// ── PERSONA LENS ────────────────────────────────────────────────────────────
// A member can be styled THROUGH a persona: its moodboard envelope shapes her
// looks while she is new, then fades as she responds. Assignment lives in
// user_persona with subject_kind='pilot_member' (migration 0043) — the same
// soft-assignment machinery the client area uses.

/** Assign (or move) a member to a stylist persona at full prior strength. */
export async function assignMemberPersona(memberId: string, personaId: string): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient() as any
    if (!personaId) {
      await admin.from('user_persona').delete().eq('user_id', memberId)
      await linkMemberToStyleProfile(admin, memberId, null)
      revalidatePath(PATH)
      return {}
    }
    // Supabase returns errors, it doesn't throw — ignoring the result meant a
    // failed write still reported "PERSONA ASSIGNED". Check every step.
    const { error: upsertErr } = await admin.from('user_persona').upsert(
      {
        user_id: memberId,
        persona_id: personaId,
        subject_kind: 'pilot_member',
        weight: PERSONA_START_WEIGHT,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    if (upsertErr) {
      const hint = /subject_kind/.test(upsertErr.message) ? ' — run migration 0043 in the Supabase SQL editor' : ''
      return { error: `${upsertErr.message}${hint}` }
    }
    const { error: logErr } = await admin.from('user_persona_weight_log').insert({
      user_id: memberId, persona_id: personaId, subject_kind: 'pilot_member',
      weight: PERSONA_START_WEIGHT, event_count: 0,
    })
    if (logErr) return { error: logErr.message }
    // Her lessons can only reach the style through its profile.
    await linkMemberToStyleProfile(admin, memberId, personaId)
    revalidatePath(PATH)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Assign failed' }
  }
}

/**
 * The member's persona lens: the envelope computed from that persona's
 * CONFIRMED moodboard images, plus the current weight. A persona with no
 * confirmed images has no envelope and therefore no influence — the moodboard
 * has to have been reviewed before it can style anyone.
 */
export async function loadPersonaLens(admin: any, memberId: string): Promise<PersonaLens | undefined> {
  const [{ data: assignment }, { data: member }] = await Promise.all([
    admin.from('user_persona').select('persona_id, weight').eq('user_id', memberId).maybeSingle(),
    admin.from('pilot_member').select('auth_user_id').eq('member_id', memberId).maybeSingle(),
  ])
  let name: string | null = null
  let envelope: { mean: number[]; spread: number[] } | null = null
  if (assignment?.persona_id) {
    const { data: persona } = await admin
      .from('stylist').select('name, envelope').eq('stylist_id', assignment.persona_id).maybeSingle()
    name = persona?.name ?? null
    const env = persona?.envelope
    if (env?.mean?.length) envelope = { mean: env.mean, spread: env.spread ?? [] }
  }

  // Her own reference pictures — added on her profile by Chloe (user_id = her
  // member id) or uploaded by her at /me (user_id = her login). What SHE likes:
  // it does not fade as she responds, and it never shapes the house style.
  const owners = [memberId, member?.auth_user_id].filter(Boolean)
  // Two kinds of her own evidence, read into one envelope: the pictures she
  // keeps (what she likes) and her archival looks (what she actually wears).
  const [{ data: refs }, { data: archival }] = await Promise.all([
    admin.from('inspiration_image').select('vector').in('user_id', owners).in('status', ['scored', 'confirmed']),
    admin.from('archival_look').select('taste_vector').eq('member_id', memberId).eq('hidden', false).not('taste_vector', 'is', null),
  ])
  const vectors = [...((refs ?? []) as any[]).map((r) => r.vector), ...((archival ?? []) as any[]).map((r) => r.taste_vector)]
    .filter((v) => Array.isArray(v) && v.length)
  const refEnv = vectors.length ? computeEnvelope(vectors, 1) : null
  const reference = refEnv ? { envelope: { mean: refEnv.mean, spread: refEnv.spread }, weight: REFERENCE_LENS_WEIGHT } : null

  if (!envelope && !reference) return undefined
  return {
    name,
    envelope,
    weight: typeof assignment?.weight === 'number' ? assignment.weight : PERSONA_START_WEIGHT,
    reference,
    // The newest of her looks, kept whole beside their average (nearestLookFit).
    referenceLooks: vectors.slice(0, 60),
  }
}

/**
 * Recompute the member's persona weight from how much she has responded:
 * weight = max(0.3, 0.9 − 0.02 × responses). Every yes/no she gives moves the
 * styling a little further from the persona and a little closer to her.
 */
export async function recomputeMemberPersonaWeight(memberId: string): Promise<{ weight?: number; error?: string }> {
  try {
    const admin = createAdminClient() as any
    const { data: assignment } = await admin
      .from('user_persona').select('persona_id, weight').eq('user_id', memberId).maybeSingle()
    if (!assignment?.persona_id) return {}
    const { count } = await admin
      .from('pilot_taste_event').select('event_id', { count: 'exact', head: true }).eq('member_id', memberId)
    const weight = personaWeight(count ?? 0)
    if (weight !== assignment.weight) {
      await admin.from('user_persona')
        .update({ weight, updated_at: new Date().toISOString() }).eq('user_id', memberId)
      await admin.from('user_persona_weight_log').insert({
        user_id: memberId, persona_id: assignment.persona_id, subject_kind: 'pilot_member',
        weight, event_count: count ?? 0,
      })
    }
    return { weight }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Recompute failed' }
  }
}

export interface ComposeDeliveryOptions {
  /** blend (default) · style_owned ("style what she owns") · retail_only */
  ownedMode?: ComposeOptions['ownedMode']
  /** share of looks that must contain ≥1 owned piece in style_owned mode (default 0.6) */
  ownedTargetShare?: number
  count?: number
}

/**
 * Every feedback row for a member, oldest first. PostgREST returns at most
 * 1,000 rows however high .limit() is set, and Alison already has more than
 * that — so the composer was learning from her oldest 1,000 answers only.
 */
async function allFeedbackRows(admin: any, memberId: string, columns: string): Promise<{ data: any[] }> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('pilot_look_feedback').select(columns)
      .eq('member_id', memberId).order('created_at', { ascending: true }).range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return { data: out }
}

type PlannedLooks = ReturnType<typeof composeMemberLooks>

/**
 * Compose looks for a delivery-shaped brief WITHOUT writing anything.
 *
 * Split out of composeDeliveryLooks so the same composer — same history, same
 * rejections, same anchors — can answer "what would MYRA make if she asked
 * for this?" as a test, with nothing saved, sent or learned. Not exported: a
 * 'use server' export is a public endpoint, and this takes any member_id.
 */
/**
 * Her look history, read once for any composer: everything already composed for
 * her plus her latest answer on each piece (lib/piece-verdicts), and the pieces
 * that have already anchored an approved look. Shared by fresh deliveries and
 * the Dressing Room, so both explore rather than replaying the same looks.
 */
/** Remember the looks MYRA made and Chloe did not take. Best-effort: a missing table never blocks a keep. */
export async function recordPassedLooks(admin: any, memberId: string, occasion: string | null, looks: { items: LookItem[] }[]): Promise<number> {
  const rows = looks
    .map((l) => {
      const ids = (l.items ?? []).map((it: any) => it?.item_id).filter(Boolean) as string[]
      if (ids.length < 2) return null
      return { member_id: memberId, signature: lookSignature(ids), anchor_item: ids[0], items: l.items, occasion }
    })
    .filter(Boolean)
  if (!rows.length) return 0
  try {
    const { error } = await admin.from('pilot_passed_look').upsert(rows, { onConflict: 'member_id,signature', ignoreDuplicates: true })
    if (error) { console.error('[recordPassedLooks]', error.message); return 0 }
    return rows.length
  } catch (err) {
    console.error('[recordPassedLooks]', err)
    return 0
  }
}

export async function loadComposeHistory(admin: any, memberId: string): Promise<ComposeHistory> {
  // Her look history: everything already composed for her (any delivery) plus
  // her explicit rejections — the composer ranks those down so each delivery
  // explores the library instead of regenerating the same argmax looks.
  const [{ data: priorLooks }, { data: fb }] = await Promise.all([
    // The member lives on the delivery, not on the look: filtering on a
    // 'memberId' column errored silently, so her history was always empty and
    // the composer kept regenerating the same best-scoring looks.
    admin.from('pilot_look').select('items, delivery:delivery_id!inner(member_id)').eq('delivery.member_id', memberId),
    allFeedbackRows(admin, memberId, 'item_in, item_out, action, created_at'),
  ])
  if (!priorLooks) console.error('[loadComposeHistory] no prior looks read for', memberId)
  const seenCounts = new Map<string, number>()
  for (const l of priorLooks ?? []) {
    for (const it of (l.items ?? []) as any[]) {
      if (it.item_id) seenCounts.set(it.item_id, (seenCounts.get(it.item_id) ?? 0) + 1)
    }
  }
  // Kept and rejected are counted SEPARATELY, and the MOST RECENT answer on a
  // piece decides which side it is on (lib/piece-verdicts). This used to drop
  // all credit for a kept piece the moment any rejection existed — including a
  // swap-out undone a minute later.
  const verdicts = pieceVerdicts(fb ?? [])
  const rejected = verdicts.rejected
  const rejectedCounts = new Map<string, number>()
  verdicts.rejectedCounts.forEach((n, id) => { if (rejected.has(id)) rejectedCounts.set(id, n) })
  const keptCounts = new Map<string, number>()
  verdicts.keptCounts.forEach((n, id) => { if (!rejected.has(id)) keptCounts.set(id, n) })

  // Pieces that have already anchored an APPROVED look. The anchor is the
  // dress if there is one, otherwise the top — the composer's own rule — since
  // hero_item_id is only written on variant rows.
  const { data: approvedLooks } = await admin
    .from('pilot_look').select('items, hero_item_id, delivery:delivery_id!inner(member_id)')
    .eq('delivery.member_id', memberId).not('approved_at', 'is', null)
  const anchoredIds = new Set<string>()
  for (const l of approvedLooks ?? []) {
    if (l.hero_item_id) { anchoredIds.add(l.hero_item_id); continue }
    const its = (l.items ?? []) as any[]
    const anchor = its.find((it) => it.slot === 'dress') ?? its.find((it) => it.slot === 'top')
    if (anchor?.item_id) anchoredIds.add(anchor.item_id)
  }
  // Looks composed for her that were passed over — the combination and the
  // piece each was built on. Missing table (pre-0063) simply means none.
  const passedSignatures = new Set<string>()
  const passedAnchors = new Set<string>()
  // Every combination already composed for her — sent or not — is spent. The
  // same five pieces are not a new answer to a different brief.
  for (const l of priorLooks ?? []) {
    const ids = ((l.items ?? []) as any[]).map((it) => it?.item_id).filter(Boolean) as string[]
    if (ids.length >= 2) passedSignatures.add(lookSignature(ids))
  }
  try {
    const { data: passed } = await admin.from('pilot_passed_look').select('signature, anchor_item').eq('member_id', memberId).limit(2000)
    for (const p of (passed ?? []) as any[]) {
      if (p.signature) passedSignatures.add(p.signature)
      if (p.anchor_item) passedAnchors.add(p.anchor_item)
    }
  } catch { /* migration 0065 has not been run */ }

  return { seenCounts, keptCounts, rejected, rejectedCounts, anchoredIds, passedSignatures, passedAnchors }
}

async function planDeliveryLooks(
  admin: any,
  delivery: { member_id: string; occasion: string | null; climate?: ClimateId | null; effective_weights?: any },
  options: ComposeDeliveryOptions = {},
): Promise<{ looks?: PlannedLooks; mix?: RoomWeights; error?: string }> {
  const { data: member, error: merr } = await admin.from('pilot_member').select('*').eq('member_id', delivery.member_id).single()
  if (merr || !member) return { error: merr?.message ?? 'Member not found' }

  const taste = await loadMemberTaste(admin, member)
  const library = await loadComposableLibrary(member)
  // A pale piece added today is read before the nightly sweep can reach it.
  await correctPaleColour(admin, library as any, 20)
  const mix = normalise(delivery.effective_weights ?? {})
  const occ: OccasionContext = { id: delivery.occasion ?? null, vector: lookTasteVector(mix), climate: delivery.climate ?? null }
  const lens = await loadPersonaLens(admin, delivery.member_id)

  const history = await loadComposeHistory(admin, delivery.member_id)

  const lookCount = Math.max(1, Math.min(6, options.count ?? 3))
  const looks = composeMemberLooks(taste, library, lookCount, occ, lens, history, {
    ownedMode: options.ownedMode ?? 'blend',
    ownedTargetShare: options.ownedTargetShare ?? DEFAULT_OWNED_TARGET_SHARE,
  })
  if (!looks.length) {
    return {
      error: options.ownedMode === 'style_owned'
        ? 'Could not compose around her wardrobe — nothing she owns pairs coherently with what is in stock. Approve more pieces or compose in blend mode.'
        : 'Could not compose — not enough compatible in-stock items in the library',
    }
  }
  return { looks, mix }
}

export async function composeDeliveryLooks(deliveryId: string, options: ComposeDeliveryOptions = {}): Promise<{ created?: number; ownedLooks?: number; droppedByCheck?: number; error?: string }> {
  const admin = createAdminClient() as any
  const { data: delivery, error: derr } = await admin.from('pilot_delivery').select('*').eq('delivery_id', deliveryId).single()
  if (derr || !delivery) return { error: derr?.message ?? 'Delivery not found' }
  if (delivery.status !== 'draft') return { error: 'Only draft deliveries can be composed into' }

  // Compose two spare looks, then check every look before it is saved: Claude's
  // eye on the photos, and each piece's size against the retailer. A look that
  // clashes, or holds a piece no longer in her size, never reaches the draft.
  const want = Math.max(1, Math.min(6, options.count ?? 3))
  const planned = await planDeliveryLooks(admin, delivery, { ...options, count: Math.min(6, want + 2) })
  if (planned.error || !planned.looks || !planned.mix) return { error: planned.error ?? 'Could not compose' }
  const { mix } = planned
  const judged = await judgeLooksForMember(admin, delivery.member_id, planned.looks, 'unknown')
  const rank = (i: number) => (judged[i].check?.verdict === 'works' ? 0 : judged[i].check ? 1 : 2)
  const passing = planned.looks.map((_, i) => i)
    .filter((i) => judged[i].check?.verdict !== 'clashes' && !hasPieceOutOfSize(judged[i]))
    .sort((a, b) => rank(a) - rank(b) || a - b)
  if (!passing.length) {
    const why = judged.flatMap((j) => j.check?.issues ?? []).slice(0, 3).join(' · ')
    return { error: `Every composed look failed the check${why ? ` — ${why}` : ''}. Compose again.` }
  }
  const looks = passing.slice(0, want).map((i) => planned.looks![i])
  const droppedByCheck = planned.looks.length - passing.length

  const { count } = await admin
    .from('pilot_look')
    .select('look_id', { count: 'exact', head: true })
    .eq('delivery_id', deliveryId)
  const startPos = (count ?? 0) + 1

  const rows = looks.map((l, i) => ({
    delivery_id: deliveryId,
    position: startPos + i,
    room_mix: mix,
    taste_vector: lookTasteVector(mix),
    items: l.items,
    notes: l.notes,
  }))
  const { error } = await admin.from('pilot_look').insert(rows)
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return { created: rows.length, ownedLooks: looks.filter((l) => l.ownedCount > 0).length, droppedByCheck }
}

async function requireAdmin(): Promise<boolean> {
  const { createServerClient } = await import('@/lib/supabase-server')
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user && user.id === process.env.ADMIN_USER_ID
}

export interface AskPreviewLook {
  items: LookItem[]
  notes: string | null
}

/**
 * TEST: what would MYRA make if this member asked for this?
 *
 * Runs the real composer against her real history and returns the looks —
 * nothing is inserted, nothing reaches her, nothing is learned. Admin only.
 */
export async function previewAskLooks(
  memberId: string,
  occasion: string,
  climate: string | null,
  count = 3,
): Promise<{ looks?: AskPreviewLook[]; mix?: Record<string, number>; error?: string }> {
  if (!(await requireAdmin())) return { error: 'Not authorised' }
  const admin = createAdminClient() as any
  const { data: member } = await admin
    .from('pilot_member').select('room_weights, work_dress_code').eq('member_id', memberId).single()
  if (!member) return { error: 'Member not found' }
  const { effectiveWeights } = await import('@/lib/pilot-stylist')
  const planned = await planDeliveryLooks(admin, {
    member_id: memberId,
    occasion,
    climate: climate as ClimateId | null,
    effective_weights: effectiveWeights(member.room_weights, occasion as any, member.work_dress_code),
  }, { count })
  if (planned.error || !planned.looks) return { error: planned.error ?? 'Could not compose' }
  return {
    looks: planned.looks.map((l: any) => ({ items: l.items, notes: l.notes ?? null })),
    mix: planned.mix as unknown as Record<string, number>,
  }
}

export interface AskSwapOption extends SwapOption {
  /** Ready to drop straight into the unsaved look. */
  lookItem: LookItem
}

/**
 * TEST: swap options for one piece of an UNSAVED test look.
 *
 * Same ranking as ⇄ SWAP on a composed look (rankAlternates: her taste, the
 * pieces staying in the look, the occasion, her gates) — but it takes the look
 * as it stands in the test panel rather than a saved look id, and writes
 * nothing: no swap is recorded and nothing is learned. Admin only.
 */
export interface AskSwapFilters {
  q?: string
  brand?: string
  colour?: string
  itemType?: string
}

/**
 * HER OWN SWAP — the alternates for one piece of an outfit MYRA built around
 * something she owns. Same ranking and gates as the studio's swap (her size,
 * her avoids, what goes with the rest of the look); nothing is saved and
 * nothing is learned, because playing with an outfit is not a decision.
 */
/** Her room mix for an occasion — what a delivery records as its effective weights. */
export async function effectiveWeightsForMember(memberId: string, occasion: string): Promise<Record<string, number>> {
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('room_weights, work_dress_code').eq('member_id', memberId).maybeSingle()
  const { effectiveWeights } = await import('@/lib/pilot-stylist')
  return effectiveWeights(member?.room_weights, occasion as any, member?.work_dress_code) as unknown as Record<string, number>
}

export async function swapOwnedLookItem(
  memberId: string,
  items: LookItem[],
  itemIndex: number,
  filters: AskSwapFilters = {},
): Promise<{ options?: AskSwapOption[]; brands?: { name: string; count: number }[]; types?: string[]; error?: string }> {
  const target = items[itemIndex]
  if (!target) return { error: 'No piece at that position' }
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', memberId).single()
  if (!member) return { error: 'Member not found' }
  const taste = await loadMemberTaste(admin, member)
  const library = await loadComposableLibrary(member)
  // A piece with no slot recorded (an older look) still knows what it is.
  const slot = ((target.slot as Slot | null) ?? null)
    ?? slotForItemType((library.find((i) => i.item_id === target.item_id)?.item_type ?? '') as any)
  if (!slot) return { error: 'This piece has no slot to swap within' }
  const keepIds = items.filter((it, i) => i !== itemIndex && it.item_id).map((it) => it.item_id as string)
  const keepItems = library.filter((i) => keepIds.includes(i.item_id))
  const exclude = new Set(items.filter((it) => it.item_id).map((it) => it.item_id as string))
  const lens = await loadPersonaLens(admin, memberId)
  const allRanked = rankAlternates(taste, library, slot, keepItems, exclude, 2000, undefined, lens)
  const brandCounts = new Map<string, number>()
  const typeSet = new Set<string>()
  for (const { item } of allRanked) {
    const b = item.brand?.name
    if (b) brandCounts.set(b, (brandCounts.get(b) ?? 0) + 1)
    if (item.item_type) typeSet.add(item.item_type)
  }
  const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const terms = fold(filters.q ?? '').split(/\s+/).filter(Boolean)
  const ranked = allRanked.filter(({ item }) => {
    if (filters.brand && item.brand?.name !== filters.brand) return false
    if (filters.colour && (item.colour_family ?? '').toLowerCase() !== filters.colour) return false
    if (filters.itemType && item.item_type !== filters.itemType) return false
    if (terms.length) {
      const hay = fold(`${item.brand?.name ?? ''} ${item.product_name} ${item.item_type ?? ''} ${item.colour_family ?? ''}`)
      if (!terms.every((term) => hay.includes(term))) return false
    }
    return true
  }).slice(0, 48)
  return {
    brands: Array.from(brandCounts.entries()).map(([name, count]) => ({ name, count })).sort((x, y) => x.name.localeCompare(y.name)),
    types: Array.from(typeSet).sort(),
    options: ranked.map(({ item, score }) => ({
      item_id: item.item_id,
      product_name: item.product_name,
      brand_name: item.brand?.name ?? null,
      colour_family: item.colour_family ?? null,
      item_type: (item as any).item_type ?? null,
      image_url: item.image_url ?? null,
      price_gbp: (item as any).price_gbp != null ? Number((item as any).price_gbp) : item.price != null ? Number(item.price) : null,
      score: Math.round(score * 100) / 100,
      lookItem: toLookItem(item),
    })),
  }
}

export async function askPreviewAlternates(
  memberId: string,
  occasion: string,
  climate: string | null,
  items: LookItem[],
  itemIndex: number,
  filters: AskSwapFilters = {},
): Promise<{ options?: AskSwapOption[]; brands?: { name: string; count: number }[]; types?: string[]; error?: string }> {
  if (!(await requireAdmin())) return { error: 'Not authorised' }
  const target = items[itemIndex]
  if (!target) return { error: 'No piece at that position' }
  const slot = (target.slot as Slot | null) ?? null
  if (!slot) return { error: 'This piece has no slot to swap within' }

  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', memberId).single()
  if (!member) return { error: 'Member not found' }
  const { effectiveWeights } = await import('@/lib/pilot-stylist')
  const taste = await loadMemberTaste(admin, member)
  const library = await loadComposableLibrary(member)
  const keepIds = items.filter((it, i) => i !== itemIndex && it.item_id).map((it) => it.item_id as string)
  const keepItems = library.filter((i) => keepIds.includes(i.item_id))
  const exclude = new Set(items.filter((it) => it.item_id).map((it) => it.item_id as string))
  const mix = normalise(effectiveWeights(member.room_weights, occasion as any, member.work_dress_code))
  const occ: OccasionContext = { id: occasion, vector: lookTasteVector(mix), climate: (climate as ClimateId | null) ?? null }
  const lens = await loadPersonaLens(admin, memberId)
  // Rank everything her gates allow in this slot, then filter — so a search
  // never offers a piece the composer would refuse, and the brand list is
  // exactly what is on offer.
  const allRanked = rankAlternates(taste, library, slot, keepItems, exclude, 2000, occ, lens)
  const brandCounts = new Map<string, number>()
  const typeSet = new Set<string>()
  for (const { item } of allRanked) {
    const b = item.brand?.name
    if (b) brandCounts.set(b, (brandCounts.get(b) ?? 0) + 1)
    if (item.item_type) typeSet.add(item.item_type)
  }
  const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const terms = fold(filters.q ?? '').split(/\s+/).filter(Boolean)
  const ranked = allRanked.filter(({ item }) => {
    if (filters.brand && item.brand?.name !== filters.brand) return false
    if (filters.colour && (item.colour_family ?? '').toLowerCase() !== filters.colour) return false
    if (filters.itemType && item.item_type !== filters.itemType) return false
    if (terms.length) {
      const hay = fold(`${item.brand?.name ?? ''} ${item.product_name} ${item.item_type ?? ''} ${item.colour_family ?? ''}`)
      if (!terms.every((term) => hay.includes(term))) return false
    }
    return true
  }).slice(0, 48)
  return {
    brands: Array.from(brandCounts.entries()).map(([name, count]) => ({ name, count })).sort((x, y) => x.name.localeCompare(y.name)),
    types: Array.from(typeSet).sort(),
    options: ranked.map(({ item, score }) => ({
      item_id: item.item_id,
      product_name: item.product_name,
      brand_name: item.brand?.name ?? null,
      colour_family: item.colour_family ?? null,
      item_type: (item as any).item_type ?? null,
      image_url: item.image_url ?? null,
      price_gbp: (item as any).price_gbp != null ? Number((item as any).price_gbp) : item.price != null ? Number(item.price) : null,
      score: Math.round(score * 100) / 100,
      lookItem: toLookItem(item),
    })),
  }
}

/**
 * Keep a test run: save exactly those looks as a real draft delivery, so they
 * can be shot and sent like any other. Still nothing reaches her until sent.
 */
/** What was changed on a test look before it was kept — recorded as learning. */
export interface AskLookEdits {
  swaps: { slot: string | null; out: LookItem; in: LookItem }[]
  removes: { slot: string | null; out: LookItem }[]
}

export async function keepAskPreview(
  memberId: string,
  occasion: string,
  climate: string | null,
  words: string,
  mix: Record<string, number>,
  looks: AskPreviewLook[],
  edits: AskLookEdits[] = [],
  shoot = false,
  /** Composed in the same test and NOT accepted — MYRA offered these and they were passed over. */
  passedOver: AskPreviewLook[] = [],
): Promise<{ deliveryId?: string; learned?: number; shooting?: number; error?: string }> {
  if (!(await requireAdmin())) return { error: 'Not authorised' }
  if (!looks.length) return { error: 'Nothing to keep' }
  const admin = createAdminClient() as any
  const row: Record<string, unknown> = {
    member_id: memberId,
    trigger: 'request',
    request_text: words.trim() || null,
    occasion,
    effective_weights: mix,
  }
  if (climate) row.climate = climate
  const { data: created, error } = await admin.from('pilot_delivery').insert(row).select('delivery_id').single()
  if (error || !created) return { error: error?.message ?? 'Could not create the delivery' }
  const norm = normalise(mix as unknown as RoomWeights)
  // Keeping a test look IS accepting it: saved approved, so the confidence
  // score and the composer count it exactly like an approval in DELIVERIES.
  // Without this, every look Chloe accepted straight away was invisible to the
  // score that is meant to predict which looks she accepts.
  const approvedAt = new Date().toISOString()
  const { data: inserted, error: lerr } = await admin.from('pilot_look').insert(looks.map((l, i) => ({
    delivery_id: created.delivery_id,
    position: i + 1,
    room_mix: norm,
    taste_vector: lookTasteVector(norm),
    items: l.items,
    notes: l.notes,
    approved_at: approvedAt,
  }))).select('look_id, position')
  if (lerr) return { error: lerr.message }

  // Kept — so the swaps and removals made in the test teach the composer
  // exactly as they would on a delivery (swapComposedLookItem /
  // removeComposedLookItem write the same rows).
  const lookIdAt = new Map(((inserted ?? []) as any[]).map((r) => [r.position, r.look_id]))
  const fb: any[] = []
  const brandsOut: string[] = []
  const brandsIn: string[] = []
  edits.forEach((e, i) => {
    const look_id = lookIdAt.get(i + 1)
    if (!look_id || !e) return
    for (const sw of e.swaps ?? []) {
      fb.push({
        member_id: memberId, delivery_id: created.delivery_id, look_id, action: 'swap', scope: DEFAULT_SCOPE,
        slot: sw.slot, item_out: sw.out.item_id ?? null, item_in: sw.in.item_id ?? null,
        brand_out: sw.out.brand_id ?? null, brand_in: sw.in.brand_id ?? null,
      })
      if (sw.out.brand) brandsOut.push(sw.out.brand)
      if (sw.in.brand) brandsIn.push(sw.in.brand)
    }
    for (const rm of e.removes ?? []) {
      fb.push({
        member_id: memberId, delivery_id: created.delivery_id, look_id, action: 'remove', scope: DEFAULT_SCOPE,
        slot: rm.slot, item_out: rm.out.item_id ?? null, brand_out: rm.out.brand_id ?? null,
      })
      if (rm.out.brand) brandsOut.push(rm.out.brand)
    }
  })
  // The pieces in each kept look were accepted — same rows as approveComposedLook,
  // written after the swaps so the latest answer on each piece is 'kept'.
  looks.forEach((l, i) => {
    const look_id = lookIdAt.get(i + 1)
    if (!look_id) return
    for (const it of l.items) {
      if (it.item_id) fb.push({ member_id: memberId, delivery_id: created.delivery_id, look_id, action: 'accept', scope: DEFAULT_SCOPE, slot: it.slot ?? null, item_in: it.item_id, brand_in: it.brand_id ?? null })
    }
    const bIds = Array.from(new Set(l.items.map((it) => it.brand_id).filter(Boolean))) as string[]
    for (let a = 0; a < bIds.length; a++) for (let b = a + 1; b < bIds.length; b++) {
      const [x, y] = pairKeyOrdered(bIds[a], bIds[b])
      fb.push({ member_id: memberId, delivery_id: created.delivery_id, look_id, action: 'accept', scope: DEFAULT_SCOPE, brand_out: x, brand_in: y })
    }
  })
  if (fb.length) {
    const r = await insertFeedback(admin, fb)
    if (r.error) return { deliveryId: created.delivery_id, error: `Looks kept, but the edits were not learned: ${r.error}` }
    try {
      if (brandsOut.length) await applyBrandSignals(admin, memberId, brandsOut, 'no')
      if (brandsIn.length) await applyBrandSignals(admin, memberId, brandsIn, 'yes')
    } catch { /* affinity nudge is best-effort, as on a delivery */ }
    for (const e of edits) {
      for (const sw of e?.swaps ?? []) await teachHouseStyle(admin, memberId, [sw.out], 'skip', 'swap')
      for (const rm of e?.removes ?? []) await teachHouseStyle(admin, memberId, [rm.out], 'skip', 'swap')
    }
  }
  // Keeping a look is approving it, for the style as for a delivery.
  for (const l of looks) await teachHouseStyle(admin, memberId, l.items, 'approve', 'review')
  // The looks composed beside them and passed over teach the style too — what
  // MYRA offered and Chloe did not take. Style-level only: no piece is marked
  // rejected for having lost to a better look in the same test.
  for (const l of passedOver) await teachHouseStyle(admin, memberId, l.items, 'skip', 'review')
  // And they are remembered as combinations, so the same outfit is not composed
  // again for the next brief.
  await recordPassedLooks(admin, memberId, occasion, passedOver)
  revalidatePath(PATH)

  // A light Higgsfield shoot for every kept look, started in the background: a
  // shoot takes minutes, and awaiting it would hold every other action on the
  // page behind it. Pictures land on the draft in DELIVERIES as they finish.
  const lookIds = ((inserted ?? []) as any[]).sort((a, b) => a.position - b.position).map((r) => r.look_id as string)
  if (shoot && lookIds.length) {
    void (async () => {
      for (const id of lookIds) {
        try {
          const r = await higgsfieldShootForLook(id, 'E5', { light: true })
          if (r.error) console.error('[keepAskPreview] light shoot', id, r.error)
        } catch (err) {
          // revalidatePath can throw once the request has ended — the image is already saved by then.
          console.error('[keepAskPreview] light shoot', id, err)
        }
      }
    })()
  }
  return { deliveryId: created.delivery_id, learned: fb.length, shooting: shoot ? lookIds.length : 0 }
}

// Style ONE hero several ways. Takes a composed look, holds its hero (the first
// item — the anchor) fixed, and composes distinct sibling looks around it, so
// the delivery answers "what else can I wear this with?". The looks join a
// variant_group so the review queue shows them together; each is a normal look
// that approves/swaps/shoots on its own. Ensures the group reaches `target`
// looks, and always adds at least one so pressing again gives another way.
export async function composeLookVariants(
  lookId: string,
  target = 3,
): Promise<{ created?: number; group?: string; error?: string }> {
  const admin = createAdminClient() as any
  const { data: look, error: lerr } = await admin.from('pilot_look').select('*').eq('look_id', lookId).single()
  if (lerr || !look) return { error: lerr?.message ?? 'Look not found' }
  const items: LookItem[] = look.items ?? []
  const hero = items.find((it) => it.item_id)
  if (!hero?.item_id) return { error: 'This look has no hero item to build around — compose or edit it first' }

  const { data: delivery, error: derr } = await admin.from('pilot_delivery').select('*').eq('delivery_id', look.delivery_id).single()
  if (derr || !delivery) return { error: derr?.message ?? 'Delivery not found' }
  if (delivery.status !== 'draft') return { error: 'Only draft deliveries can be styled into more looks' }
  const { data: member, error: merr } = await admin.from('pilot_member').select('*').eq('member_id', delivery.member_id).single()
  if (merr || !member) return { error: merr?.message ?? 'Member not found' }

  const taste = await loadMemberTaste(admin, member)
  const library = await loadComposableLibrary(member)
  const mix = normalise(delivery.effective_weights ?? {})
  const occ: OccasionContext = { id: delivery.occasion ?? null, vector: lookTasteVector(mix), climate: delivery.climate ?? null }
  const lens = await loadPersonaLens(admin, delivery.member_id)

  // Same history read as a fresh delivery, so variants avoid pieces she's rejected.
  const [{ data: priorLooks }, { data: fb }] = await Promise.all([
    admin.from('pilot_look').select('items, delivery:delivery_id!inner(member_id)').eq('delivery.member_id', delivery.member_id),
    allFeedbackRows(admin, delivery.member_id, 'item_in, item_out, action, created_at'),
  ])
  const seenCounts = new Map<string, number>()
  for (const l of priorLooks ?? []) for (const it of (l.items ?? []) as any[]) {
    if (it.item_id) seenCounts.set(it.item_id, (seenCounts.get(it.item_id) ?? 0) + 1)
  }
  // Same definition as a fresh delivery: only pieces whose latest answer is a rejection.
  const rejected = pieceVerdicts(fb ?? []).rejected

  const groupId: string = look.variant_group ?? look.look_id
  // Every look already in this group (this look included), so we don't repeat one.
  const { data: groupLooks } = look.variant_group
    ? await admin.from('pilot_look').select('items').eq('variant_group', groupId)
    : { data: [{ items }] }
  const existingSets = (groupLooks ?? []).map((l: any) =>
    new Set(((l.items ?? []) as any[]).map((it) => it.item_id).filter(Boolean)))
  // Not "is it identical" but "is it a different outfit". Two looks that share
  // the blouse, the trousers and the bag and differ by one sandal are the same
  // way of styling the piece.
  const sameSet = (a: Set<string>, b: Set<string>) =>
    tooSimilarVariant(Array.from(a), Array.from(b), hero.item_id)

  const need = Math.max(1, target - existingSets.length)
  const composed = composeMemberVariants(
    taste, library, hero.item_id, need + existingSets.length + 2, occ, lens, { seenCounts, rejected }, { ownedMode: 'blend' },
  )
  // The same check as every other way a look is made: a variant that clashes,
  // or holds a piece not in her size, is never saved. STYLE 3 WAYS was the one
  // path that skipped it.
  const judged = await judgeLooksForMember(admin, delivery.member_id, composed, 'unknown')
  const variants = composed.filter((_, i) => judged[i].check?.verdict !== 'clashes' && !hasPieceOutOfSize(judged[i]))
  const fresh: typeof variants = []
  for (const v of variants) {
    if (fresh.length >= need) break
    const vset = new Set(v.items.map((it) => it.item_id).filter(Boolean) as string[])
    if (existingSets.some((s: Set<string>) => sameSet(s, vset))) continue
    if (fresh.some((f) => sameSet(new Set(f.items.map((it) => it.item_id).filter(Boolean) as string[]), vset))) continue
    fresh.push(v)
  }
  if (!fresh.length) return { error: 'Could not find a different way to style this piece from the library' }

  const { count } = await admin.from('pilot_look').select('look_id', { count: 'exact', head: true }).eq('delivery_id', look.delivery_id)
  const startPos = (count ?? 0) + 1
  const rows = fresh.map((l, i) => ({
    delivery_id: look.delivery_id,
    position: startPos + i,
    room_mix: mix,
    taste_vector: lookTasteVector(mix),
    items: l.items,
    notes: l.notes,
    variant_group: groupId,
    hero_item_id: hero.item_id,
  }))
  const { error } = await admin.from('pilot_look').insert(rows)
  if (error) return { error: error.message }
  // Tag the seed look into the group too, so they render together.
  if (!look.variant_group) {
    await admin.from('pilot_look').update({ variant_group: groupId, hero_item_id: hero.item_id }).eq('look_id', look.look_id)
  }
  revalidatePath(PATH)
  return { created: rows.length, group: groupId }
}

export interface SwapOption {
  item_id: string
  product_name: string
  brand_name: string | null
  colour_family: string | null
  item_type: string | null
  image_url: string | null
  price_gbp: number | null
  score: number
}

export async function lookAlternates(lookId: string, itemIndex: number): Promise<{ options?: SwapOption[]; error?: string }> {
  const admin = createAdminClient() as any
  const { data: look, error: lerr } = await admin.from('pilot_look').select('*').eq('look_id', lookId).single()
  if (lerr || !look) return { error: lerr?.message ?? 'Look not found' }
  const items: LookItem[] = look.items ?? []
  const target = items[itemIndex]
  if (!target) return { error: 'No item at that position' }
  const { data: delivery } = await admin.from('pilot_delivery').select('*').eq('delivery_id', look.delivery_id).single()
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', delivery?.member_id).single()
  if (!member) return { error: 'Member not found' }

  const slot = (target.slot as Slot | null) ?? null
  if (!slot) return { error: 'This item was added by hand — edit the look instead' }

  const taste = await loadMemberTaste(admin, member)
  const library = await loadComposableLibrary(member)
  const keepIds = items.filter((it, i) => i !== itemIndex && it.item_id).map((it) => it.item_id as string)
  const keepItems = library.filter((i) => keepIds.includes(i.item_id))
  const exclude = new Set(items.filter((it) => it.item_id).map((it) => it.item_id as string))

  const occ: OccasionContext = { id: delivery?.occasion ?? null, vector: lookTasteVector(normalise(delivery?.effective_weights ?? {})), climate: delivery?.climate ?? null }
  const lens = await loadPersonaLens(admin, delivery?.member_id)
  const ranked = rankAlternates(taste, library, slot, keepItems, exclude, 200, occ, lens)
  return {
    options: ranked.map(({ item, score }) => ({
      item_id: item.item_id,
      product_name: item.product_name,
      brand_name: item.brand?.name ?? null,
      colour_family: item.colour_family ?? null,
      item_type: (item as any).item_type ?? null,
      image_url: item.image_url ?? null,
      price_gbp: (item as any).price_gbp != null ? Number((item as any).price_gbp) : item.price != null ? Number(item.price) : null,
      score: Math.round(score * 100) / 100,
    })),
  }
}

// Ranked options to ADD a slot the look doesn't have yet (bag, jewellery,
// outerwear…) — same taste × coherence × occasion ranking as the swap picker.
export async function lookAddOptions(lookId: string, slot: string): Promise<{ options?: SwapOption[]; error?: string }> {
  const admin = createAdminClient() as any
  const { data: look, error: lerr } = await admin.from('pilot_look').select('*').eq('look_id', lookId).single()
  if (lerr || !look) return { error: lerr?.message ?? 'Look not found' }
  const items: LookItem[] = look.items ?? []
  const { data: delivery } = await admin.from('pilot_delivery').select('*').eq('delivery_id', look.delivery_id).single()
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', delivery?.member_id).single()
  if (!member) return { error: 'Member not found' }

  const taste = await loadMemberTaste(admin, member)
  const library = await loadComposableLibrary(member)
  const keepIds = items.filter((it) => it.item_id).map((it) => it.item_id as string)
  const keepItems = library.filter((i) => keepIds.includes(i.item_id))
  const exclude = new Set(keepIds)
  const occ: OccasionContext = { id: delivery?.occasion ?? null, vector: lookTasteVector(normalise(delivery?.effective_weights ?? {})), climate: delivery?.climate ?? null }

  const lens = await loadPersonaLens(admin, delivery?.member_id)
  const ranked = rankAlternates(taste, library, slot as Slot, keepItems, exclude, 200, occ, lens)
  return {
    options: ranked.map(({ item, score }) => ({
      item_id: item.item_id,
      product_name: item.product_name,
      brand_name: item.brand?.name ?? null,
      colour_family: item.colour_family ?? null,
      item_type: (item as any).item_type ?? null,
      image_url: item.image_url ?? null,
      price_gbp: (item as any).price_gbp != null ? Number((item as any).price_gbp) : item.price != null ? Number(item.price) : null,
      score: Math.round(score * 100) / 100,
    })),
  }
}

export async function addComposedLookItem(lookId: string, newItemId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { data: look, error: lerr } = await admin.from('pilot_look').select('*').eq('look_id', lookId).single()
  if (lerr || !look) return { error: lerr?.message ?? 'Look not found' }
  const items: LookItem[] = [...(look.items ?? [])]
  const { data: delivery } = await admin.from('pilot_delivery').select('member_id').eq('delivery_id', look.delivery_id).single()
  if (!delivery) return { error: 'Delivery not found' }

  const { data: newItem, error: ierr } = await admin.from('item').select('*, brand(*)').eq('item_id', newItemId).single()
  if (ierr || !newItem) return { error: ierr?.message ?? 'Item not found' }
  if (items.some((it) => it.item_id === newItemId)) return { error: 'Already in this look' }
  const incoming = toLookItem(newItem as ItemWithBrand)
  items.push(incoming)

  const { error: uerr } = await admin.from('pilot_look').update({ items }).eq('look_id', lookId)
  if (uerr) return { error: uerr.message }

  // Chloe choosing a piece is a positive signal — same shape as an approval.
  const fb: any[] = [{
    member_id: delivery.member_id,
    delivery_id: look.delivery_id,
    look_id: lookId,
    action: 'accept', scope: DEFAULT_SCOPE,
    slot: incoming.slot ?? null,
    item_in: incoming.item_id ?? null,
    brand_in: incoming.brand_id ?? null,
  }]
  if (incoming.brand_id) {
    for (const other of items) {
      if (other === incoming || !other.brand_id || other.brand_id === incoming.brand_id) continue
      const [a, b] = pairKeyOrdered(incoming.brand_id, other.brand_id)
      fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'accept', scope: DEFAULT_SCOPE, brand_out: a, brand_in: b })
    }
  }
  await insertFeedback(admin, fb)

  try {
    if (incoming.brand) await applyBrandSignals(admin, delivery.member_id, [incoming.brand], 'yes')
  } catch { /* best-effort */ }

  revalidatePath(PATH)
  return {}
}

export async function swapComposedLookItem(lookId: string, itemIndex: number, newItemId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { data: look, error: lerr } = await admin.from('pilot_look').select('*').eq('look_id', lookId).single()
  if (lerr || !look) return { error: lerr?.message ?? 'Look not found' }
  const items: LookItem[] = [...(look.items ?? [])]
  const outgoing = items[itemIndex]
  if (!outgoing) return { error: 'No item at that position' }
  const { data: delivery } = await admin.from('pilot_delivery').select('member_id').eq('delivery_id', look.delivery_id).single()
  if (!delivery) return { error: 'Delivery not found' }

  const { data: newItem, error: ierr } = await admin.from('item').select('*, brand(*)').eq('item_id', newItemId).single()
  if (ierr || !newItem) return { error: ierr?.message ?? 'Item not found' }
  const incoming = toLookItem(newItem as ItemWithBrand)
  items[itemIndex] = incoming

  const { error: uerr } = await admin.from('pilot_look').update({ items }).eq('look_id', lookId)
  if (uerr) return { error: uerr.message }

  // Teach: the outgoing item was wrong for HER; its pairings take a knock.
  const fb: any[] = [{
    member_id: delivery.member_id,
    delivery_id: look.delivery_id,
    look_id: lookId,
    action: 'swap', scope: DEFAULT_SCOPE,
    slot: outgoing.slot ?? null,
    item_out: outgoing.item_id ?? null,
    item_in: incoming.item_id ?? null,
    brand_out: outgoing.brand_id ?? null,
    brand_in: incoming.brand_id ?? null,
  }]
  if (outgoing.brand_id) {
    for (const other of items) {
      if (other === incoming || !other.brand_id || other.brand_id === outgoing.brand_id) continue
      const [a, b] = pairKeyOrdered(outgoing.brand_id, other.brand_id)
      fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'swap', scope: DEFAULT_SCOPE, brand_out: a, brand_in: b })
    }
  }
  await insertFeedback(admin, fb)

  // Brand affinity learning (member-scoped, shared machinery with the feed).
  try {
    if (outgoing.brand) await applyBrandSignals(admin, delivery.member_id, [outgoing.brand], 'no')
    if (incoming.brand) await applyBrandSignals(admin, delivery.member_id, [incoming.brand], 'yes')
  } catch { /* affinity nudge is best-effort */ }
  await teachHouseStyle(admin, delivery.member_id, [outgoing], 'skip', 'swap')

  revalidatePath(PATH)
  return {}
}

export async function removeComposedLookItem(lookId: string, itemIndex: number): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { data: look, error: lerr } = await admin.from('pilot_look').select('*').eq('look_id', lookId).single()
  if (lerr || !look) return { error: lerr?.message ?? 'Look not found' }
  const items: LookItem[] = [...(look.items ?? [])]
  const outgoing = items[itemIndex]
  if (!outgoing) return { error: 'No item at that position' }
  const { data: delivery } = await admin.from('pilot_delivery').select('member_id').eq('delivery_id', look.delivery_id).single()
  if (!delivery) return { error: 'Delivery not found' }

  items.splice(itemIndex, 1)
  const { error: uerr } = await admin.from('pilot_look').update({ items }).eq('look_id', lookId)
  if (uerr) return { error: uerr.message }

  // Teach: removed = wrong for HER (same penalty as a swap-out, no incoming).
  const fb: any[] = [{
    member_id: delivery.member_id,
    delivery_id: look.delivery_id,
    look_id: lookId,
    action: 'remove', scope: DEFAULT_SCOPE,
    slot: outgoing.slot ?? null,
    item_out: outgoing.item_id ?? null,
    brand_out: outgoing.brand_id ?? null,
  }]
  if (outgoing.brand_id) {
    for (const other of items) {
      if (!other.brand_id || other.brand_id === outgoing.brand_id) continue
      const [a, b] = pairKeyOrdered(outgoing.brand_id, other.brand_id)
      fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'remove', scope: DEFAULT_SCOPE, brand_out: a, brand_in: b })
    }
  }
  await insertFeedback(admin, fb)

  try {
    if (outgoing.brand) await applyBrandSignals(admin, delivery.member_id, [outgoing.brand], 'no')
  } catch { /* best-effort */ }
  await teachHouseStyle(admin, delivery.member_id, [outgoing], 'skip', 'swap')

  revalidatePath(PATH)
  return {}
}

export async function approveComposedLook(lookId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { data: look, error: lerr } = await admin.from('pilot_look').select('*').eq('look_id', lookId).single()
  if (lerr || !look) return { error: lerr?.message ?? 'Look not found' }
  const { data: delivery } = await admin.from('pilot_delivery').select('member_id').eq('delivery_id', look.delivery_id).single()
  if (!delivery) return { error: 'Delivery not found' }

  const { error: uerr } = await admin.from('pilot_look').update({ approved_at: new Date().toISOString() }).eq('look_id', lookId)
  if (uerr) return { error: uerr.message }

  const items: LookItem[] = look.items ?? []
  const fb: any[] = []
  for (const it of items) {
    if (it.item_id) fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'accept', scope: DEFAULT_SCOPE, slot: it.slot ?? null, item_in: it.item_id, brand_in: it.brand_id ?? null })
  }
  const brandIds = Array.from(new Set(items.map((it) => it.brand_id).filter(Boolean))) as string[]
  for (let i = 0; i < brandIds.length; i++) {
    for (let j = i + 1; j < brandIds.length; j++) {
      const [a, b] = pairKeyOrdered(brandIds[i], brandIds[j])
      fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'accept', scope: DEFAULT_SCOPE, brand_out: a, brand_in: b })
    }
  }
  if (fb.length) await insertFeedback(admin, fb)

  try {
    const brandNames = Array.from(new Set(items.map((it) => it.brand).filter(Boolean)))
    if (brandNames.length) await applyBrandSignals(admin, delivery.member_id, brandNames, 'yes')
  } catch { /* best-effort */ }
  await teachHouseStyle(admin, delivery.member_id, items, 'approve', 'review')

  revalidatePath(PATH)
  return {}
}

// The mirror of approveComposedLook: every item and brand pairing is logged
// as a rejection ('remove' — the existing negative vocabulary), her brand
// affinities take the negative signal, and the look is removed. Distinct from
// × (delete), which throws a look away WITHOUT teaching anything.
export async function skipComposedLook(lookId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { data: look, error: lerr } = await admin.from('pilot_look').select('*').eq('look_id', lookId).single()
  if (lerr || !look) return { error: lerr?.message ?? 'Look not found' }
  const { data: delivery } = await admin.from('pilot_delivery').select('member_id').eq('delivery_id', look.delivery_id).single()
  if (!delivery) return { error: 'Delivery not found' }

  const items: LookItem[] = look.items ?? []
  const fb: any[] = []
  for (const it of items) {
    // item_OUT, like every other rejection. Skipping used to record the piece
    // as item_in — the column that means "she chose this" — so the strongest
    // rejection in the system was invisible to the learning that reads
    // item_out. 197 of Alison's skips taught nothing.
    if (it.item_id) fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'remove', scope: DEFAULT_SCOPE, slot: it.slot ?? null, item_out: it.item_id, brand_out: it.brand_id ?? null })
  }
  const brandIds = Array.from(new Set(items.map((it) => it.brand_id).filter(Boolean))) as string[]
  for (let i = 0; i < brandIds.length; i++) {
    for (let j = i + 1; j < brandIds.length; j++) {
      const [a, b] = pairKeyOrdered(brandIds[i], brandIds[j])
      fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'remove', scope: DEFAULT_SCOPE, brand_out: a, brand_in: b })
    }
  }
  if (fb.length) {
    const { error: fbErr } = await insertFeedback(admin, fb)
    if (fbErr) return { error: fbErr }
  }

  try {
    const brandNames = Array.from(new Set(items.map((it) => it.brand).filter(Boolean)))
    if (brandNames.length) await applyBrandSignals(admin, delivery.member_id, brandNames, 'no')
  } catch { /* best-effort */ }
  await teachHouseStyle(admin, delivery.member_id, items, 'skip', 'review')

  const { error: derr } = await admin.from('pilot_look').delete().eq('look_id', lookId)
  if (derr) return { error: derr.message }
  revalidatePath(PATH)
  return {}
}

/**
 * Generate (or regenerate) the editorial shoot for a look. Every result is
 * appended to shoot_history, so a redo never destroys the previous image —
 * pick a different pose, compare the two, keep the better one.
 */
/**
 * light: one generation for a first picture of a look just accepted. Still
 * fidelity-checked, but no corrective re-render and no "ways to wear it"
 * variant looks — those belong to a full shoot from DELIVERIES.
 */
export async function higgsfieldShootForLook(lookId: string, poseKey = 'E5', opts: { light?: boolean } = {}): Promise<{ imageUrl?: string; variants?: number; error?: string }> {
  const admin = createAdminClient() as any
  const { data: look, error: lerr } = await admin.from('pilot_look').select('*').eq('look_id', lookId).single()
  if (lerr || !look) return { error: lerr?.message ?? 'Look not found' }
  const items: LookItem[] = look.items ?? []

  // Backfill shoot fields from the item table for anything added by hand.
  const missing = items.filter((it) => it.item_id && (!it.image_url || !it.item_type))
  if (missing.length) {
    const { data: rows } = await admin.from('item').select('item_id, image_url, item_type, material_primary').in('item_id', missing.map((it) => it.item_id))
    const byId = new Map<string, any>((rows ?? []).map((r: any) => [r.item_id, r]))
    for (const it of missing) {
      const r = byId.get(it.item_id as string)
      if (r) {
        it.image_url = it.image_url ?? r.image_url
        it.item_type = it.item_type ?? r.item_type
        it.material_primary = it.material_primary ?? r.material_primary
        it.slot = it.slot ?? (r.item_type ? slotForItemType(r.item_type) : null)
      }
    }
  }

  // Owned pieces go FIRST: buildReferenceUrls caps references at five, and a
  // look built around what she owns must render those pieces exactly as
  // extracted — the retail pieces are the ones that can fall off the end.
  const shootItems: ShootItem[] = [...items]
    .sort((a, b) => Number(Boolean(b.owned)) - Number(Boolean(a.owned)))
    .filter((it) => it.image_url)
    .map((it) => ({
      product_name: it.product_name,
      item_type: (it.item_type ?? 'blouse') as any,
      material_primary: it.material_primary ?? null,
      slot: (it.slot ?? 'top') as any,
      image_url: it.image_url as string,
      brand_name: it.brand ?? null,
    }))
  if (!shootItems.length) return { error: 'No item images on this look — compose or add items with photos first' }

  const combo = HIGGSFIELD_COMBOS[poseKey] ?? HIGGSFIELD_COMBOS.E5
  const prompt = buildGenerationPrompt(combo, shootItems)
  const refs = buildReferenceUrls(combo, shootItems)
  let gen = await runHiggsfieldGeneration(prompt, refs, `pilot-look-${lookId}-${Date.now()}`)
  if (!gen.imageUrl) return gen

  // RENDER FIDELITY CHECK — applies unchanged to private looks, owned pieces
  // included: colour, silhouette, cut and length must match the real item
  // photos (for owned pieces, the extracted cutout). Fail → one retry with
  // corrective notes; second failure → the render is kept in history, flagged,
  // and does NOT become the look's image.
  let fidelity: { score: number; passed: boolean; issues: any[] } | null = null
  try {
    const fidelityItems = shootItems
      .filter((i): i is ShootItem & { image_url: string } => !!i.image_url)
      .map((i) => ({ label: [i.brand_name, i.product_name].filter(Boolean).join(' — ') || String(i.item_type), image_url: i.image_url }))
    const first = await checkRenderFidelity(gen.imageUrl, fidelityItems)
    fidelity = { score: first.score, passed: first.passed, issues: first.issues }
    if (!first.passed && !first.error && !opts.light) {
      const retryPrompt = first.correctiveNotes
        ? `${prompt}\n\nMANDATORY CORRECTIONS — the previous render misrepresented the clothes: ${first.correctiveNotes}`
        : prompt
      const retry = await runHiggsfieldGeneration(retryPrompt, refs, `pilot-look-${lookId}-${Date.now()}`)
      if (retry.imageUrl) {
        const second = await checkRenderFidelity(retry.imageUrl, fidelityItems)
        const secondFidelity = { score: second.score, passed: second.passed, issues: second.issues }
        if (second.passed || second.error) {
          gen = retry
          fidelity = secondFidelity
        } else {
          // BOTH attempts are kept. The first used to be discarded here — its
          // file survived on Cloudinary but the URL was lost — and the retry is
          // often the WORSE of the two: corrective notes told it to fix a
          // striped blouse and it changed the trousers instead. Measured on
          // 23 Aug: 72%→42%, 55%→35%, 62%→62%. Throwing away the better image
          // and showing her the worse one is not a defensible default.
          const history: any[] = Array.isArray(look.shoot_history) ? look.shoot_history : []
          const at = new Date().toISOString()
          history.push({ url: gen.imageUrl, pose: poseKey, created_at: at, fidelity, flagged: true, attempt: 1 })
          history.push({ url: retry.imageUrl, pose: poseKey, created_at: at, fidelity: secondFidelity, flagged: true, attempt: 2 })
          await admin.from('pilot_look').update({ shoot_history: history.slice(-12) }).eq('look_id', lookId)
          revalidatePath(PATH)
          const best = Math.round(Math.max(first.score, second.score) * 100)
          return { error: `Render misrepresented the clothes on both attempts — best was ${best}% faithful. Both are on the look to keep or reshoot.` }
        }
      }
    }
  } catch (err) {
    console.error('[higgsfieldShootForLook] fidelity check errored — continuing unchecked', err)
  }

  // Append to history rather than replacing — the previous shoot stays
  // reachable. EVERY frame the generation returned goes in, not just the one
  // that becomes the look image: a shoot is a small batch and the second frame
  // is often the better shot, so it should be one tap away rather than lost.
  const history: any[] = Array.isArray(look.shoot_history) ? look.shoot_history : []
  const at = new Date().toISOString()
  const frames = (gen.imageUrls?.length ? gen.imageUrls : [gen.imageUrl]).filter(Boolean) as string[]
  frames.forEach((url, i) => {
    if (history.some((h) => h?.url === url)) return
    history.push({
      url, pose: poseKey, created_at: at,
      // Only the frame that was actually checked carries a fidelity score.
      ...(i === 0 && fidelity ? { fidelity } : {}),
      ...(i > 0 ? { frame: i + 1, unchecked: true } : {}),
    })
  })
  await admin.from('pilot_look')
    .update({ image_url: gen.imageUrl, shoot_history: history.slice(-12) })
    .eq('look_id', lookId)

  // Shooting a look is committing to it — nobody spends a Higgsfield
  // generation on an outfit they are about to bin — so the sibling ways of
  // wearing the same piece are built here rather than waiting for the button.
  // Gating this on approved_at meant it never fired: the shoot usually comes
  // BEFORE the approval, not after.
  let variants = 0
  try {
    if (!opts.light) {
      const r = await composeLookVariants(lookId)
      variants = r.created ?? 0
    }
  } catch (err) {
    // Best-effort. A look with no second way to wear it has still been shot.
    console.error('[higgsfieldShootForLook] variants after shoot', err)
  }

  revalidatePath(PATH)
  return { ...gen, variants }
}

/**
 * Drop one frame from a look's shoot history.
 *
 * A generation returns several frames and most of them are not the one. The
 * file stays on Cloudinary — this removes the reference, which is what
 * "delete the unwanted frames" means here; nothing that another look might be
 * using is destroyed.
 *
 * Deleting the frame currently in use promotes the best remaining one rather
 * than leaving the look with no picture.
 */
export async function deleteLookShoot(lookId: string, url: string): Promise<{ remaining?: number; error?: string }> {
  const admin = createAdminClient() as any
  const { data: look, error } = await admin
    .from('pilot_look').select('shoot_history, image_url').eq('look_id', lookId).single()
  if (error || !look) return { error: error?.message ?? 'Look not found' }

  const history: any[] = Array.isArray(look.shoot_history) ? look.shoot_history : []
  const kept = history.filter((h) => h?.url !== url)
  if (kept.length === history.length) return { error: 'That frame is not on this look' }

  const patch: Record<string, unknown> = { shoot_history: kept }
  if (look.image_url === url) {
    // Best of what is left: a checked frame with the highest score, else the
    // most recent.
    const scored = kept.filter((h) => typeof h?.fidelity?.score === 'number')
      .sort((a, b) => (b.fidelity.score ?? 0) - (a.fidelity.score ?? 0))
    patch.image_url = scored[0]?.url ?? kept[kept.length - 1]?.url ?? null
  }
  const { error: uerr } = await admin.from('pilot_look').update(patch).eq('look_id', lookId)
  if (uerr) return { error: uerr.message }
  revalidatePath(PATH)
  return { remaining: kept.length }
}

/** Put a previous shoot back as the look's image. Nothing is deleted. */
export async function restoreLookShoot(lookId: string, url: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { data: look, error } = await admin
    .from('pilot_look').select('shoot_history').eq('look_id', lookId).single()
  if (error || !look) return { error: error?.message ?? 'Look not found' }
  const history: any[] = Array.isArray(look.shoot_history) ? look.shoot_history : []
  if (!history.some((h) => h?.url === url)) return { error: 'That shoot is not in this look’s history' }
  await admin.from('pilot_look').update({ image_url: url }).eq('look_id', lookId)
  revalidatePath(PATH)
  return {}
}


// ── Wardrobe import: rebuild looks after an owned piece is deleted ──────────
// A client may delete a source photo at any time; every owned item extracted
// from it goes with it, and any look that used one of those items is rebuilt:
// the piece comes out, the slot is refilled from her pool with the same taste
// × coherence ranking, and a shoot that showed the deleted piece is retired to
// history so the lookbook never shows something she has removed.
export async function rebuildLooksWithoutItems(itemIds: string[]): Promise<{ rebuilt: number; error?: string }> {
  if (!itemIds.length) return { rebuilt: 0 }
  const admin = createAdminClient() as any
  const removed = new Set(itemIds)
  let rebuilt = 0
  try {
    const looks = await looksUsingItems(itemIds)
    const byMember = new Map<string, { taste: MemberTaste; library: ItemWithBrand[]; lens?: PersonaLens }>()
    for (const look of looks) {
      const kept: LookItem[] = look.items.filter((it: any) => !(it?.item_id && removed.has(it.item_id)))
      const gone: LookItem[] = look.items.filter((it: any) => it?.item_id && removed.has(it.item_id))
      if (!gone.length) continue

      let ctx = byMember.get(look.member_id)
      if (!ctx) {
        const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', look.member_id).single()
        if (!member) continue
        ctx = { taste: await loadMemberTaste(admin, member), library: await loadComposableLibrary(member), lens: await loadPersonaLens(admin, look.member_id) }
        byMember.set(look.member_id, ctx)
      }
      const { data: delivery } = await admin.from('pilot_delivery').select('*').eq('delivery_id', look.delivery_id).single()
      const occ: OccasionContext = { id: delivery?.occasion ?? null, vector: lookTasteVector(normalise(delivery?.effective_weights ?? {})), climate: delivery?.climate ?? null }

      const keepIds = kept.filter((it) => it.item_id).map((it) => it.item_id as string)
      const items: LookItem[] = [...kept]
      for (const g of gone) {
        if (!g.slot) continue
        const keepItems = ctx.library.filter((i) => items.some((it) => it.item_id === i.item_id))
        const exclude = new Set([...keepIds, ...items.map((it) => it.item_id).filter(Boolean) as string[], ...Array.from(removed)])
        const [pick] = rankAlternates(ctx.taste, ctx.library, g.slot as Slot, keepItems, exclude, 1, occ, ctx.lens)
        if (pick) items.push(toLookItem(pick.item))
      }

      const history: any[] = Array.isArray(look.shoot_history) ? look.shoot_history : []
      const note = `Rebuilt ${new Date().toISOString().slice(0, 10)}: ${gone.map((g) => g.product_name).join(', ')} removed from her wardrobe`
      const { data: cur } = await admin.from('pilot_look').select('notes').eq('look_id', look.look_id).single()
      await admin.from('pilot_look').update({
        items,
        notes: [cur?.notes, note].filter(Boolean).join(' · '),
        // the old shoot showed a piece that no longer exists — retire it
        image_url: null,
        shoot_history: history.slice(-12),
      }).eq('look_id', look.look_id)
      rebuilt++
    }
  } catch (err) {
    return { rebuilt, error: err instanceof Error ? err.message : 'Rebuild failed' }
  }
  if (rebuilt) revalidatePath(PATH)
  return { rebuilt }
}


/** Member taste for server-side callers outside this file (wardrobe "what to buy"). */
export async function loadMemberTasteFor(memberId: string): Promise<MemberTaste | null> {
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', memberId).single()
  if (!member) return null
  return loadMemberTaste(admin, member)
}

/** Retail + her owned pieces — the pool the composer sees for this member. */
export async function loadMemberLibrary(memberId: string): Promise<ItemWithBrand[]> {
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('member_id, auth_user_id').eq('member_id', memberId).single()
  return loadComposableLibrary(member ?? null)
}

/** Her stylist persona's lens — the filter her looks are composed through. */
export async function loadMemberPersonaLens(memberId: string): Promise<PersonaLens | undefined> {
  const admin = createAdminClient() as any
  return loadPersonaLens(admin, memberId)
}


// ── TRUST GATE ─────────────────────────────────────────────────────────────

/** How often one slot gets edited, over the trailing review window. The read
 *  that turns "clean rate is 30%" into a single thing to fix: if shoes are
 *  swapped on most looks, the composer's shoe ranking for her is wrong, and one
 *  change lifts every future look at once. Counted as DISTINCT looks touched in
 *  that slot, so swapping shoes four times on one look is one look, not four. */
export interface SlotEdit {
  slot: string
  /** Looks in the window where this slot was swapped at least once. */
  swapped: number
  /** Looks where this slot's piece was pulled out. */
  removed: number
}

export interface MemberTrust extends TrustRead {
  headline: string
  /** What her decisions have taught the composer, in plain language. */
  learned: string[]
  /** Where the edits land, worst slot first. Denominator is `sample`. */
  slotEdits: SlotEdit[]
}

/**
 * How far this member is from being sent looks unreviewed.
 *
 * Everything is derived from what already happened — the looks composed for
 * her, the edits made to them, and her own verdicts — so the number can never
 * disagree with the history it came from.
 */
export async function loadMemberTrust(memberId: string): Promise<MemberTrust | { error: string }> {
  try {
    const admin = createAdminClient() as any
    const { data: deliveries } = await admin
      .from('pilot_delivery').select('delivery_id').eq('member_id', memberId)
    const ids = (deliveries ?? []).map((d: any) => d.delivery_id)
    if (!ids.length) {
      const empty = readTrust([])
      return { ...empty, headline: trustHeadline(empty), learned: [], slotEdits: [] }
    }

    const [{ data: looks }, { data: fb }] = await Promise.all([
      admin.from('pilot_look')
        .select('look_id, created_at, approved_at, response, items')
        .in('delivery_id', ids).order('created_at'),
      admin.from('pilot_look_feedback')
        .select('look_id, action, slot, item_out, feedback_id').eq('member_id', memberId).limit(5000),
    ])

    // Count DISTINCT pieces, not feedback rows. Swapping the same slot four
    // times before settling is one piece rejected, not four — counting rows
    // put "pieces that didn't survive" at 276%, which is not a number.
    const swapsBy = new Map<string, Set<string>>()
    const removesBy = new Map<string, Set<string>>()
    for (const f of fb ?? []) {
      if (!f.look_id) continue
      const key = f.item_out ?? f.slot ?? f.feedback_id
      if (!key) continue
      const bucket = f.action === 'swap' ? swapsBy : f.action === 'remove' ? removesBy : null
      if (!bucket) continue
      const set = bucket.get(f.look_id) ?? new Set<string>()
      set.add(String(key))
      bucket.set(f.look_id, set)
    }
    const outcomes: LookOutcome[] = (looks ?? []).map((l: any) => {
      const swaps = swapsBy.get(l.look_id)?.size ?? 0
      const removes = removesBy.get(l.look_id)?.size ?? 0
      return {
        look_id: l.look_id,
        created_at: l.created_at,
        edits: swaps + removes,
        swaps,
        removes,
        items: Array.isArray(l.items) ? l.items.length : 0,
        approved: !!l.approved_at,
        response: l.response ?? null,
      }
    })

    const trust = readTrust(outcomes)

    // Per-slot edit breakdown over the SAME trailing window readTrust scores,
    // so the denominator matches the clean rate the panel shows. Distinct looks
    // per slot — a slot swapped repeatedly on one look counts once.
    const decidedForWindow = outcomes.filter((o) => o.approved || o.edits > 0)
    const windowIds = new Set(decidedForWindow.slice(-TRAILING).map((o) => o.look_id))
    const swapSlot = new Map<string, Set<string>>()
    const removeSlot = new Map<string, Set<string>>()
    for (const f of fb ?? []) {
      if (!f.look_id || !f.slot || !windowIds.has(f.look_id)) continue
      const m = f.action === 'swap' ? swapSlot : f.action === 'remove' ? removeSlot : null
      if (!m) continue
      const set = m.get(f.slot) ?? new Set<string>()
      set.add(f.look_id)
      m.set(f.slot, set)
    }
    const slotKeys = new Set<string>()
    swapSlot.forEach((_v, k) => slotKeys.add(k))
    removeSlot.forEach((_v, k) => slotKeys.add(k))
    const slotEdits: SlotEdit[] = []
    slotKeys.forEach((slot) =>
      slotEdits.push({ slot, swapped: swapSlot.get(slot)?.size ?? 0, removed: removeSlot.get(slot)?.size ?? 0 }),
    )
    slotEdits.sort((a, b) => (b.swapped + b.removed) - (a.swapped + a.removed))

    // The learned traits, named rather than hashed, so the learning is
    // auditable: she can see what it has concluded and disagree with it.
    const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', memberId).maybeSingle()
    let learned: string[] = []
    if (member) {
      const { data: rows } = await admin.from('pilot_look_feedback').select('*').eq('member_id', memberId).limit(5000)
      const model = await buildMemberTraitModel(admin, rows ?? [])
      if (model) {
        const { data: brands } = await admin.from('brand').select('brand_id, name')
        const byId = new Map((brands ?? []).map((b: any) => [b.brand_id, b.name as string]))
        learned = explainTraits(model, (t) =>
          t.split('+').map((part) => {
            const [kind, val] = [part.slice(0, part.indexOf(':')), part.slice(part.indexOf(':') + 1)]
            return kind === 'brand' ? (byId.get(val) ?? val) : val.replace(/_/g, ' ')
          }).join(' · ').toUpperCase())
      }
    }

    return { ...trust, headline: trustHeadline(trust), learned, slotEdits }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not read trust' }
  }
}


// ── DRESSING ROOM ────────────────────────────────────────────────────────────
// Her own pieces, styled. Every function resolves the member on the server —
// her session, or the member Chloe names when testing from HER VIEW — and the
// outfits come from the same composer and the same look check as a delivery.
// Nothing here is saved.

export interface DressingRoomPiece {
  item_id: string
  product_name: string
  item_type: string | null
  slot: string | null
  image_url: string | null
  colour_family: string | null
  /** Looks she has been sent (or, testing, every look) that use this piece. */
  styled_in: number
}

export interface DressingRoomView {
  memberId: string | null
  firstName: string
  test: boolean
  pieces: DressingRoomPiece[]
  error?: string
}

export interface StyledLook {
  look_id: string | null
  image_url: string | null
  items: LookItem[]
  why: string
}

export interface OwnedPieceView extends DressingRoomView {
  piece: DressingRoomPiece | null
  styled: StyledLook[]
  /** "Find skirts to go with it" — types in her library that complete this piece. */
  finders: { itemType: string; label: string; count: number }[]
  occasions: { id: string; label: string }[]
}

// The piece types that complete an outfit around each kind of piece.
const FINDER_TYPES: Partial<Record<Slot, string[]>> = {
  top: ['skirt', 'trousers', 'jeans', 'shorts'],
  bottom: ['shirt', 'blouse', 'knitwear', 't-shirt'],
  outerwear: ['skirt', 'trousers', 'jeans', 'midi_dress', 'maxi_dress'],
  dress: ['sneaker', 'flat', 'boot', 'sandal'],
  shoe: ['skirt', 'trousers', 'jeans'],
}
const FINDER_LABEL: Record<string, string> = {
  skirt: 'skirts', trousers: 'trousers', jeans: 'jeans', shorts: 'shorts',
  shirt: 'shirts', blouse: 'blouses', knitwear: 'knitwear', 't-shirt': 'T-shirts',
  midi_dress: 'midi dresses', maxi_dress: 'maxi dresses',
  sneaker: 'trainers', flat: 'flats', boot: 'boots', sandal: 'sandals',
}
const STYLE_THIS_LOOKS = 3
const WHY_DIMS = 'item_id, item_type, colour_family, product_name, fit, leg_opening, length, structure, neckline, sleeve, rise, shoulder, waist_definition, pattern'

function toPiece(it: ItemWithBrand, styled: Map<string, number>): DressingRoomPiece {
  const a = it as any
  return {
    item_id: it.item_id,
    product_name: it.product_name,
    item_type: (it.item_type as string) ?? null,
    slot: it.item_type ? slotForItemType(it.item_type) : null,
    image_url: it.image_url ?? null,
    colour_family: a.colour_family ?? null,
    styled_in: styled.get(it.item_id) ?? 0,
  }
}

async function memberLooksFor(admin: any, memberId: string, test: boolean): Promise<any[]> {
  const { data } = await admin.from('pilot_look')
    .select('look_id, image_url, items, visible_to_client, delivery:delivery_id!inner(member_id)')
    .eq('delivery.member_id', memberId)
  return ((data ?? []) as any[]).filter((l) => test || l.visible_to_client)
}

export async function loadDressingRoom(asMemberId?: string): Promise<DressingRoomView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { memberId: null, firstName: '', test: false, pieces: [] }
  const base = { memberId: me.memberId, firstName: firstNameOf(me.name), test: me.test }
  try {
    const admin = createAdminClient() as any
    const [pieces, looks] = await Promise.all([
      listOwnedItems(ownerRefsForMember({ member_id: me.memberId, auth_user_id: me.authUserId })),
      memberLooksFor(admin, me.memberId, me.test),
    ])
    const styled = styledInCounts(looks)
    return { ...base, pieces: pieces.map((p) => toPiece(p, styled)) }
  } catch (err) {
    return { ...base, pieces: [], error: err instanceof Error ? err.message : 'Could not load your wardrobe' }
  }
}

/**
 * The looks she already has that use one of her pieces — free and instant: her
 * own looks, no library, no composing. The Dressing Room shows these the moment
 * she taps a piece; building NEW outfits is a separate, deliberate press.
 */
export async function looksWithOwnedPiece(itemId: string, asMemberId?: string): Promise<{ looks: StyledLook[]; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { looks: [], error: 'Not signed in' }
  try {
    const admin = createAdminClient() as any
    const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', me.memberId).single()
    const looks = await memberLooksFor(admin, me.memberId, me.test)
    const using = looks.filter((l) => ((l.items ?? []) as any[]).some((i) => i.item_id === itemId))
    if (!using.length) return { looks: [] }
    const ids = Array.from(new Set(using.flatMap((l) => (l.items ?? []).map((i: any) => i.item_id)).filter(Boolean)))
    const { data: rows } = ids.length ? await admin.from('item').select(WHY_DIMS).in('item_id', ids) : { data: [] }
    const dims = new Map<string, any>(((rows ?? []) as any[]).map((r) => [r.item_id, r]))
    const prefs = readStylePrefs(member)
    return {
      looks: using.map((l) => ({
        look_id: l.look_id,
        image_url: l.image_url ?? null,
        items: l.items ?? [],
        why: whyThisSuitsHer((l.items ?? []).map((it: any) => ({ ...(dims.get(it.item_id) ?? {}), product_name: it.product_name, owned: !!it.owned })), prefs),
      })),
    }
  } catch (err) {
    return { looks: [], error: err instanceof Error ? err.message : 'Could not load its looks' }
  }
}

export async function loadOwnedPiece(itemId: string, asMemberId?: string): Promise<OwnedPieceView> {
  const empty: OwnedPieceView = { memberId: null, firstName: '', test: false, pieces: [], piece: null, styled: [], finders: [], occasions: [] }
  const me = await resolveClientMember(asMemberId)
  if (!me) return empty
  const base = { ...empty, memberId: me.memberId, firstName: firstNameOf(me.name), test: me.test }
  try {
    const admin = createAdminClient() as any
    const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', me.memberId).single()
    const [owned, looks, library] = await Promise.all([
      listOwnedItems(ownerRefsForMember({ member_id: me.memberId, auth_user_id: me.authUserId })),
      memberLooksFor(admin, me.memberId, me.test),
      loadComposableLibrary(member),
    ])
    const hero = owned.find((p) => p.item_id === itemId)
    if (!hero) return { ...base, error: 'That piece is not in your wardrobe' }
    const styled = styledInCounts(looks)
    const prefs = readStylePrefs(member)

    // How it has been styled: her looks that use it, each with its reason.
    const using = looks.filter((l) => ((l.items ?? []) as any[]).some((i) => i.item_id === itemId))
    const ids = Array.from(new Set(using.flatMap((l) => (l.items ?? []).map((i: any) => i.item_id)).filter(Boolean)))
    const { data: rows } = ids.length ? await admin.from('item').select(WHY_DIMS).in('item_id', ids) : { data: [] }
    const dims = new Map<string, any>(((rows ?? []) as any[]).map((r) => [r.item_id, r]))
    const styledLooks: StyledLook[] = using.map((l) => ({
      look_id: l.look_id,
      image_url: l.image_url ?? null,
      items: l.items ?? [],
      why: whyThisSuitsHer((l.items ?? []).map((it: any) => ({ ...(dims.get(it.item_id) ?? {}), product_name: it.product_name, owned: !!it.owned })), prefs),
    }))

    const slot = hero.item_type ? slotForItemType(hero.item_type) : null
    const avoided = new Set(prefs.types_avoided)
    const finders = (slot ? FINDER_TYPES[slot] ?? [] : [])
      .filter((t) => !avoided.has(t))
      .map((t) => ({ itemType: t, label: FINDER_LABEL[t] ?? t, count: library.filter((i) => i.item_type === t && !isOwnedItem(i as any)).length }))
      .filter((f) => f.count >= 2)
    const occasions = occasionsForMember(member?.occasions)
      .map((id) => CLIENT_OCCASIONS.find((o) => o.id === id))
      .filter((o): o is (typeof CLIENT_OCCASIONS)[number] => !!o)
      .map((o) => ({ id: o.id as string, label: o.label as string }))

    return { ...base, piece: toPiece(hero, styled), styled: styledLooks, finders, occasions }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : 'Could not load this piece' }
  }
}

/**
 * STYLE THIS — outfits built around one of her own pieces, for an occasion or
 * with a kind of piece ("find skirts to go with this top"). The same composer
 * and look check as a delivery; looks that clash or hold a piece not in her
 * size are never shown. Nothing is saved.
 */
export async function styleOwnedPiece(
  itemId: string,
  opts: { occasion?: string | null; withType?: string | null; shuffle?: number; query?: string | null } = {},
  asMemberId?: string,
): Promise<{ looks: StyledLook[]; hidden?: number; error?: string; read?: string | null }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { looks: [], error: 'Not signed in' }
  try {
    const admin = createAdminClient() as any
    const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', me.memberId).single()
    const library = await loadComposableLibrary(member)
    const hero = library.find((i) => i.item_id === itemId && isOwnedItem(i as any))
    if (!hero) return { looks: [], error: 'That piece is not in your wardrobe' }

    let pool = library
    // "Find a white shirt to go with this skirt" — her words, read onto the
    // taxonomy. Only the slots she named are narrowed; the rest stay open.
    let read: string | null = null
    if (opts.query && opts.query.trim()) {
      const { parseQuery } = await import('@/lib/search-taxonomy')
      const q = parseQuery(opts.query)
      const types = new Set(q.itemTypes)
      const colours = new Set(q.colourFamilies)
      if (types.size || colours.size) {
        const wantSlots = new Set(Array.from(types).map((t) => slotForItemType(t as any)))
        pool = library.filter((i) => {
          if (i.item_id === itemId) return true
          const slot = slotForItemType(i.item_type)
          if (types.size && wantSlots.has(slot) && !types.has(i.item_type)) return false
          // A colour she names applies to the piece she asked for, not the whole look.
          if (colours.size && types.size && types.has(i.item_type) && !colours.has(String(i.colour_family))) return false
          if (colours.size && !types.size && !colours.has(String(i.colour_family)) && !isOwnedItem(i as any)) return false
          return true
        })
        read = [Array.from(colours).join('/'), Array.from(types).map((t) => String(t).replace(/_/g, ' ')).join(', ')].filter(Boolean).join(' ')
        const named = Array.from(types)[0]
        if (named && pool.filter((i) => i.item_type === named && i.item_id !== itemId).length < 2) {
          return { looks: [], error: `MYRA has no ${read || named} in your size to put with it right now` }
        }
      }
    }
    if (opts.withType) {
      // Only that kind of piece in its place: a top styled with skirts keeps
      // every other slot open but offers no trousers or jeans.
      const want = opts.withType
      const wantSlot = slotForItemType(want as any)
      pool = library.filter((i) => i.item_id === itemId || slotForItemType(i.item_type) !== wantSlot || i.item_type === want)
      if (pool.filter((i) => i.item_type === want && i.item_id !== itemId).length < 2) {
        return { looks: [], error: `Not enough ${FINDER_LABEL[want] ?? want} in your size right now` }
      }
    }

    const [taste, lens, history] = await Promise.all([
      loadMemberTaste(admin, member),
      loadPersonaLens(admin, me.memberId),
      loadComposeHistory(admin, me.memberId),
    ])
    let occ: OccasionContext | undefined
    if (opts.occasion) {
      const mix = normalise(effectiveWeights(member.room_weights, opts.occasion as any, member.work_dress_code))
      occ = { id: opts.occasion as any, vector: lookTasteVector(mix), climate: null }
    }

    const composed = composeMemberVariants(taste, pool, itemId, STYLE_THIS_LOOKS + 2, occ, lens, history, { ownedMode: 'blend', shuffle: opts.shuffle ?? 0 })
    if (!composed.length) return { looks: [], error: 'Nothing goes with this piece in your size right now' }
    const judged = await judgeLooksForMember(admin, me.memberId, composed, 'unknown')
    const rank = (i: number) => (judged[i].check?.verdict === 'works' ? 0 : judged[i].check ? 1 : 2)
    const passing = composed.map((_, i) => i)
      .filter((i) => judged[i].check?.verdict !== 'clashes' && !hasPieceOutOfSize(judged[i]))
      .sort((a, b) => rank(a) - rank(b) || a - b)
    const dims = new Map<string, any>(library.map((i) => [i.item_id, i]))
    const prefs = readStylePrefs(member)
    return {
      hidden: composed.length - passing.length,
      read,
      looks: passing.slice(0, STYLE_THIS_LOOKS).map((i) => ({
        look_id: null,
        image_url: null,
        items: composed[i].items,
        why: whyThisSuitsHer(composed[i].items.map((it) => ({ ...(dims.get(it.item_id ?? '') ?? {}), product_name: it.product_name, owned: !!it.owned })), prefs),
      })),
      ...(passing.length ? {} : { error: 'Nothing passed the check for this piece right now — try another occasion' }),
    }
  } catch (err) {
    return { looks: [], error: err instanceof Error ? err.message : 'Could not style this piece' }
  }
}
