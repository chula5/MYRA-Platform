// Pre-decision review read model — machine verdict absent, not merely hidden.
//
// Before an authorized human decision is persisted, the queue/read model may
// disclose THAT a subjective machine check exists, but must omit the verdict,
// score, reasons, rationale, agreement, and raw-response hash entirely. These
// protected fields are removed from the server response and browser payload —
// never relying on CSS, disabled controls, client filtering, or hidden props.
//
// The full exact-version result may be disclosed only after a human decision
// has persisted; that disclosure path belongs to the review workbench and is
// gated on the persisted decision.

export interface RawSubjectiveCheck {
  check_id: string
  kind: 'subjective'
  status: 'passed' | 'failed' | 'unavailable' | 'error'
  verdict?: string | null
  score?: number | null
  issues?: unknown
  reasons?: unknown
  model?: string | null
  prompt_version?: string | null
  raw_response_hash?: string | null
}

export interface PreDecisionItem {
  candidate_item_id: string
  item_id: string
  slot: string
  sort_order: number
  source_image_url: string
  item_snapshot: Record<string, unknown>
}

export interface PreDecisionCandidate {
  candidate_version_id: string
  case_id: string
  version_no: number
  state: string
  rules_only: boolean
  context_type: 'real_member' | 'evaluation_profile'
  selected_stylist_id: string
  /** Disclosed: that a machine subjective check exists — never its content. */
  has_subjective_check: boolean
  /**
   * Why an objective gate stopped this look, in words ("SIZE UNCONFIRMED ·
   * Sézane, Antik Batik"). Objective checks are deterministic structure /
   * size / stock gates, not taste — nothing here is a machine verdict.
   */
  objective_failures: string[]
  items: PreDecisionItem[]
}

/** A non-passing objective check, as stored (`issues` renamed to `detail` so it never reads as a verdict). */
export interface RawObjectiveCheck {
  check_name: string
  status: 'passed' | 'failed' | 'unavailable' | 'error'
  detail?: unknown
}

const OBJECTIVE_LABELS: Record<string, { failed: string; unavailable: string }> = {
  size_possibility: { failed: 'NOT IN HER SIZE', unavailable: 'SIZE UNCONFIRMED' },
  sellable_stock: { failed: 'NOT SELLABLE', unavailable: 'STOCK UNKNOWN' },
  source_images: { failed: 'NO IMAGE', unavailable: 'IMAGE UNCONFIRMED' },
  required_item_data: { failed: 'MISSING ITEM DATA', unavailable: 'ITEM DATA UNCONFIRMED' },
  valid_structure: { failed: 'INCOMPLETE LOOK', unavailable: 'STRUCTURE UNCONFIRMED' },
  no_duplicate_membership: { failed: 'DUPLICATE PIECE', unavailable: 'MEMBERSHIP UNCONFIRMED' },
}

function namesOf(ids: unknown, items: PreDecisionItem[]): string {
  if (!Array.isArray(ids) || ids.length === 0) return ''
  const byId = new Map(items.map((i) => [i.item_id, i]))
  const names = ids.map((id) => {
    const it = byId.get(String(id))
    const brand = it ? String(it.item_snapshot?.brand ?? '') : ''
    return brand || (it ? it.slot : '')
  }).filter(Boolean)
  return Array.from(new Set(names)).join(', ')
}

/**
 * One line per non-passing objective check, naming the pieces (by brand) that
 * caused it, so the card says "SIZE UNCONFIRMED · Sézane" instead of a bare
 * OBJECTIVE_FAILED.
 */
