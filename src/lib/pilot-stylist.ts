// ── PRIVATE STYLIST pilot — domain model ────────────────────────────────────
// One house, three rooms. A member is never assigned to a room — she has a
// weighting across all three, and the occasion tilts that weighting the way a
// human stylist would. Work occasions can clamp the weighting toward tailored
// via a formality floor that OVERRIDES taste.
//
//   effective_weights(user, occasion) =
//     normalise( user.room_weights × occasion_tilt[occasion]
//              , clamped by formality_floor if work )
//
// Everything here is deterministic and runs anywhere — no model call, no DB.

import { cosine, zeroVector, VECTOR_DIM } from './taste-vector'

export type RoomKey = 'tailored' | 'romantic' | 'ease'
export type RoomWeights = Record<RoomKey, number>

export const ROOM_KEYS: RoomKey[] = ['tailored', 'romantic', 'ease']

export const ROOMS: Record<RoomKey, { label: string; axis: string; palette: string[] }> = {
  tailored: {
    label: 'TAILORED',
    axis: 'Structure, restraint, sharp line',
    palette: ['ME+EM', 'Massimo Dutti', 'Adolfo Domínguez'],
  },
  romantic: {
    label: 'ROMANTIC',
    axis: 'Print, drape, vintage inflection',
    palette: ['Reformation', 'Dōen', 'Sézane', 'Sessùn'],
  },
  ease: {
    label: 'EASE',
    axis: 'Elevated casual, relaxed proportion',
    palette: ['J.Crew', 'Madewell', 'Bellerose', 'Munthe'],
  },
}

// ── Occasion picker (§4a) — fixed enum, free text destroys the maths ────────

export const OCCASION_TYPES = [
  { id: 'work_standard', label: 'WORK — NORMAL DAY' },
  { id: 'work_elevated', label: 'WORK — CLIENT / PRESENTING / VISIBLE' },
  { id: 'casual_day', label: 'DAYTIME CASUAL' },
  { id: 'dinner_drinks', label: 'DINNERS & DRINKS' },
  { id: 'event', label: 'OCCASIONS & EVENTS' },
  { id: 'travel', label: 'TRIPS' },
] as const

export type OccasionId = (typeof OCCASION_TYPES)[number]['id']

export const FREQUENCY_OPTIONS = ['never', '1-2 / month', 'weekly', 'most days'] as const
export type Frequency = (typeof FREQUENCY_OPTIONS)[number]

export const WORK_DRESS_CODES = [
  { id: 'suited_corporate', label: 'SUITED CORPORATE' },
  { id: 'smart_unwritten', label: 'SMART BUT UNWRITTEN RULES' },
  { id: 'creative', label: 'CREATIVE / ANYTHING GOES' },
] as const

export type WorkDressCode = (typeof WORK_DRESS_CODES)[number]['id']

export const WORK_OCCASIONS: OccasionId[] = ['work_standard', 'work_elevated']

// ── Occasion tilts — how each occasion bends the member's weighting ─────────

export const OCCASION_TILT: Record<OccasionId, RoomWeights> = {
  work_standard: { tailored: 1.5, romantic: 0.55, ease: 1.0 },
  work_elevated: { tailored: 1.9, romantic: 0.45, ease: 0.7 },
  casual_day: { tailored: 0.6, romantic: 0.9, ease: 1.6 },
  dinner_drinks: { tailored: 1.0, romantic: 1.4, ease: 0.75 },
  event: { tailored: 0.95, romantic: 1.7, ease: 0.5 },
  travel: { tailored: 0.7, romantic: 1.1, ease: 1.5 },
}

// Formality floor: minimum tailored share on WORK occasions, by dress code.
// "Smart but unwritten" is where MYRA adds most value — implicit rules,
// socially expensive to get slightly wrong — so it still clamps hard.
export const FORMALITY_FLOOR: Record<WorkDressCode, number> = {
  suited_corporate: 0.65,
  smart_unwritten: 0.5,
  creative: 0,
}

