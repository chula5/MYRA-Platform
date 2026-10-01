// Server-only read models for the Outfit Quality Batches view.
//
// These expose exactly what the admin UI needs — including the `rules_only`
// warning before Start, on the batch, and on every candidate — while the
// candidate read model omits all protected machine-verdict fields before a
// human decision persists.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { MIN_CONFIRMED_IMAGES, isEnvelopeUsable } from '@/lib/outfit-quality/stylist-snapshot'
import { buildPreDecisionCandidate, type PreDecisionCandidate, type PreDecisionItem, type RawSubjectiveCheck } from '@/lib/outfit-quality/queue-read-model'

type Admin = ReturnType<typeof createAdminClient>

export interface StylistOption {
  stylist_id: string
  slug: string
  name: string
  status: string
}

export interface RealMemberOption {
  member_id: string
  name: string
}

export interface EvaluationProfileOption {
  profile_id: string
  slug: string
  name: string
}

export interface BatchView {
  batch_id: string
  data_partition: string
  context_type: 'real_member' | 'evaluation_profile'
  context_label: string
  selected_stylist_id: string
  stylist_name: string | null
  stylist_snapshot_id: string | null
  rules_only: boolean | null
  target_count: number
  chunk_limit: number
  status: string
  produced: number
  awaiting_human: number
  objective_failed: number
  last_error: string | null
}

export async function listStylists(admin: Admin = createAdminClient()): Promise<StylistOption[]> {
  const db = admin as any
  const { data } = await db.from('stylist').select('stylist_id, slug, name, status').order('name')
  return ((data ?? []) as any[]).map((r) => ({ stylist_id: r.stylist_id, slug: r.slug, name: r.name, status: r.status }))
}

export async function listRealMembers(admin: Admin = createAdminClient()): Promise<RealMemberOption[]> {
  const db = admin as any
  const { data } = await db.from('pilot_member').select('member_id, name').eq('is_synthetic', false).order('name')
  return ((data ?? []) as any[]).map((r) => ({ member_id: r.member_id, name: r.name }))
}

export async function listEvaluationProfiles(admin: Admin = createAdminClient()): Promise<EvaluationProfileOption[]> {
  const db = admin as any
  const { data } = await db
    .from('outfit_quality_evaluation_profile')
    .select('profile_id, slug, name')
    .eq('active', true)
    .is('retired_at', null)
    .order('name')
  return ((data ?? []) as any[]).map((r) => ({ profile_id: r.profile_id, slug: r.slug, name: r.name }))
}

/**
 * Rules-only preview for a stylist BEFORE Start (there is no snapshot yet). A
 * stylist is rules-only when it has fewer than MIN_CONFIRMED_IMAGES valid
 * confirmed inspiration images or no usable envelope. No other stylist's
 * evidence is consulted.
 */
export async function previewStylistRulesOnly(
  stylistId: string,
  admin: Admin = createAdminClient(),
): Promise<{ stylist_id: string; rules_only: boolean; confirmed_count: number }> {
  const db = admin as any
  const { data: imgs } = await db
    .from('inspiration_image')
    .select('vector, status')
    .eq('persona_id', stylistId)
    .eq('status', 'confirmed')
    .is('user_id', null)
  const confirmed = ((imgs ?? []) as any[]).filter((r) => Array.isArray(r.vector) && r.vector.length > 0).length
  const { data: styl } = await db.from('stylist').select('envelope').eq('stylist_id', stylistId).maybeSingle()
  const usableEnvelope = isEnvelopeUsable(styl?.envelope ?? null)
  const rulesOnly = confirmed < MIN_CONFIRMED_IMAGES || !usableEnvelope
  return { stylist_id: stylistId, rules_only: rulesOnly, confirmed_count: confirmed }
}

