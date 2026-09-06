// WHICH LAYER DOES THIS LESSON BELONG TO?
//
// The harness has to carry what it learns from one client to the next without
// carrying HER with it. Alison hating black MUNTHE bags must not become a rule
// that shapes the next client's looks; "outerwear pulled from casual daytime"
// probably should. The difference is evidence, and it is decided here.
//
// Four layers, narrowest first:
//
//   client   this person only.
//   style    a reference profile several clients of one stylist can share.
//   stylist  the stylist's constitution and taste rules. Chloe is stylist 001;
//            the House Style Constitution is hers. Every Chloe client
//            inherits it in full; another stylist has their own.
//   global   taste-independent ONLY — the brand layer, vector scoring, the
//            composer's mechanics, and correctness (in stock, in size, no
//            duplicate slots). Nothing here has an opinion about what looks
//            good, which is exactly why it is safe to share with everyone.
//
// Pure and dependency-free: every rule below is decided from counts and
// provenance, so it can be tested against real history rather than trusted.

export const SCOPES = ['client', 'style', 'stylist', 'global'] as const
export type Scope = (typeof SCOPES)[number]

export const SCOPE_LABEL: Record<Scope, string> = {
  client: 'JUST HER',
  style: 'THIS STYLE',
  stylist: "THE STYLIST'S RULE",
  global: 'ENGINE',
}

/** What capture writes before any evidence exists. Nothing generalises on its own. */
export const DEFAULT_SCOPE: Scope = 'client'

// ── Patterns ────────────────────────────────────────────────────────────────

export interface SignalItem {
  item_type?: string | null
  colour_family?: string | null
  material_category?: string | null
  material_primary?: string | null
  brand_id?: string | null
  brand_name?: string | null
}

export interface Signal {
  member_id: string
  /** Which style profile the member sat on when the signal was captured. */
  profile_id?: string | null
  stylist_id?: string | null
  action: 'swap' | 'remove' | 'reject' | 'liked'
  occasion?: string | null
  item?: SignalItem | null
  scope?: Scope
  scope_source?: 'auto' | 'manual'
  created_at?: string
}

/**
 * The description a lesson generalises to.
 *
 * Deliberately NOT the item: "she swapped that bag out" transfers to nobody.
 * "a raffia bag pulled from a smart look" is a pattern another client can
 * benefit from. The occasion is part of it — the same piece is right for a
 * beach and wrong for a client meeting, and a rule that forgets the occasion
 * is worse than no rule.
 */
export function patternKey(s: Signal): string | null {
  const it = s.item
  if (!it?.item_type) return null
  const material = it.material_category ?? null
  const colour = it.colour_family ?? null
  const facet = material ? `material:${material}` : colour ? `colour:${colour}` : null
  if (!facet) return null
  const occ = s.occasion ? `@${s.occasion}` : '@any'
  return `${s.action}:type:${it.item_type}+${facet}${occ}`
}

export function patternLabel(s: Signal): string {
  const it = s.item
  const verb = s.action === 'swap' ? 'swapped out of' : s.action === 'remove' ? 'pulled from' : s.action === 'liked' ? 'kept in' : 'rejected in'
  const what = [it?.material_category ?? it?.colour_family, it?.item_type].filter(Boolean).join(' ').replace(/_/g, ' ')
  const occ = s.occasion ? `${String(s.occasion).replace(/_/g, ' ')} looks` : 'looks'
  return `${what} ${verb} ${occ}`
}

// ── Promotion ───────────────────────────────────────────────────────────────

/** A pattern has to recur before it means anything. */
export const STYLE_MIN_OCCURRENCES = 3
/** And a stylist rule needs more than one person to have shown it. */
export const STYLIST_MIN_MEMBERS = 2

export interface PatternEvidence {
  key: string
  label: string
  occurrences: number
  /** member_id → times seen */
  byMember: Map<string, number>
  /** member_id → the style profile she was on */
  profileByMember: Map<string, string | null>
  stylistId: string | null
}