export function normalise(w: RoomWeights): RoomWeights {
  const sum = ROOM_KEYS.reduce((a, k) => a + Math.max(0, w[k] ?? 0), 0)
  if (sum <= 0) return { tailored: 1 / 3, romantic: 1 / 3, ease: 1 / 3 }
  return {
    tailored: Math.max(0, w.tailored ?? 0) / sum,
    romantic: Math.max(0, w.romantic ?? 0) / sum,
    ease: Math.max(0, w.ease ?? 0) / sum,
  }
}

export function effectiveWeights(
  roomWeights: RoomWeights,
  occasion: OccasionId,
  workDressCode: WorkDressCode | null,
): RoomWeights {
  const tilt = OCCASION_TILT[occasion]
  let w = normalise({
    tailored: (roomWeights.tailored ?? 0) * tilt.tailored,
    romantic: (roomWeights.romantic ?? 0) * tilt.romantic,
    ease: (roomWeights.ease ?? 0) * tilt.ease,
  })
  // Formality floor overrides taste on work occasions
  if (WORK_OCCASIONS.includes(occasion) && workDressCode) {
    const floor = FORMALITY_FLOOR[workDressCode]
    if (w.tailored < floor) {
      const rest = w.romantic + w.ease
      const scale = rest > 0 ? (1 - floor) / rest : 0
      w = {
        tailored: floor,
        romantic: w.romantic * scale,
        ease: rest > 0 ? w.ease * scale : 1 - floor,
      }
    }
  }
  return w
}

// "70% TAILORED / 30% EASE" — rooms under 5% are dropped from the label
export function formatRoomMix(w: RoomWeights): string {
  const parts = ROOM_KEYS.map((k) => ({ k, pct: Math.round((w[k] ?? 0) * 100) }))
    .filter((p) => p.pct >= 5)
    .sort((a, b) => b.pct - a.pct)
  return parts.map((p) => `${p.pct}% ${ROOMS[p.k].label}`).join(' / ')
}

// ── Brands → initial room weighting ─────────────────────────────────────────

// Where each pilot-universe brand sits across the rooms (sums to 1 per brand).
// Keyed on a normalised name — see normaliseBrand().
export const BRAND_ROOMS: Record<string, RoomWeights> = {
  'me+em': { tailored: 0.7, romantic: 0.05, ease: 0.25 },
  'massimo dutti': { tailored: 0.6, romantic: 0.1, ease: 0.3 },
  'adolfo dominguez': { tailored: 0.65, romantic: 0.1, ease: 0.25 },
  reformation: { tailored: 0.1, romantic: 0.7, ease: 0.2 },
  doen: { tailored: 0.05, romantic: 0.85, ease: 0.1 },
  sezane: { tailored: 0.15, romantic: 0.6, ease: 0.25 },
  sessun: { tailored: 0.15, romantic: 0.55, ease: 0.3 },
  'j.crew': { tailored: 0.25, romantic: 0.15, ease: 0.6 },
  madewell: { tailored: 0.1, romantic: 0.2, ease: 0.7 },
  bellerose: { tailored: 0.15, romantic: 0.25, ease: 0.6 },
  munthe: { tailored: 0.2, romantic: 0.35, ease: 0.45 },
  baukjen: { tailored: 0.4, romantic: 0.15, ease: 0.45 },
}

// Fast fashion: valid as taste signal and wardrobe, NEVER as recommendation.
export const FAST_FASHION = [
  'zara', 'h&m', 'mango', 'shein', 'primark', 'asos', 'boohoo',
  'bershka', 'stradivarius', 'pull & bear', 'pull&bear',
]

export function normaliseBrand(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/jcrew/, 'j.crew')
    .trim()
}

export function isFastFashion(brand: string): boolean {
  return FAST_FASHION.includes(normaliseBrand(brand))
}

export interface RankedBrand {
  name: string
  rank: number
  inferred_why?: string
}

// Linear rank decay: with n brands, rank 1 weighs n, rank n weighs 1.
// Unknown brands contribute nothing (they still carry signal for later —
// they just can't place the member in room space yet). Input-only brands
// (Zara etc.) are excluded here by the caller.
export function roomWeightsFromBrands(brands: RankedBrand[]): RoomWeights {
  const sorted = [...brands].sort((a, b) => a.rank - b.rank)
  const n = sorted.length
  const acc: RoomWeights = { tailored: 0, romantic: 0, ease: 0 }
  sorted.forEach((b, idx) => {
    const rooms = BRAND_ROOMS[normaliseBrand(b.name)]
    if (!rooms) return
    const w = n - idx
    acc.tailored += rooms.tailored * w
    acc.romantic += rooms.romantic * w
    acc.ease += rooms.ease * w
  })
  return normalise(acc)
}

