// The STRICT render-fidelity adapter for the Outfit Quality Lab.
//
// The legacy `checkRenderFidelity` was written for a pipeline where a skipped
// check was acceptable: missing credentials, an unfetchable render, a
// malformed model response, or an exception all come back as `passed: true`
// with an `error` note. The Quality Lab cannot inherit that: a check that did
// not conclude is not evidence. This adapter reinterprets every one of those
// outcomes as `unavailable` or `error` so the worker can fail closed.
//
// Outcomes are explicit and exhaustive:
//   passed      — the checker ran cleanly and passed every frozen source item
//   failed      — the checker ran cleanly and found conclusive infidelity
//   unavailable — configuration/transport prevented any conclusion
//   error       — the checker or its response was malformed or threw
//
// `unavailable` and `error` are never passes, never produce readiness, and
// never justify an automatic corrective retry (there is no corrective
// evidence to act on).

import 'server-only'
import { checkRenderFidelity, type FidelityResult, type FidelityIssue } from '@/app/admin/ai/render-fidelity'
import { boundError, type FidelityOutcome } from '@/lib/outfit-quality/render-domain'

/** The checker model, recorded on every fidelity machine_check row. */
export const FIDELITY_MODEL = 'claude-opus-4-6'

export interface StrictFidelityResult {
  status: FidelityOutcome
  score: number | null
  issues: FidelityIssue[]
  correctiveNotes: string | null
  /** Bounded, redacted detail for unavailable/error outcomes. */
  detail: string | null
  model: string
}

export interface StrictFidelityDeps {
  /** Injectable for deterministic tests; defaults to the legacy checker. */
  rawCheck?: (renderUrl: string, items: { label: string; image_url: string }[]) => Promise<FidelityResult>
  /** Defaults to whether ANTHROPIC_API_KEY is configured. */
  apiKeyPresent?: boolean
}

/** Values that must never survive into a stored detail string. */
function redactionList(): string[] {
  return [process.env.ANTHROPIC_API_KEY ?? ''].filter(Boolean)
}

/** Transport/configuration failures are `unavailable`; malformed output is `error`. */
function classifyCheckerError(message: string): 'unavailable' | 'error' {
  if (/not configured|could not fetch|no response|timed out|timeout|network|econn|enotfound|503|502/i.test(message)) return 'unavailable'
  return 'error'
}

export async function checkQualityRenderFidelity(
  renderUrl: string,
  items: { label: string; image_url: string }[],
  deps: StrictFidelityDeps = {},
): Promise<StrictFidelityResult> {
  const base = { score: null, issues: [] as FidelityIssue[], correctiveNotes: null, model: FIDELITY_MODEL }

  // Missing frozen source images fail closed BEFORE the checker is consulted.
  if (!renderUrl || items.length === 0 || items.some((i) => !i.image_url)) {
    return { ...base, status: 'error', detail: 'missing frozen source image or render URL — cannot check fidelity' }
  }

  const apiKeyPresent = deps.apiKeyPresent ?? !!process.env.ANTHROPIC_API_KEY
  if (!apiKeyPresent) {
    return { ...base, status: 'unavailable', detail: 'fidelity checker is not configured (ANTHROPIC_API_KEY missing)' }
  }

  const rawCheck = deps.rawCheck ?? checkRenderFidelity
  let raw: FidelityResult
  try {
    raw = await rawCheck(renderUrl, items)
  } catch (err) {
    return { ...base, status: 'error', detail: boundError(err, redactionList()) }
  }

  // The legacy contract: `error` set means the check did NOT conclude,
  // regardless of what `passed` says. Never inherit the pass.
  if (raw.error) {
    return { ...base, status: classifyCheckerError(raw.error), detail: boundError(raw.error, redactionList()) }
  }

  if (raw.passed) {
    return { status: 'passed', score: raw.score, issues: raw.issues ?? [], correctiveNotes: null, detail: null, model: FIDELITY_MODEL }
  }
  return {
    status: 'failed',
    score: raw.score,
    issues: raw.issues ?? [],
    correctiveNotes: raw.correctiveNotes ?? null,
    detail: null,
    model: FIDELITY_MODEL,
  }
}
