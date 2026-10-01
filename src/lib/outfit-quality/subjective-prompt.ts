// The subjective checker's lens — built ONLY from the frozen snapshot payload.
//
// Generation froze the selected stylist's constitution, brief, rules, learned
// model, and inspiration into one immutable snapshot. Machine review must look
// through exactly that same lens: this module renders the check's stylist
// description from the persisted payload alone. It never reads a live stylist
// table, so a source-table edit after the snapshot can never change what the
// checker is told.
//
// Privacy/size discipline: the prompt carries rules and summaries, never raw
// inspiration image URLs, vectors, or whole learned-model blobs — those are
// represented by counts and short digests.

import { canonicalize, sha256Hex, type SnapshotPayload } from '@/lib/outfit-quality/stylist-snapshot'

/** A short, deterministic digest for a bulky payload section. */
function digest(value: unknown): string {
  return sha256Hex(canonicalize(value)).slice(0, 12)
}

const CONSTITUTION_CHAR_LIMIT = 1200

function constitutionText(payload: SnapshotPayload): string {
  if (!payload.constitution) return 'none recorded'
  const canonical = canonicalize(payload.constitution)
  const body = canonical.length > CONSTITUTION_CHAR_LIMIT ? `${canonical.slice(0, CONSTITUTION_CHAR_LIMIT)}…` : canonical
  return `v${payload.stylist.constitution_version ?? 'unversioned'} ${body}`
}

function listOrNone(xs: readonly string[]): string {
  return xs.length ? xs.join(', ') : 'none recorded'
}

/**
 * Render the frozen snapshot as the stylist description for the subjective
 * check. Deterministic: the same payload always yields the same text, and two
 * snapshots whose rules, learned model, or inspiration differ always yield
 * different text.
 */
export function buildSubjectiveCheckPrompt(payload: SnapshotPayload): string {
  const { stylist, brief, voice, learned_model, inspiration } = payload

  const nevers = payload.exclusions.map((n) => `${n.text}${n.kind === 'ban' ? ' (absolute ban)' : ' (strong preference against)'}`)
  const model =
    learned_model.status === 'loaded'
      ? `learned model present (version ${learned_model.version ?? 'unversioned'}, trained on ${learned_model.decision_count} decisions, digest ${digest(learned_model.payload)})`
      : 'no learned model for this stylist (absent — judge on the stated rules alone)'
  const occasions = Array.from(
    new Set(inspiration.images.flatMap((i) => i.occasion_read ?? [])),
  ).sort()
  const imageDigest = digest(inspiration.images.map((i) => i.image_id).sort())
  const inspirationSummary =
    inspiration.confirmed_count > 0
      ? `${inspiration.confirmed_count} confirmed inspiration references (set digest ${imageDigest})${occasions.length ? `, mostly reading: ${occasions.slice(0, 8).join(', ')}` : ''}`
      : 'no confirmed inspiration references'

  return [
    `Selected stylist: ${stylist.display_name} (${stylist.slug}), constitution ${constitutionText(payload)}.`,
    `Brief — ${brief.tagline || 'no tagline'}. Day: ${brief.day ?? 'n/a'}. Evening: ${brief.evening ?? 'n/a'}. Weekend: ${brief.weekend ?? 'n/a'}. How she routes: ${brief.how_she_routes ?? 'n/a'}.`,
    `Brand direction: ${listOrNone(payload.brand_direction)}. Palette: ${listOrNone(payload.palette)}. Fabrics: ${listOrNone(payload.fabrics)}. Signature pieces: ${listOrNone(payload.signature_pieces)}.`,
    nevers.length
      ? `Her exclusions — treat each as a rule: ${nevers.join('; ')}.`
      : 'No exclusion rules recorded.',
    voice.voice_notes ? `Voice notes: ${voice.voice_notes}` : '',
    `Frozen evidence: ${model}; ${inspirationSummary}.`,
    payload.rules_only
      ? 'This snapshot is RULES ONLY (insufficient confirmed inspiration or no usable envelope): judge strictly by the stated rules, constitution, and brief.'
      : '',
    `Judge the outfit as ${stylist.display_name} would: a look that breaks her rules clashes for her, even when it would be fine for another stylist.`,
  ]
    .filter(Boolean)
    .join('\n')
}