// ── Response enum (log the enum, not prose) ─────────────────────────────────

export const RESPONSE_REASONS = [
  { id: 'not_my_style', label: 'NOT MY STYLE' },
  { id: 'wrong_occasion', label: 'WRONG OCCASION' },
  { id: 'too_expensive', label: 'TOO EXPENSIVE' },
  { id: 'owned_similar', label: 'OWN SOMETHING SIMILAR' },
  { id: 'fit_concern', label: 'FIT CONCERN' },
  { id: 'colour', label: 'COLOUR' },
  { id: 'other', label: 'OTHER' },
] as const

export type ResponseReason = (typeof RESPONSE_REASONS)[number]['id']

// ── Taste signals ───────────────────────────────────────────────────────────
// Same hierarchy as the main app: money moves taste hardest, a save next, a
// yes is a like, a no pulls gently away. Every one of these writes a
// pilot_taste_event and feeds BOTH the room weighting and the 34-dim vector.

export const PILOT_SIGNAL_WEIGHTS = {
  purchase: 7,
  save: 5,
  click_out: 4,
  yes: 3,
  no: -2,
} as const

export type PilotTasteEventType = keyof typeof PILOT_SIGNAL_WEIGHTS

export interface PilotTasteEventInput {
  event_type: PilotTasteEventType
  signal_weight: number
  room_mix: RoomWeights
  taste_vector?: number[] | null
}

// ── Recompute (room weights) ────────────────────────────────────────────────
// Deterministic from history: start at intake weights, replay every taste
// event in order. Positive signals pull toward the look's room mix, negative
// push away, step size scaled by signal weight (a purchase moves taste ~2.3×
// a yes). Clamped so no room ever dies — the convergence guard.

const BASE_LEARNING_RATE = 0.04 // per unit of signal weight: yes(3) → 0.12
const MAX_STEP = 0.3
const MIN_ROOM_WEIGHT = 0.02

export function replayEvents(intake: RoomWeights, events: PilotTasteEventInput[]): RoomWeights {
  let w = normalise(intake)
  for (const e of events) {
    const mix = normalise(e.room_mix)
    const lr = Math.max(-MAX_STEP, Math.min(MAX_STEP, BASE_LEARNING_RATE * e.signal_weight))
    w = normalise({
      tailored: Math.max(MIN_ROOM_WEIGHT, w.tailored + lr * mix.tailored),
      romantic: Math.max(MIN_ROOM_WEIGHT, w.romantic + lr * mix.romantic),
      ease: Math.max(MIN_ROOM_WEIGHT, w.ease + lr * mix.ease),
    })
  }
  return w
}

// ── Room centroids in the 34-dim taste space ────────────────────────────────
// Each room is a centroid in the same vector space the main app uses (see
// taste-vector.ts for the dimension order). Values are on the n5 [0,1] scale.
// A look's vector is the room-mix-weighted blend of the centroids — free and
// deterministic at pilot scale; a hand-scored or library-linked vector can
// replace it later without changing anything downstream.
//
// Dimension order: outerwear c/v/w/f · top c/v/w/f · bottom c/v/rise/leg/w ·
// shoe form/style · bag form · jewellery scale/form · outfit colour/surface/
// intent/construction/volume · occasion form/plan/priority/time · brand
// price/aesthetic/era · detail colour-depth/sheen/pattern/waist.
// NB construction runs 1=tailored → 5=relaxed, so TAILORED scores LOW there.