export async function listBatches(admin: Admin = createAdminClient()): Promise<BatchView[]> {
  const db = admin as any
  const { data: batches } = await db
    .from('outfit_quality_batch')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  const rows = (batches ?? []) as any[]
  if (rows.length === 0) return []

  const stylistIds = Array.from(new Set(rows.map((b) => b.selected_stylist_id)))
  const snapshotIds = Array.from(new Set(rows.map((b) => b.stylist_snapshot_id).filter(Boolean)))
  const memberIds = Array.from(new Set(rows.map((b) => b.real_member_id).filter(Boolean)))
  const profileIds = Array.from(new Set(rows.map((b) => b.evaluation_profile_id).filter(Boolean)))

  const [{ data: stylists }, { data: snaps }, { data: members }, { data: profiles }] = await Promise.all([
    db.from('stylist').select('stylist_id, name').in('stylist_id', stylistIds),
    snapshotIds.length ? db.from('outfit_quality_stylist_snapshot').select('snapshot_id, rules_only').in('snapshot_id', snapshotIds) : Promise.resolve({ data: [] }),
    memberIds.length ? db.from('pilot_member').select('member_id, name').in('member_id', memberIds) : Promise.resolve({ data: [] }),
    profileIds.length ? db.from('outfit_quality_evaluation_profile').select('profile_id, name').in('profile_id', profileIds) : Promise.resolve({ data: [] }),
  ])
  const stylistName = new Map<string, string>((stylists ?? []).map((s: any) => [s.stylist_id, s.name]))
  const snapRulesOnly = new Map<string, boolean>((snaps ?? []).map((s: any) => [s.snapshot_id, !!s.rules_only]))
  const memberName = new Map<string, string>((members ?? []).map((m: any) => [m.member_id, m.name]))
  const profileName = new Map<string, string>((profiles ?? []).map((p: any) => [p.profile_id, p.name]))

  // Per-batch candidate tallies.
  const views: BatchView[] = []
  for (const b of rows) {
    const { data: cases } = await db
      .from('outfit_quality_case')
      .select('case_id, current_version_id, status')
      .eq('batch_id', b.batch_id)
    const caseRows = (cases ?? []) as any[]
    const produced = caseRows.length
    const awaiting = caseRows.filter((c) => c.status === 'awaiting_human').length
    const failed = caseRows.filter((c) => c.status === 'objective_failed').length
    views.push({
      batch_id: b.batch_id,
      data_partition: b.data_partition,
      context_type: b.real_member_id ? 'real_member' : 'evaluation_profile',
      context_label: b.real_member_id ? (memberName.get(b.real_member_id) ?? 'member') : (profileName.get(b.evaluation_profile_id) ?? 'profile'),
      selected_stylist_id: b.selected_stylist_id,
      stylist_name: stylistName.get(b.selected_stylist_id) ?? null,
      stylist_snapshot_id: b.stylist_snapshot_id,
      rules_only: b.stylist_snapshot_id ? (snapRulesOnly.get(b.stylist_snapshot_id) ?? null) : null,
      target_count: b.target_count,
      chunk_limit: b.chunk_limit,
      status: b.status,
      produced,
      awaiting_human: awaiting,
      objective_failed: failed,
      last_error: b.last_error ?? null,
    })
  }
  return views
}

/**
 * Candidate summaries for a batch. The payload is the exact pre-decision shape
 * sent to the browser: it carries `rules_only` and the frozen source items, and
 * omits every protected subjective-verdict field.
 */
export async function listBatchCandidates(
  batchId: string,
  admin: Admin = createAdminClient(),
): Promise<PreDecisionCandidate[]> {
  const db = admin as any
  const { data: batch } = await db
    .from('outfit_quality_batch')
    .select('batch_id, selected_stylist_id, real_member_id, evaluation_profile_id, stylist_snapshot_id')
    .eq('batch_id', batchId)
    .maybeSingle()
  if (!batch) return []

  const { data: snap } = batch.stylist_snapshot_id
    ? await db.from('outfit_quality_stylist_snapshot').select('rules_only').eq('snapshot_id', batch.stylist_snapshot_id).maybeSingle()
    : { data: null }
  const rulesOnly = !!snap?.rules_only

  const { data: cases } = await db
    .from('outfit_quality_case')
    .select('case_id, current_version_id')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: false })
    .limit(60)
  const caseRows = (cases ?? []) as any[]
  const versionIds = caseRows.map((c) => c.current_version_id).filter(Boolean)
  if (versionIds.length === 0) return []

  const [{ data: versions }, { data: items }, { data: checks }] = await Promise.all([
    db.from('outfit_quality_candidate_version').select('candidate_version_id, case_id, version_no, state').in('candidate_version_id', versionIds),
    db.from('outfit_quality_candidate_item').select('candidate_item_id, candidate_version_id, item_id, slot, sort_order, source_image_url, item_snapshot').in('candidate_version_id', versionIds),
    // Only disclose THAT a subjective check exists — never select its verdict/score/reasons here.
    db.from('outfit_quality_machine_check').select('check_id, candidate_version_id, kind, status').in('candidate_version_id', versionIds).eq('kind', 'subjective'),
  ])

  const itemsByVersion = new Map<string, PreDecisionItem[]>()
  for (const it of (items ?? []) as any[]) {
    const list = itemsByVersion.get(it.candidate_version_id) ?? []
    list.push({
      candidate_item_id: it.candidate_item_id,
      item_id: it.item_id,
      slot: it.slot,
      sort_order: it.sort_order,
      source_image_url: it.source_image_url,
      item_snapshot: it.item_snapshot ?? {},
    })
    itemsByVersion.set(it.candidate_version_id, list)
  }
  const subjByVersion = new Map<string, RawSubjectiveCheck[]>()
  for (const c of (checks ?? []) as any[]) {
    const list = subjByVersion.get(c.candidate_version_id) ?? []
    list.push({ check_id: c.check_id, kind: 'subjective', status: c.status })
    subjByVersion.set(c.candidate_version_id, list)
  }

  return ((versions ?? []) as any[]).map((v) =>
    buildPreDecisionCandidate({
      candidate_version_id: v.candidate_version_id,
      case_id: v.case_id,
      version_no: v.version_no,
      state: v.state,
      rules_only: rulesOnly,
      real_member_id: batch.real_member_id,
      evaluation_profile_id: batch.evaluation_profile_id,
      selected_stylist_id: batch.selected_stylist_id,
      subjectiveChecks: subjByVersion.get(v.candidate_version_id) ?? [],
      items: itemsByVersion.get(v.candidate_version_id) ?? [],
    }),
  )
}