export function gatherPatterns(signals: Signal[]): Map<string, PatternEvidence> {
  const out = new Map<string, PatternEvidence>()
  for (const s of signals) {
    // 'liked' is evidence FOR something and never promotes a rejection rule.
    if (s.action === 'liked') continue
    const key = patternKey(s)
    if (!key) continue
    const e = out.get(key) ?? {
      key, label: patternLabel(s), occurrences: 0,
      byMember: new Map<string, number>(),
      profileByMember: new Map<string, string | null>(),
      stylistId: s.stylist_id ?? null,
    }
    e.occurrences++
    e.byMember.set(s.member_id, (e.byMember.get(s.member_id) ?? 0) + 1)
    e.profileByMember.set(s.member_id, s.profile_id ?? null)
    out.set(key, e)
  }
  return out
}

export interface Promotion {
  key: string
  label: string
  scope: Extract<Scope, 'style' | 'stylist'>
  stylistId: string | null
  profileId: string | null
  occurrences: number
  memberCount: number
  members: string[]
  reason: string
}

/**
 * client → style: the pattern recurs for ONE client often enough to be about
 * the style rather than the moment. The caller still checks it against the
 * profile's reference images before writing it — a pattern that contradicts
 * the moodboard is her drifting from the profile, not the profile being wrong.
 *
 * style → stylist: the pattern shows up for two or more clients on DIFFERENT
 * style profiles under the same stylist. One client can never make a stylist
 * rule, which is precisely how Alison's quirks stay Alison's.
 */
export function promotions(patterns: Map<string, PatternEvidence>): Promotion[] {
  const out: Promotion[] = []
  for (const e of Array.from(patterns.values())) {
    const members = Array.from(e.byMember.keys())
    const profiles = new Set(members.map((m) => e.profileByMember.get(m) ?? `none:${m}`))

    if (members.length >= STYLIST_MIN_MEMBERS && profiles.size >= STYLIST_MIN_MEMBERS) {
      out.push({
        key: e.key, label: e.label, scope: 'stylist',
        stylistId: e.stylistId, profileId: null,
        occurrences: e.occurrences, memberCount: members.length, members,
        reason: `${members.length} clients on ${profiles.size} different style profiles`,
      })
      continue
    }
    for (const m of members) {
      const n = e.byMember.get(m) ?? 0
      if (n < STYLE_MIN_OCCURRENCES) continue
      out.push({
        key: e.key, label: e.label, scope: 'style',
        stylistId: e.stylistId, profileId: e.profileByMember.get(m) ?? null,
        occurrences: n, memberCount: 1, members: [m],
        reason: `${n} times for one client`,
      })
    }
  }
  return out
}

// ── Attribution ─────────────────────────────────────────────────────────────

export interface Attribution {
  total: number
  byScope: Record<Scope, number>
  /** Share that stayed with her alone. High and static means nothing compounds. */
  clientOnlyShare: number
  promotedShare: number
}

export function attribution(signals: Signal[]): Attribution {
  const byScope: Record<Scope, number> = { client: 0, style: 0, stylist: 0, global: 0 }
  for (const s of signals) byScope[s.scope ?? DEFAULT_SCOPE]++
  const total = signals.length
  const promoted = byScope.style + byScope.stylist + byScope.global
  return {
    total,
    byScope,
    clientOnlyShare: total ? byScope.client / total : 0,
    promotedShare: total ? promoted / total : 0,
  }
}

// ── Stylist fit ─────────────────────────────────────────────────────────────

/** Above this share of her edits landing on constitution-compliant looks, the
 *  problem is probably the stylist, not the learning. */
export const MISMATCH_THRESHOLD = 0.3
/** And it takes a real sample before that is worth saying out loud. */
export const MISMATCH_MIN_LOOKS = 20

export interface StylistFit {
  looks: number
  edits: number
  /** Edits made to looks the constitution PASSED — she is overruling the
   *  stylist's taste, not correcting a mistake. */
  constitutionEdits: number
  /** Edits to looks that broke a rule — the composer got it wrong, and more
   *  learning under this stylist will fix it. */
  composerEdits: number
  constitutionShare: number
  mismatch: boolean
  note: string
}

/**
 * Split her edits into "the stylist's taste is wrong for her" and "the
 * composer made a mistake".
 *
 * The test is what the constitution said about the look she edited. If the
 * look PASSED and she still changed it, the rules and this client disagree —
 * no amount of learning under this stylist fixes that, she needs a different
 * one. If the look FAILED, the composer broke a rule the stylist already
 * states, which is exactly what more learning does fix.
 */