export const ROOM_CENTROIDS: Record<RoomKey, number[]> = {
  tailored: [
    0.15, 0.35, 0.6, 0.7, // outerwear: crisp, close, substantial cloth, formal
    0.25, 0.3, 0.45, 0.65, // top
    0.2, 0.4, 0.75, 0.5, 0.55, // bottom: sharp, high rise, straight
    0.7, 0.55, // shoe: formal, considered
    0.7, // bag
    0.3, 0.55, // jewellery: delicate, versatile-formal
    0.2, 0.2, 0.45, 0.2, 0.35, // outfit: neutral, clean, sharp construction
    0.65, 0.55, 0.55, 0.45, // occasion: leans formal, planned
    0.55, 0.3, 0.55, // brand: premium, restrained, modern-classic
    0.25, 0.3, 0.1, 0.35, // detail: tonal neutral, matte, no pattern, defined waist
  ],
  romantic: [
    0.65, 0.55, 0.35, 0.5, // outerwear: soft, light
    0.7, 0.55, 0.3, 0.5, // top: draped, fluid
    0.7, 0.6, 0.65, 0.7, 0.35, // bottom: soft, flowing leg
    0.5, 0.5, // shoe
    0.5, // bag
    0.5, 0.5, // jewellery: considered, vintage-leaning
    0.55, 0.65, 0.6, 0.7, 0.55, // outfit: colour and texture do the talking
    0.5, 0.5, 0.6, 0.5, // occasion
    0.5, 0.65, 0.6, // brand: expressive, vintage-inflected
    0.55, 0.45, 0.7, 0.45, // detail: muted colour, print-led
  ],
  ease: [
    0.6, 0.65, 0.5, 0.3, // outerwear: relaxed, casual
    0.6, 0.65, 0.4, 0.3, // top
    0.6, 0.65, 0.6, 0.6, 0.5, // bottom: relaxed proportion
    0.25, 0.25, // shoe: flat, casual
    0.35, // bag
    0.35, 0.3, // jewellery: everyday
    0.35, 0.45, 0.3, 0.6, 0.65, // outfit: quiet, loose
    0.25, 0.3, 0.3, 0.3, // occasion: casual, comfort-led
    0.4, 0.45, 0.4, // brand
    0.4, 0.2, 0.35, 0.7, // detail: easy colour, matte, relaxed waist
  ],
}

// A look's 34-dim vector: room-mix-weighted blend of the centroids.
export function lookTasteVector(roomMix: RoomWeights): number[] {
  const mix = normalise(roomMix)
  const v = zeroVector()
  for (const k of ROOM_KEYS) {
    const c = ROOM_CENTROIDS[k]
    for (let i = 0; i < VECTOR_DIM; i++) v[i] += mix[k] * c[i]
  }
  return v
}

// Read a member's accumulated vector back as room affinities — an INDEPENDENT
// check on the room weights: two learning paths (weights from replayed events,
// vector from weighted accumulation) that should broadly agree. If they
// diverge, one of them is wrong about her.
export function vectorRoomRead(vector: number[] | null | undefined): RoomWeights | null {
  if (!vector || vector.length !== VECTOR_DIM || vector.every((x) => x === 0)) return null
  const sims: RoomWeights = {
    tailored: Math.max(0, cosine(vector, ROOM_CENTROIDS.tailored)),
    romantic: Math.max(0, cosine(vector, ROOM_CENTROIDS.romantic)),
    ease: Math.max(0, cosine(vector, ROOM_CENTROIDS.ease)),
  }
  // Centroids share a lot of space (all are plausible outfits), so raw cosines
  // cluster high — spread them by softmax so differences read on a bar.
  const exp = ROOM_KEYS.map((k) => Math.exp(sims[k] * 12))
  const sum = exp.reduce((a, b) => a + b, 0)
  return { tailored: exp[0] / sum, romantic: exp[1] / sum, ease: exp[2] / sum }
}

// ── Data coverage — is the pilot generating enough signal? ──────────────────
// Four weeks × weekly delivery × 3 looks ≈ 12 responded looks; clicks and at
// least one purchase are the metrics that matter (§3b hierarchy). These
// thresholds are what "enough data" means for the exit artefact.

export interface CoverageCheck {
  label: string
  have: number
  target: number
}

