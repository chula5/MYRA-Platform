// Pure render policy for the Outfit Quality Lab render queue.
//
// Everything here is side-effect free: the worker, the gallery store, and the
// tests all share these rules so the retry budget, cycle bound, override
// taxonomy, and error bounding can never drift between entry points.
//
// Frozen-manifest rule: a render consumes ONLY the approved candidate
// version's persisted `outfit_quality_candidate_item` rows. This module's
// builders are pure projections of those rows — they never reach back to
// mutable `item`, `outfit`, stylist, inspiration, or envelope tables.

// ── Bounds ────────────────────────────────────────────────────────────────────

/** A render cycle is the initial attempt plus at most one corrective retry. */
export const MAX_ATTEMPTS_PER_CYCLE = 2

/** Explicit human regeneration creates a new cycle; cycles are bounded. */
export const MAX_RENDER_CYCLES = 3

/** A claimed job whose lease is older than this is recoverable. */
export const LEASE_TTL_MS = 15 * 60_000

/** The required Higgsfield model — the only model the Quality Lab submits. */
export const QUALITY_RENDER_MODEL = 'seedream_v4_5'

/** Cloudinary folder for durable Quality Lab render assets. */
export const QUALITY_RENDER_FOLDER = 'quality-lab-renders'

// ── Frozen manifest ───────────────────────────────────────────────────────────

export interface FrozenManifestItem {
  candidate_item_id: string
  item_id: string
  slot: string
  sort_order: number
  /** Display/check label derived from the frozen item snapshot. */
  label: string
  product_name: string | null
  item_type: string | null
  brand_name: string | null
  material_primary: string | null
  source_image_url: string
  source_image_asset_version: string | null
  source_image_hash: string | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

/** The fidelity/prompt label for one frozen item, from its snapshot only. */
export function frozenLabel(snapshot: Record<string, unknown>, slot: string): string {
  const brand = str(snapshot.brand) ?? str(snapshot.brand_name)
  const name = str(snapshot.product_name) ?? str(snapshot.name)
  const type = str(snapshot.item_type) ?? slot
  return [brand, name ?? type].filter(Boolean).join(' — ') || slot
}

/**
 * Project persisted candidate_item rows into the ordered frozen manifest the
 * renderer and fidelity checker consume. Ordering is stable: sort_order, then
 * candidate_item_id as a deterministic tiebreak.
 */
export function buildFrozenManifest(rows: any[]): FrozenManifestItem[] {
  return rows
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.candidate_item_id).localeCompare(String(b.candidate_item_id)))
    .map((r) => {
      const snap = (r.item_snapshot ?? {}) as Record<string, unknown>
      return {
        candidate_item_id: r.candidate_item_id,
        item_id: r.item_id,
        slot: r.slot,
        sort_order: r.sort_order ?? 0,
        label: frozenLabel(snap, r.slot),
        product_name: str(snap.product_name) ?? str(snap.name),
        item_type: str(snap.item_type),
        brand_name: str(snap.brand) ?? str(snap.brand_name),
        material_primary: str(snap.material_primary),
        source_image_url: r.source_image_url ?? '',
        source_image_asset_version: r.source_image_asset_version ?? null,
        source_image_hash: r.source_image_hash ?? null,
      }
    })
}

/** A renderable manifest has at least one item and a frozen source image on every item. */
export function manifestComplete(items: FrozenManifestItem[]): boolean {
  return items.length > 0 && items.every((i) => typeof i.source_image_url === 'string' && i.source_image_url.length > 0)
}

// ── Fidelity outcome policy ───────────────────────────────────────────────────

export type FidelityOutcome = 'passed' | 'failed' | 'unavailable' | 'error'

export type FidelityAction =
  | { action: 'ready' }
  | { action: 'retry'; correctiveNotes: string }
  | { action: 'attention'; reason: string }

/**
 * The retry budget, exactly:
 *  - pass → ready;
 *  - a conclusive FIRST failure with recorded corrective evidence → one retry;
 *  - a first failure without corrective evidence → attention (no blind retry);
 *  - a second failure → attention (no attempt 3 exists);
 *  - unavailable/error → attention, fail closed, never an automatic retry.
 */
export function planFidelityAction(args: { attemptNo: number; outcome: FidelityOutcome; correctiveNotes: string | null }): FidelityAction {
  const { attemptNo, outcome, correctiveNotes } = args
  if (outcome === 'passed') return { action: 'ready' }
  if (outcome === 'unavailable') return { action: 'attention', reason: 'fidelity check unavailable — fail closed' }
  if (outcome === 'error') return { action: 'attention', reason: 'fidelity check error — fail closed' }
  // outcome === 'failed'
  if (attemptNo === 1 && correctiveNotes && correctiveNotes.trim()) {
    return { action: 'retry', correctiveNotes: correctiveNotes.trim() }
  }
  if (attemptNo === 1) return { action: 'attention', reason: 'first fidelity failure recorded no corrective evidence' }
  return { action: 'attention', reason: 'second conclusive fidelity failure' }
}

const MAX_CORRECTIVE_NOTES = 500

/** The attempt-2 prompt: the frozen base prompt plus bounded corrective notes. */
export function deriveCorrectivePrompt(basePrompt: string, correctiveNotes: string): string {
  const notes = correctiveNotes.trim().slice(0, MAX_CORRECTIVE_NOTES)
  return `${basePrompt} CORRECTIONS FROM THE PREVIOUS ATTEMPT (apply exactly): ${notes}`
}

// ── Regeneration cycles ───────────────────────────────────────────────────────

/**
 * Plan the next explicit regeneration cycle from the cycle numbers already
 * persisted for this approval. Bounded: at most MAX_RENDER_CYCLES cycles ever.
 */
export function planNextCycle(existingCycleNumbers: number[]): { ok: true; cycleNo: number } | { ok: false; code: 'cycle_limit' } {
  const max = existingCycleNumbers.length ? Math.max(...existingCycleNumbers) : 0
  const next = max + 1
  if (next > MAX_RENDER_CYCLES) return { ok: false, code: 'cycle_limit' }
  return { ok: true, cycleNo: next }
}

// ── Image overrides ───────────────────────────────────────────────────────────

export const OVERRIDE_REASONS = ['image_fidelity', 'image_quality', 'underlying_outfit'] as const
export type OverrideReason = (typeof OVERRIDE_REASONS)[number]

export function isOverrideReason(value: unknown): value is OverrideReason {
  return typeof value === 'string' && (OVERRIDE_REASONS as readonly string[]).includes(value)
}

// ── Error bounding ────────────────────────────────────────────────────────────

const MAX_ERROR = 300

/**
 * Bound an error message for persistence and redact any known sentinel values
 * (credentials, tokens) the caller passes. Adapter errors must never carry
 * secret material; this is the last line of defence before a message is stored
 * or shown.
 */
export function boundError(message: unknown, redact: string[] = []): string {
  let text = typeof message === 'string' ? message : message instanceof Error ? message.message : String(message ?? 'unknown error')
  for (const secret of redact) {
    if (secret) text = text.split(secret).join('[redacted]')
  }
  return text.slice(0, MAX_ERROR)
}
