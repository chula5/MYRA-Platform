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
  items: PreDecisionItem[]
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