export function coverageChecks(counts: {
  respondedLooks: number
  tasteEvents: number
  clicks: number
  saves: number
  purchases: number
  weeklySnapshots: number
}): CoverageCheck[] {
  return [
    { label: 'RESPONDED LOOKS', have: counts.respondedLooks, target: 12 },
    { label: 'TASTE EVENTS', have: counts.tasteEvents, target: 16 },
    { label: 'CLICK-OUTS', have: counts.clicks, target: 4 },
    { label: 'SAVES', have: counts.saves, target: 3 },
    { label: 'PURCHASES', have: counts.purchases, target: 1 },
    { label: 'WEEKLY RECOMPUTES', have: counts.weeklySnapshots, target: 4 },
  ]
}

// ── Delivery validation — the non-negotiables per delivery ──────────────────

export interface LookItem {
  brand: string
  product_name: string
  price_gbp?: number | null
  url?: string
  owned: boolean
  size?: string
  in_stock?: boolean
  stock_checked_at?: string | null
  // set on composed looks — lets review swaps track library items and lets a
  // look build its own Higgsfield shoot without an outfit
  item_id?: string | null
  brand_id?: string | null
  image_url?: string | null
  slot?: string | null
  item_type?: string | null
  material_primary?: string | null
}

export interface LookForValidation {
  room_mix: RoomWeights
  items: LookItem[]
}

export function validateDelivery(
  looks: LookForValidation[],
  memberBrandNames: string[],
  opts?: { calibration?: boolean },
): string[] {
  const errors: string[] = []
  if (looks.length < 3) errors.push(`ONLY ${looks.length} LOOK${looks.length === 1 ? '' : 'S'} — A DELIVERY IS 3`)

  // Calibration sets are taste probes, not shoppable deliveries: only the
  // 3-looks and room-mix rules apply. No stock promise, no owned anchor, no
  // new-brand slot — and fast fashion may appear as a probe (shown, not sold).
  if (opts?.calibration) {
    looks.forEach((look, i) => {
      const mixSum = ROOM_KEYS.reduce((a, k) => a + (look.room_mix?.[k] ?? 0), 0)
      if (mixSum <= 0) errors.push(`LOOK ${i + 1}: NO ROOM MIX — EVERY OUTFIT NAMES ITS MIX`)
    })
    return errors
  }

  const named = new Set(memberBrandNames.map(normaliseBrand))
  let hasOwnedAnchor = false
  let hasNewBrand = false

  looks.forEach((look, i) => {
    const mixSum = ROOM_KEYS.reduce((a, k) => a + (look.room_mix?.[k] ?? 0), 0)
    if (mixSum <= 0) errors.push(`LOOK ${i + 1}: NO ROOM MIX — EVERY OUTFIT NAMES ITS MIX`)
    if (look.items.length === 0) errors.push(`LOOK ${i + 1}: NO ITEMS`)
    if (look.items.some((it) => it.owned)) hasOwnedAnchor = true
    for (const it of look.items) {
      if (!it.owned) {
        if (isFastFashion(it.brand)) {
          errors.push(`LOOK ${i + 1}: ${it.brand.toUpperCase()} RECOMMENDED — FAST FASHION IS INPUT, NEVER OUTPUT`)
        } else if (!named.has(normaliseBrand(it.brand))) {
          hasNewBrand = true
        }
        if (!it.stock_checked_at) {
          errors.push(`LOOK ${i + 1}: ${it.brand.toUpperCase()} ${it.product_name.toUpperCase()} — STOCK NOT CHECKED AT SEND`)
        } else if (it.in_stock === false) {
          errors.push(`LOOK ${i + 1}: ${it.brand.toUpperCase()} ${it.product_name.toUpperCase()} — OUT OF STOCK`)
        }
      }
    }
  })

  if (!hasOwnedAnchor) errors.push('NO LOOK ANCHORED ON AN ITEM SHE OWNS — AT LEAST 1 REQUIRED')
  if (!hasNewBrand) errors.push('NO LOOK INTRODUCES A BRAND SHE DIDN’T NAME — AT LEAST 1 REQUIRED')
  return errors
}

// ── Calibration sets — taste onboarding, one look per room ──────────────────
// 3 looks spread across the three rooms, ordered by her current weighting:
// dominant room first (should land — confirms the read), weakest room last
// (the informative probe — a like HERE moves the weighting most). Each look
// carries brand hints: her own brands that live in that room, plus room-
// palette brands she didn't name.

