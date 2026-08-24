'use server'

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
  rankAlternates,
  toLookItem,
  DEFAULT_OWNED_TARGET_SHARE,
  type ComposeOptions,
  type MemberTaste,
  type OccasionContext,
  type PersonaLens,
} from '@/lib/pilot-composer'
import { listOwnedItems, looksUsingItems } from '@/lib/wardrobe/store'
import { ownerRefsForMember } from '@/lib/wardrobe/owned-items'
import { checkRenderFidelity } from '@/app/admin/ai/render-fidelity'
import { loadMemberSizeProfile, filterItemsForShopper } from '@/lib/size-availability'
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
import { readTrust, trustHeadline, type LookOutcome, type TrustRead } from '@/lib/member-trust'
import { explainTraits } from '@/lib/member-traits'
import { type ClimateId } from '@/lib/climate'

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

export async function deleteLook(lookId: string) {
  const admin = createAdminClient()
  const { error } = await admin.from('pilot_look' as any).delete().eq('look_id', lookId)
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}

/**
 * Clear a look AND everything it taught.
 *
 * Deleting a look leaves its decisions behind: the feedback rows survive with
 * a null look_id and keep feeding the trait model, so a composition she threw
 * away still shapes the next one. When a look is simply wrong — the wrong
 * brief, the wrong weather, a mistake — none of the fiddling that went into it
 * is a taste signal, and it should leave no trace.
 *
 * Deliberately separate from deleteLook: "remove this look, keep what I
 * learned" and "pretend this never happened" are different intentions and the
 * second one cannot be undone.
 */
export async function clearLook(lookId: string): Promise<{ cleared?: number; error?: string }> {
  const admin = createAdminClient() as any
  try {
    const { count: decisions } = await admin
      .from('pilot_look_feedback').select('feedback_id', { count: 'exact', head: true }).eq('look_id', lookId)
    // Order matters: the feedback and taste rows are ON DELETE SET NULL, so
    // dropping the look first would orphan them beyond reach.
    await admin.from('pilot_look_feedback').delete().eq('look_id', lookId)
    await admin.from('pilot_taste_event').delete().eq('look_id', lookId)
    await admin.from('pilot_activity').delete().eq('look_id', lookId).eq('type', 'note')
    const { error } = await admin.from('pilot_look').delete().eq('look_id', lookId)
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { cleared: decisions ?? 0 }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not clear the look' }
  }
}

/** Every look in a delivery, cleared the same way. */
export async function clearDeliveryLooks(deliveryId: string): Promise<{ looks?: number; cleared?: number; error?: string }> {
  const admin = createAdminClient() as any
  try {
    const { data: looks } = await admin.from('pilot_look').select('look_id').eq('delivery_id', deliveryId)
    const ids = (looks ?? []).map((l: any) => l.look_id)
    if (!ids.length) return { looks: 0, cleared: 0 }
    const { count: decisions } = await admin
      .from('pilot_look_feedback').select('feedback_id', { count: 'exact', head: true }).in('look_id', ids)
    await admin.from('pilot_look_feedback').delete().in('look_id', ids)
    await admin.from('pilot_taste_event').delete().in('look_id', ids)
    await admin.from('pilot_activity').delete().in('look_id', ids).eq('type', 'note')
    const { error } = await admin.from('pilot_look').delete().in('look_id', ids)
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { looks: ids.length, cleared: decisions ?? 0 }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not clear the looks' }
  }
}

// Stamp every buyable item in the delivery as stock-checked now.
// "Stock checked 10am, moves fast."
export async function markStockChecked(deliveryId: string): Promise<{ error?: string }> {
  const admin = createAdminClient()
  const { data: looks, error } = await admin
    .from('pilot_look' as any)
    .select('look_id, items')
    .eq('delivery_id', deliveryId)
  if (error) return { error: error.message }
  const now = new Date().toISOString()
  for (const l of (looks ?? []) as any[]) {
    const items = (l.items as LookItem[]).map((it) =>
      it.owned ? it : { ...it, stock_checked_at: now, in_stock: it.in_stock !== false },
    )
    await admin.from('pilot_look' as any).update({ items }).eq('look_id', l.look_id)
  }
  revalidatePath(PATH)
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
    .select('delivery_id')
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
    const { error: fbErr } = await admin.from('pilot_look_feedback').insert(fb)
    if (fbErr) return { error: fbErr.message }
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
  const ids = new Set<string>()
  for (const r of rows) {
    if ((r.action === 'swap' || r.action === 'remove') && r.item_out) ids.add(r.item_out)
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
    const isOut = (r.action === 'swap' || r.action === 'remove') && r.item_out
    const id = isOut ? r.item_out : (r.action === 'accept' ? r.item_in : null)
    if (!id) continue
    const item = items.get(id)
    if (item) decisions.push({ item, kept: !isOut })
  }
  return decisions.length ? buildTraitModel(decisions) : undefined
}