export function stylistFit(
  edits: { lookId: string; constitutionPassed: boolean }[],
): StylistFit {
  const looks = new Set(edits.map((e) => e.lookId)).size
  const constitutionEdits = edits.filter((e) => e.constitutionPassed).length
  const composerEdits = edits.length - constitutionEdits
  const share = edits.length ? constitutionEdits / edits.length : 0
  const mismatch = looks >= MISMATCH_MIN_LOOKS && share > MISMATCH_THRESHOLD
  return {
    looks,
    edits: edits.length,
    constitutionEdits,
    composerEdits,
    constitutionShare: share,
    mismatch,
    note: mismatch
      ? 'POSSIBLE STYLIST MISMATCH — most of her edits overrule rules the composer applied correctly. A different stylist persona may fit her better than more learning under this one.'
      : looks < MISMATCH_MIN_LOOKS
        ? `${MISMATCH_MIN_LOOKS - looks} more reviewed looks before this reads either way`
        : 'Her edits are mostly composer mistakes — the right kind, and learning fixes them.',
  }
}

// ── Transfer metric ─────────────────────────────────────────────────────────

export interface ClientRun {
  memberId: string
  name: string
  stylistId: string | null
  onboardedAt: string
  /** Chronological: true where the look went out with no edit at all. */
  looksClean: boolean[]
}

export interface TransferPoint {
  memberId: string
  name: string
  order: number
  looks: number
  cleanRate: number | null
  /** Against the FIRST client under this stylist. */
  deltaVsBaseline: number | null
}

export const TRANSFER_WINDOW = 10

/**
 * First-ten clean rate per client, in onboarding order, per stylist.
 *
 * The single number that says whether MYRA is learning to style or learning to
 * style one person. The first client under a stylist is the baseline; every
 * later one should start above her, because the transferable half of what was
 * learned should already be in place before her first delivery.
 */
export function transferSeries(runs: ClientRun[]): TransferPoint[] {
  const byStylist = new Map<string, ClientRun[]>()
  for (const r of runs) {
    const k = r.stylistId ?? 'none'
    byStylist.set(k, [...(byStylist.get(k) ?? []), r])
  }
  const out: TransferPoint[] = []
  for (const list of Array.from(byStylist.values())) {
    const ordered = list.slice().sort((a, b) => a.onboardedAt.localeCompare(b.onboardedAt))
    let baseline: number | null = null
    ordered.forEach((r, i) => {
      const window = r.looksClean.slice(0, TRANSFER_WINDOW)
      const rate = window.length ? window.filter(Boolean).length / window.length : null
      if (i === 0) baseline = rate
      out.push({
        memberId: r.memberId,
        name: r.name,
        order: i + 1,
        looks: window.length,
        cleanRate: rate,
        deltaVsBaseline: i === 0 || rate == null || baseline == null ? null : rate - baseline,
      })
    })
  }
  return out
}

/**
 * What a new client should start at, given what has been learned so far.
 *
 * Deliberately crude and stated as such: the baseline clean rate lifted by how
 * much of the learning is transferable — the rules that sit at stylist or
 * style scope rather than locked to one person. If this is not meaningfully
 * above the last client's actual first-ten, the harness is not transferring,
 * and that is worth knowing BEFORE her first delivery rather than after.
 */
export const TRANSFER_LIFT_PER_RULE = 0.02
export const MAX_PREDICTED_LIFT = 0.35

export function predictedCleanRate(
  baseline: number | null,
  inheritedRules: { stylist: number; style: number },
): { predicted: number | null; lift: number; basis: string } {
  const rules = inheritedRules.stylist + inheritedRules.style
  const lift = Math.min(MAX_PREDICTED_LIFT, rules * TRANSFER_LIFT_PER_RULE)
  if (baseline == null) {
    return { predicted: null, lift, basis: 'no earlier client under this stylist to compare against' }
  }
  return {
    predicted: Math.min(1, baseline + lift),
    lift,
    basis: `${inheritedRules.stylist} stylist rules + ${inheritedRules.style} style rules already learned`,
  }
}