export interface CalibrationLook {
  position: number
  room_mix: RoomWeights
  note: string
}

export function calibrationPlan(brands: RankedBrand[], weights: RoomWeights): CalibrationLook[] {
  const order = [...ROOM_KEYS].sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0))
  return order.map((room, idx) => {
    // Probe mix: 70% the probed room; the rest split by her overall ordering
    const rest = order.filter((k) => k !== room)
    const mix = { tailored: 0, romantic: 0, ease: 0 } as RoomWeights
    mix[room] = 0.7
    mix[rest[0]] = 0.2
    mix[rest[1]] = 0.1

    const hers = brands
      .filter((b) => {
        const r = BRAND_ROOMS[normaliseBrand(b.name)]
        if (!r) return false
        const dominant = ROOM_KEYS.reduce((best, k) => (r[k] > r[best] ? k : best), 'tailored' as RoomKey)
        return dominant === room
      })
      .map((b) => b.name)
    const named = new Set(brands.map((b) => normaliseBrand(b.name)))
    const discover = ROOMS[room].palette.filter((p) => !named.has(normaliseBrand(p)))

    const parts = [
      `${ROOMS[room].label} PROBE${idx === order.length - 1 ? ' — WEAKEST ROOM, MOST INFORMATIVE' : idx === 0 ? ' — HER HOME ROOM, SHOULD LAND' : ''}`,
      hers.length ? `HER BRANDS: ${hers.join(' · ').toUpperCase()}` : 'NONE OF HER BRANDS LIVE HERE',
      discover.length ? `ALSO TRY: ${discover.join(' · ').toUpperCase()}` : '',
    ].filter(Boolean)
    return { position: idx + 1, room_mix: mix, note: parts.join(' — ') }
  })
}

// ── Dry-run mode (§4b) — synthetic personas + script ────────────────────────
// Synthetic responses are YOUR guesses about their taste, not their taste.
// Everything flagged is_synthetic is excluded from real members' recomputes
// and any future training data. Kept for calibration: guessed weights vs real
// intake measures your own read on your users.

export interface SynthPersona {
  name: string
  brands: RankedBrand[]
  brands_input_only: string[]
  room_weights: RoomWeights
  occasions: Record<OccasionId, Frequency>
  work_dress_code: WorkDressCode | null
  known_events: { label: string; event_date: string }[]
  wardrobe: { label: string; brand: string; item_type: string }[]
  notes: string
}

export const SYNTH_PERSONAS: SynthPersona[] = [
  {
    name: 'DEVIKA (SYNTH)',
    brands: [
      { name: 'Reformation', rank: 1, inferred_why: 'American-romantic femininity, print-led' },
      { name: 'Dōen', rank: 2, inferred_why: 'Full romantic — drape, prairie inflection' },
      { name: 'Sézane', rank: 3, inferred_why: 'Parisian romantic with polish' },
      { name: 'J.Crew', rank: 4, inferred_why: 'Elevated-casual base layer' },
      { name: 'Madewell', rank: 5, inferred_why: 'Weekend ease' },
      { name: 'Massimo Dutti', rank: 6, inferred_why: 'The tailored edge of her taste' },
    ],
    brands_input_only: ['Zara'],
    room_weights: { tailored: 0.2, romantic: 0.55, ease: 0.25 },
    occasions: {
      work_standard: 'most days',
      work_elevated: '1-2 / month',
      casual_day: 'weekly',
      dinner_drinks: 'weekly',
      event: '1-2 / month',
      travel: '1-2 / month',
    },
    work_dress_code: 'smart_unwritten',
    known_events: [{ label: 'Greece holiday', event_date: '2026-09' }],
    wardrobe: [
      { label: 'Reformation floral midi dress', brand: 'Reformation', item_type: 'midi_dress' },
      { label: 'Zara black straight trousers', brand: 'Zara', item_type: 'trousers' },
      { label: 'J.Crew navy blazer', brand: 'J.Crew', item_type: 'blazer' },
    ],
    notes:
      'Banking — formality floor must clamp the romantic weighting Mon–Fri. ' +
      'If a work brief returns a Dōen prairie dress, the clamp is broken.',
  },
  {
    name: 'MUM (SYNTH)',
    brands: [
      { name: 'Massimo Dutti', rank: 1, inferred_why: 'Euro-tailored entry point' },
      { name: 'Adolfo Domínguez', rank: 2, inferred_why: 'Structure with softness' },
      { name: 'Sessùn', rank: 3, inferred_why: 'Pulls her toward romantic' },
      { name: 'Munthe', rank: 4, inferred_why: 'Print without fuss' },
      { name: 'Bellerose', rank: 5, inferred_why: 'Relaxed proportion, quality basics' },
      { name: 'Baukjen', rank: 6, inferred_why: 'Considered everyday' },
      { name: 'ME+EM', rank: 7, inferred_why: 'Sharp line, restraint' },
    ],
    brands_input_only: ['Zara'],
    room_weights: { tailored: 0.55, romantic: 0.15, ease: 0.3 },
    occasions: {
      work_standard: 'never',
      work_elevated: 'never',
      casual_day: 'most days',
      dinner_drinks: '1-2 / month',
      event: '1-2 / month',
      travel: '1-2 / month',
    },
    work_dress_code: null,
    known_events: [],
    wardrobe: [
      { label: 'Zara wide-leg trousers', brand: 'Zara', item_type: 'trousers' },
      { label: 'ME+EM merino knit', brand: 'ME+EM', item_type: 'knitwear' },
      { label: 'Sessùn cropped jacket', brand: 'Sessùn', item_type: 'jacket' },
    ],
    notes:
      'No work rows at all — the reason the occasion picker exists. Identical taste ' +
      'vectors with different occasion profiles need different wardrobes.',
  },
]