async function loadMemberTaste(admin: any, member: { member_id: string; brands: RankedBrand[]; brands_input_only: string[] } & Partial<StylePrefs>): Promise<MemberTaste> {
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
async function loadComposableLibrary(member?: { member_id: string; auth_user_id?: string | null } | null): Promise<ItemWithBrand[]> {
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
async function loadPersonaLens(admin: any, memberId: string): Promise<PersonaLens | undefined> {
  const { data: assignment } = await admin
    .from('user_persona').select('persona_id, weight').eq('user_id', memberId).maybeSingle()
  if (!assignment?.persona_id) return undefined
  const { data: persona } = await admin
    .from('stylist').select('name, envelope').eq('stylist_id', assignment.persona_id).maybeSingle()
  const env = persona?.envelope
  if (!env?.mean?.length) return undefined
  return {
    name: persona?.name ?? null,
    envelope: { mean: env.mean, spread: env.spread ?? [] },
    weight: typeof assignment.weight === 'number' ? assignment.weight : PERSONA_START_WEIGHT,
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

export async function composeDeliveryLooks(deliveryId: string, options: ComposeDeliveryOptions = {}): Promise<{ created?: number; ownedLooks?: number; error?: string }> {
  const admin = createAdminClient() as any
  const { data: delivery, error: derr } = await admin.from('pilot_delivery').select('*').eq('delivery_id', deliveryId).single()
  if (derr || !delivery) return { error: derr?.message ?? 'Delivery not found' }
  if (delivery.status !== 'draft') return { error: 'Only draft deliveries can be composed into' }
  const { data: member, error: merr } = await admin.from('pilot_member').select('*').eq('member_id', delivery.member_id).single()
  if (merr || !member) return { error: merr?.message ?? 'Member not found' }

  const taste = await loadMemberTaste(admin, member)
  const library = await loadComposableLibrary(member)
  const mix = normalise(delivery.effective_weights ?? {})
  const occ: OccasionContext = { id: delivery.occasion ?? null, vector: lookTasteVector(mix), climate: delivery.climate ?? null }
  const lens = await loadPersonaLens(admin, delivery.member_id)

  // Her look history: everything already composed for her (any delivery) plus
  // her explicit rejections — the composer ranks those down so each delivery
  // explores the library instead of regenerating the same argmax looks.
  const [{ data: priorLooks }, { data: fb }] = await Promise.all([
    admin.from('pilot_look').select('items, delivery:delivery_id!inner(member_id)').eq('delivery.member_id', delivery.member_id),
    admin.from('pilot_look_feedback').select('item_in, action').eq('member_id', delivery.member_id).limit(5000),
  ])
  const seenCounts = new Map<string, number>()
  for (const l of priorLooks ?? []) {
    for (const it of (l.items ?? []) as any[]) {
      if (it.item_id) seenCounts.set(it.item_id, (seenCounts.get(it.item_id) ?? 0) + 1)
    }
  }
  const rejected = new Set<string>()
  for (const f of fb ?? []) {
    if (f.item_in && f.action === 'remove') rejected.add(f.item_in)
    if (f.item_in && f.action === 'accept') seenCounts.set(f.item_in, (seenCounts.get(f.item_in) ?? 0) + 1)
  }

  const lookCount = Math.max(1, Math.min(6, options.count ?? 3))
  const looks = composeMemberLooks(taste, library, lookCount, occ, lens, { seenCounts, rejected }, {
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
  return { created: rows.length, ownedLooks: looks.filter((l) => l.ownedCount > 0).length }
}

export interface SwapOption {
  item_id: string
  product_name: string
  brand_name: string | null
  colour_family: string | null
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
    action: 'accept',
    slot: incoming.slot ?? null,
    item_in: incoming.item_id ?? null,
    brand_in: incoming.brand_id ?? null,
  }]
  if (incoming.brand_id) {
    for (const other of items) {
      if (other === incoming || !other.brand_id || other.brand_id === incoming.brand_id) continue
      const [a, b] = pairKeyOrdered(incoming.brand_id, other.brand_id)
      fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'accept', brand_out: a, brand_in: b })
    }
  }
  await admin.from('pilot_look_feedback').insert(fb)

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
    action: 'swap',
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
      fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'swap', brand_out: a, brand_in: b })
    }
  }
  await admin.from('pilot_look_feedback').insert(fb)

  // Brand affinity learning (member-scoped, shared machinery with the feed).
  try {
    if (outgoing.brand) await applyBrandSignals(admin, delivery.member_id, [outgoing.brand], 'no')
    if (incoming.brand) await applyBrandSignals(admin, delivery.member_id, [incoming.brand], 'yes')
  } catch { /* affinity nudge is best-effort */ }

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
    action: 'remove',
    slot: outgoing.slot ?? null,
    item_out: outgoing.item_id ?? null,
    brand_out: outgoing.brand_id ?? null,
  }]
  if (outgoing.brand_id) {
    for (const other of items) {
      if (!other.brand_id || other.brand_id === outgoing.brand_id) continue
      const [a, b] = pairKeyOrdered(outgoing.brand_id, other.brand_id)
      fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'remove', brand_out: a, brand_in: b })
    }
  }
  await admin.from('pilot_look_feedback').insert(fb)

  try {
    if (outgoing.brand) await applyBrandSignals(admin, delivery.member_id, [outgoing.brand], 'no')
  } catch { /* best-effort */ }

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
    if (it.item_id) fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'accept', slot: it.slot ?? null, item_in: it.item_id, brand_in: it.brand_id ?? null })
  }
  const brandIds = Array.from(new Set(items.map((it) => it.brand_id).filter(Boolean))) as string[]
  for (let i = 0; i < brandIds.length; i++) {
    for (let j = i + 1; j < brandIds.length; j++) {
      const [a, b] = pairKeyOrdered(brandIds[i], brandIds[j])
      fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'accept', brand_out: a, brand_in: b })
    }
  }
  if (fb.length) await admin.from('pilot_look_feedback').insert(fb)

  try {
    const brandNames = Array.from(new Set(items.map((it) => it.brand).filter(Boolean)))
    if (brandNames.length) await applyBrandSignals(admin, delivery.member_id, brandNames, 'yes')
  } catch { /* best-effort */ }

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
    if (it.item_id) fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'remove', slot: it.slot ?? null, item_in: it.item_id, brand_in: it.brand_id ?? null })
  }
  const brandIds = Array.from(new Set(items.map((it) => it.brand_id).filter(Boolean))) as string[]
  for (let i = 0; i < brandIds.length; i++) {
    for (let j = i + 1; j < brandIds.length; j++) {
      const [a, b] = pairKeyOrdered(brandIds[i], brandIds[j])
      fb.push({ member_id: delivery.member_id, delivery_id: look.delivery_id, look_id: lookId, action: 'remove', brand_out: a, brand_in: b })
    }
  }
  if (fb.length) {
    const { error: fbErr } = await admin.from('pilot_look_feedback').insert(fb)
    if (fbErr) return { error: fbErr.message }
  }

  try {
    const brandNames = Array.from(new Set(items.map((it) => it.brand).filter(Boolean)))
    if (brandNames.length) await applyBrandSignals(admin, delivery.member_id, brandNames, 'no')
  } catch { /* best-effort */ }

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
export async function higgsfieldShootForLook(lookId: string, poseKey = 'E5'): Promise<{ imageUrl?: string; error?: string }> {
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
    if (!first.passed && !first.error) {
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
  revalidatePath(PATH)
  return gen
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

export interface MemberTrust extends TrustRead {
  headline: string
  /** What her decisions have taught the composer, in plain language. */
  learned: string[]
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
      return { ...empty, headline: trustHeadline(empty), learned: [] }
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

    return { ...trust, headline: trustHeadline(trust), learned }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not read trust' }
  }
}
