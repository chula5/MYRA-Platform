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
import { applyBrandSignals, seedUserAffinities } from '@/lib/brand-affinity'
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
  type StylePrefs,
} from '@/lib/pilot-stylist'
import { accumulate, zeroVector } from '@/lib/taste-vector'
import { getAllItems, type ItemWithBrand } from '@/lib/admin-queries'
import {
  composeMemberLooks,
  rankAlternates,
  toLookItem,
  type MemberTaste,
  type OccasionContext,
  type PersonaLens,
} from '@/lib/pilot-composer'
import { personaWeight, PERSONA_START_WEIGHT } from '@/lib/user-persona'
import { slotForItemType, type Slot } from '@/lib/composer'
import {
  HIGGSFIELD_COMBOS,
  buildGenerationPrompt,
  buildReferenceUrls,
  type ShootItem,
} from '@/lib/higgsfield-shoot'
import { runHiggsfieldGeneration } from '@/app/admin/projects/higgsfield-actions'

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
  created_at: string
  // Σ signal_weight × look vector across her taste events — the 34-dim view
  taste_vector: number[] | null
  taste_event_counts: Record<PilotTasteEventType, number>
  // Soft persona assignment — the lens her looks are composed through.
  persona_id: string | null
  persona_name: string | null
  persona_weight: number | null
  persona_has_envelope: boolean
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
    return { ready: false, missingMigration: '0029', stylePrefsReady: false, members: [], deliveries: [], activity: [], artefacts: {}, personas: [] }
  }
  if (tasteRes.error) {
    return { ready: false, missingMigration: '0030', stylePrefsReady: false, members: [], deliveries: [], activity: [], artefacts: {}, personas: [] }
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

  const members: PilotMember[] = ((membersRes.data ?? []) as any[]).map((m) => {
    const mine = tasteEvents.filter((t) => t.member_id === m.member_id)
    const counts = { yes: 0, no: 0, save: 0, click_out: 0, purchase: 0 } as Record<PilotTasteEventType, number>
    for (const t of mine) if (t.event_type in counts) counts[t.event_type as PilotTasteEventType]++
    return {
      ...m,
      ...readStylePrefs(m),
      taste_vector: m.taste_vector ?? null,
      taste_event_counts: counts,
      events: events.filter((e) => e.member_id === m.member_id),
      wardrobe: wardrobe.filter((w) => w.member_id === m.member_id),
      snapshots: snapshots.filter((s) => s.member_id === m.member_id),
      persona_id: assignByMember.get(m.member_id)?.persona_id ?? null,
      persona_name: personaById.get(assignByMember.get(m.member_id)?.persona_id)?.name ?? null,
      persona_weight: assignByMember.get(m.member_id)?.weight ?? null,
      persona_has_envelope: personaById.get(assignByMember.get(m.member_id)?.persona_id)?.hasEnvelope ?? false,
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

  return { ready: true, missingMigration: null, stylePrefsReady, members, personas, deliveries, activity, artefacts }
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
    return { error: `${error.message} — RUN MIGRATION 0045_pilot_style_preferences.sql IN SUPABASE` }
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
  const { data, error } = await admin
    .from('pilot_delivery' as any)
    .insert({
      member_id: input.member_id,
      trigger: input.trigger,
      request_text: input.request_text,
      occasion: input.occasion,
      effective_weights: weights,
      is_synthetic: m.is_synthetic,
      dry_run_brief: input.dry_run_brief ?? null,
    })
    .select('delivery_id')
    .single()
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
  const { error } = await admin
    .from('pilot_delivery' as any)
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('delivery_id', deliveryId)
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
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

async function loadComposableLibrary(): Promise<ItemWithBrand[]> {
  const [ready, live] = await Promise.all([getAllItems('ready'), getAllItems('live')])
  return [...ready, ...live]
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

export async function composeDeliveryLooks(deliveryId: string): Promise<{ created?: number; error?: string }> {
  const admin = createAdminClient() as any
  const { data: delivery, error: derr } = await admin.from('pilot_delivery').select('*').eq('delivery_id', deliveryId).single()
  if (derr || !delivery) return { error: derr?.message ?? 'Delivery not found' }
  if (delivery.status !== 'draft') return { error: 'Only draft deliveries can be composed into' }
  const { data: member, error: merr } = await admin.from('pilot_member').select('*').eq('member_id', delivery.member_id).single()
  if (merr || !member) return { error: merr?.message ?? 'Member not found' }

  const taste = await loadMemberTaste(admin, member)
  const library = await loadComposableLibrary()
  const mix = normalise(delivery.effective_weights ?? {})
  const occ: OccasionContext = { id: delivery.occasion ?? null, vector: lookTasteVector(mix) }
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

  const looks = composeMemberLooks(taste, library, 3, occ, lens, { seenCounts, rejected })
  if (!looks.length) return { error: 'Could not compose — not enough compatible in-stock items in the library' }

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
  return { created: rows.length }
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
  const { data: delivery } = await admin.from('pilot_delivery').select('member_id, occasion, effective_weights').eq('delivery_id', look.delivery_id).single()
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', delivery?.member_id).single()
  if (!member) return { error: 'Member not found' }

  const slot = (target.slot as Slot | null) ?? null
  if (!slot) return { error: 'This item was added by hand — edit the look instead' }

  const taste = await loadMemberTaste(admin, member)
  const library = await loadComposableLibrary()
  const keepIds = items.filter((it, i) => i !== itemIndex && it.item_id).map((it) => it.item_id as string)
  const keepItems = library.filter((i) => keepIds.includes(i.item_id))
  const exclude = new Set(items.filter((it) => it.item_id).map((it) => it.item_id as string))

  const occ: OccasionContext = { id: delivery?.occasion ?? null, vector: lookTasteVector(normalise(delivery?.effective_weights ?? {})) }
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
  const { data: delivery } = await admin.from('pilot_delivery').select('member_id, occasion, effective_weights').eq('delivery_id', look.delivery_id).single()
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', delivery?.member_id).single()
  if (!member) return { error: 'Member not found' }

  const taste = await loadMemberTaste(admin, member)
  const library = await loadComposableLibrary()
  const keepIds = items.filter((it) => it.item_id).map((it) => it.item_id as string)
  const keepItems = library.filter((i) => keepIds.includes(i.item_id))
  const exclude = new Set(keepIds)
  const occ: OccasionContext = { id: delivery?.occasion ?? null, vector: lookTasteVector(normalise(delivery?.effective_weights ?? {})) }

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

  const shootItems: ShootItem[] = items
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
  const gen = await runHiggsfieldGeneration(prompt, refs, `pilot-look-${lookId}-${Date.now()}`)
  if (!gen.imageUrl) return gen

  // Append to history rather than replacing — the previous shoot stays reachable.
  const history: any[] = Array.isArray(look.shoot_history) ? look.shoot_history : []
  if (!history.some((h) => h?.url === gen.imageUrl)) {
    history.push({ url: gen.imageUrl, pose: poseKey, created_at: new Date().toISOString() })
  }
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
