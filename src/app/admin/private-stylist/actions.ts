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
} from '@/lib/pilot-stylist'
import { accumulate, zeroVector } from '@/lib/taste-vector'

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
  created_at: string
  // Σ signal_weight × look vector across her taste events — the 34-dim view
  taste_vector: number[] | null
  taste_event_counts: Record<PilotTasteEventType, number>
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
  members: PilotMember[]
  deliveries: PilotDelivery[]
  activity: PilotActivity[]
  artefacts: Record<string, ExitArtefact>
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
    return { ready: false, missingMigration: '0029', members: [], deliveries: [], activity: [], artefacts: {} }
  }
  if (tasteRes.error) {
    return { ready: false, missingMigration: '0030', members: [], deliveries: [], activity: [], artefacts: {} }
  }

  const events = (eventsRes.data ?? []) as any[]
  const wardrobe = (wardrobeRes.data ?? []) as any[]
  const snapshots = (snapshotsRes.data ?? []) as any[]
  const looks = (looksRes.data ?? []) as any[]
  const tasteEvents = (tasteRes.data ?? []) as any[]

  const members: PilotMember[] = ((membersRes.data ?? []) as any[]).map((m) => {
    const mine = tasteEvents.filter((t) => t.member_id === m.member_id)
    const counts = { yes: 0, no: 0, save: 0, click_out: 0, purchase: 0 } as Record<PilotTasteEventType, number>
    for (const t of mine) if (t.event_type in counts) counts[t.event_type as PilotTasteEventType]++
    return {
      ...m,
      taste_vector: m.taste_vector ?? null,
      taste_event_counts: counts,
      events: events.filter((e) => e.member_id === m.member_id),
      wardrobe: wardrobe.filter((w) => w.member_id === m.member_id),
      snapshots: snapshots.filter((s) => s.member_id === m.member_id),
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

  return { ready: true, missingMigration: null, members, deliveries, activity, artefacts }
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
  }>,
): Promise<{ error?: string }> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('pilot_member' as any)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('member_id', memberId)
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
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
  }
  revalidatePath(PATH)
  return {}
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