export interface DryRunBrief {
  id: string
  persona: string // matches SynthPersona.name
  brief: string
  occasion: OccasionId
  tests: string
}

export const DRY_RUN_SCRIPT: DryRunBrief[] = [
  {
    id: 'greece',
    persona: 'DEVIKA (SYNTH)',
    brief: 'Outfits for a Greece holiday',
    occasion: 'travel',
    tests: 'Event-driven, travel tilt — this is the anticipation move rehearsal.',
  },
  {
    id: 'work_week',
    persona: 'DEVIKA (SYNTH)',
    brief: 'What do I wear to work this week',
    occasion: 'work_standard',
    tests: 'Formality floor must clamp the romantic weighting. A Dōen prairie dress = broken clamp.',
  },
  {
    id: 'dinner_devika',
    persona: 'DEVIKA (SYNTH)',
    brief: 'Dinner on Saturday',
    occasion: 'dinner_drinks',
    tests: 'CORE TEST — same brief goes to both personas; outputs must differ visibly.',
  },
  {
    id: 'dinner_mum',
    persona: 'MUM (SYNTH)',
    brief: 'Dinner on Saturday',
    occasion: 'dinner_drinks',
    tests: 'CORE TEST — same brief as Devika; if the outfits are interchangeable, room weighting is not working.',
  },
  {
    id: 'casual_mum',
    persona: 'MUM (SYNTH)',
    brief: 'Casual weekend',
    occasion: 'casual_day',
    tests: 'Ease-dominant tilt.',
  },
  {
    id: 'zara_anchor',
    persona: 'MUM (SYNTH)',
    brief: 'Style around my Zara wide-leg trousers',
    occasion: 'casual_day',
    tests: 'Input-not-output rule: the Zara item IS in the outfit (owned), no Zara recommendation alongside.',
  },
]

export const DRY_RUN_PASS_CRITERIA = [
  'EVERY OUTFIT NAMES ITS ROOM MIX (E.G. 70% TAILORED / 30% EASE)',
  'THE TWO PERSONAS NEVER RECEIVE INTERCHANGEABLE OUTFITS FOR THE SAME BRIEF',
  'WORK BRIEFS RESPECT THE FORMALITY FLOOR',
  'EVERY RECOMMENDED ITEM IS FROM THE VETTED BRAND LIST — NEVER FAST FASHION',
  'AT LEAST ONE LOOK PER DELIVERY INTRODUCES AN UNNAMED BRAND',
  'AT LEAST ONE LOOK PER DELIVERY IS ANCHORED ON AN ITEM SHE OWNS',
]