export function objectiveFailureLines(checks: RawObjectiveCheck[], items: PreDecisionItem[]): string[] {
  const lines: string[] = []
  for (const c of checks) {
    if (c.status === 'passed') continue
    const d = (c.detail ?? {}) as Record<string, unknown>
    const labels = OBJECTIVE_LABELS[c.check_name]
    const base = labels
      ? (c.status === 'failed' ? labels.failed : labels.unavailable)
      : `${c.check_name.replace(/_/g, ' ').toUpperCase()} ${c.status.toUpperCase()}`
    const parts: string[] = []
    if (c.check_name === 'size_possibility') {
      if (c.status === 'failed') parts.push(namesOf(d.not_in_size, items))
      else parts.push(namesOf(d.unconfirmed, items))
    } else if (c.check_name === 'sellable_stock') {
      parts.push(namesOf(c.status === 'failed' ? d.not_sellable : d.unknown, items))
    } else if (c.check_name === 'source_images') {
      parts.push(namesOf(d.missing_image_item_ids, items))
    } else if (c.check_name === 'required_item_data') {
      const rows = Array.isArray(d.items) ? (d.items as { item_id?: string }[]) : []
      parts.push(namesOf(rows.map((r) => r.item_id), items))
    } else if (c.check_name === 'valid_structure') {
      if (Array.isArray(d.missing_slots)) parts.push(`missing ${(d.missing_slots as string[]).join(', ')}`)
      else if (d.reason) parts.push(String(d.reason).replace(/_/g, ' '))
    } else if (c.check_name === 'no_duplicate_membership') {
      if (Array.isArray(d.duplicate_item_ids)) parts.push(namesOf(d.duplicate_item_ids, items))
      if (Array.isArray(d.overfull_slots)) parts.push(`two in ${(d.overfull_slots as string[]).join(', ')}`)
    }
    if (c.status === 'error') parts.push('check errored')
    const tail = parts.filter(Boolean).join(' · ')
    lines.push(tail ? `${base} · ${tail}` : base)
  }
  return lines
}

/** The subjective-check fields that must never appear before a human decision. */
export const PROTECTED_SUBJECTIVE_FIELDS = [
  'verdict',
  'score',
  'issues',
  'reasons',
  'rationale',
  'agreement',
  'raw_response_hash',
  'model',
  'prompt_version',
] as const

export interface BuildPreDecisionInput {
  candidate_version_id: string
  case_id: string
  version_no: number
  state: string
  rules_only: boolean
  real_member_id: string | null
  evaluation_profile_id: string | null
  selected_stylist_id: string
  subjectiveChecks: RawSubjectiveCheck[]
  /** Non-passing objective checks, if the caller loaded them. */
  objectiveChecks?: RawObjectiveCheck[]
  items: PreDecisionItem[]
}

/**
 * Build the pre-decision payload. The subjective check collapses to a single
 * boolean `has_subjective_check`; no protected field is carried through. The
 * returned object is the exact shape sent to the browser.
 */
export function buildPreDecisionCandidate(input: BuildPreDecisionInput): PreDecisionCandidate {
  return {
    candidate_version_id: input.candidate_version_id,
    case_id: input.case_id,
    version_no: input.version_no,
    state: input.state,
    rules_only: input.rules_only,
    context_type: input.real_member_id ? 'real_member' : 'evaluation_profile',
    selected_stylist_id: input.selected_stylist_id,
    has_subjective_check: input.subjectiveChecks.length > 0,
    objective_failures: objectiveFailureLines(input.objectiveChecks ?? [], input.items),
    items: input.items
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({
        candidate_item_id: i.candidate_item_id,
        item_id: i.item_id,
        slot: i.slot,
        sort_order: i.sort_order,
        source_image_url: i.source_image_url,
        item_snapshot: i.item_snapshot,
      })),
  }
}

/**
 * A defence-in-depth guard: assert that a serialised pre-decision payload
 * carries none of the protected subjective fields at any depth. Returns the
 * offending paths (empty when clean). Used by tests and server guards.
 */
export function findProtectedLeaks(payload: unknown, path = '$'): string[] {
  const leaks: string[] = []
  const protectedSet = new Set<string>(PROTECTED_SUBJECTIVE_FIELDS)
  const walk = (value: unknown, p: string) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${p}[${i}]`))
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (protectedSet.has(k)) leaks.push(`${p}.${k}`)
        walk(v, `${p}.${k}`)
      }
    }
  }
  walk(payload, path)
  return leaks
}
