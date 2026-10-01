// Connected proof, against the REAL production adapters and the connected
// MYRA Platform project, with uniquely tagged data_partition='test' rows and
// exact-ID cleanup (scrutiny round-1 corrections):
//
//   A bounded TARGET-1 batch on a reseeded evaluation profile runs the full
//   path with the REAL composer generator and the REAL objective evidence
//   provider (only the paid subjective model is a deterministic fake):
//
//     createBatch (draft) → startBatch (freezes the snapshot, generates
//     nothing) → one explicit 1-position claim → generate → candidate
//     persisted BEFORE checks → objective checks pass with the corrected
//     wearable-size and priceOfItem logic → deterministic subjective pass →
//     candidate version + case reach awaiting_human.
//
//   It also proves the reseeded profile context is the controlled taxonomy:
//   the resolved context's brand_groups are all BRAND_GROUPS keys.
//
// Every inserted row id is recorded and cleaned by exact ID through
// oq_test_cleanup in dependency order. The suite self-skips when Supabase env
// is unavailable.

import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

function ensureEnv(): boolean {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const text = readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8')
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
        if (!m) continue
        if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    } catch {
      // No env file — the suite skips below.
    }
  }
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

const CONNECTED = ensureEnv()

import { createAdminClient } from '@/lib/supabase-server'
import { createBatch, startBatch, claimChunkPositions } from '@/lib/outfit-quality/batch-store'
import { generateAndCheckChunk } from '@/lib/outfit-quality/candidate-generation'
import { createCandidatePersistence, frozenSnapshotFromRow, systemVersionsFromSnapshotRow } from '@/lib/outfit-quality/candidate-store'
import { createComposerGenerator, createObjectiveEvidenceProvider } from '@/lib/outfit-quality/generation-adapters'
import { resolveContext, toContextSnapshot } from '@/lib/outfit-quality/contexts'
import { createSupabaseRealMemberRepository, createSupabaseEvaluationProfileRepository } from '@/lib/outfit-quality/contexts-store'
import { CHLOE_STYLIST_ID } from '@/lib/outfit-quality/identities'
import { CONTROLLED_BRAND_GROUP_KEYS } from '@/lib/outfit-quality/profile-context'

const T = { timeout: 180000 }

// Everyday profile: common UK sizes, high-street budget — the most likely to
// find a fully in-size, in-stock candidate against live inventory.
const PROFILE_ID = '0b000001-0000-4000-8000-000000000001'

const insertedSets: Record<string, Set<string>> = {}
function record(table: string, ...ids: (string | null | undefined)[]) {
  insertedSets[table] = insertedSets[table] ?? new Set()
  for (const id of ids) if (id) insertedSets[table].add(id)
}
function recordedIds(table: string): string[] {
  return Array.from(insertedSets[table] ?? [])
}
const CLEANUP_ORDER = [
  'outfit_quality_machine_check',
  'outfit_quality_candidate_item',
  'outfit_quality_candidate_version',
  'outfit_quality_case',
  'outfit_quality_batch',
  'outfit_quality_stylist_snapshot',
]

async function cleanup(admin: any) {
  for (const table of CLEANUP_ORDER) {
    const ids = recordedIds(table)
    if (ids.length === 0) continue
    const { data, error } = await admin.rpc('oq_test_cleanup', { p_table: table, p_ids: ids })
    if (error) throw new Error(`cleanup failed for ${table}: ${error.message}`)
    expect(data).toBe(ids.length)
  }
}

describe.skipIf(!CONNECTED)('evaluation-profile target-1 batch → awaiting_human (connected, test partition)', () => {
  const admin: any = createAdminClient()

  afterAll(async () => {
    await cleanup(admin)
    for (const table of CLEANUP_ORDER) {
      const ids = recordedIds(table)
      if (!ids.length) continue
      const pk =
        table === 'outfit_quality_batch' ? 'batch_id'
        : table === 'outfit_quality_case' ? 'case_id'
        : table === 'outfit_quality_candidate_version' ? 'candidate_version_id'
        : table === 'outfit_quality_candidate_item' ? 'candidate_item_id'
        : table === 'outfit_quality_stylist_snapshot' ? 'snapshot_id'
        : 'check_id'
      const { data } = await admin.from(table).select(pk).in(pk, ids)
      expect(data ?? []).toHaveLength(0)
    }
  })

  it('a target-1 profile batch reaches awaiting_human through the real adapters', T, async () => {
    // The reseeded profile resolves with CONTROLLED brand-group keys only.
    const repos = {
      members: createSupabaseRealMemberRepository(admin),
      profiles: createSupabaseEvaluationProfileRepository(admin),
    }
    const ctxRes = await resolveContext({ realMemberId: null, evaluationProfileId: PROFILE_ID }, repos)
    expect(ctxRes.ok).toBe(true)
    if (!ctxRes.ok || ctxRes.context.type !== 'evaluation_profile') throw new Error('profile context did not resolve')
    for (const g of ctxRes.context.brand_groups) {
      expect(CONTROLLED_BRAND_GROUP_KEYS).toContain(g)
    }

    // Create (draft, zero candidates) then Start (freezes the snapshot only).
    const created = await createBatch({
      dataPartition: 'test',
      evaluationProfileId: PROFILE_ID,
      selectedStylistId: CHLOE_STYLIST_ID,
      targetCount: 1,
    }, admin)
    expect(created.ok).toBe(true)
    const batchId = created.batchId!
    record('outfit_quality_batch', batchId)

    const started = await startBatch(batchId, admin)
    expect(started.ok).toBe(true)

    const { data: batch } = await admin.from('outfit_quality_batch').select('*').eq('batch_id', batchId).maybeSingle()
    expect(batch.status).toBe('active')
    expect(batch.stylist_snapshot_id).toBeTruthy()
    record('outfit_quality_stylist_snapshot', batch.stylist_snapshot_id)
    const { count: casesAtStart } = await admin
      .from('outfit_quality_case')
      .select('case_id', { count: 'exact', head: true })
      .eq('batch_id', batchId)
    expect(casesAtStart ?? 0).toBe(0)

    // One explicit bounded claim, then generation through the REAL adapters
    // (composer generator + objective evidence). The subjective model is the
    // only fake — deterministic pass, no paid call.
    const claim = await claimChunkPositions(admin, batchId, 1)
    expect(claim.ok).toBe(true)
    if (!claim.ok) throw new Error(claim.message)

    const { data: snapRow } = await admin
      .from('outfit_quality_stylist_snapshot')
      .select('*')
      .eq('snapshot_id', batch.stylist_snapshot_id)
      .maybeSingle()
    expect(snapRow).toBeTruthy()
    const systemVersions = systemVersionsFromSnapshotRow(snapRow)
    const store = createCandidatePersistence({ admin, batch, systemVersions })

    const result = await generateAndCheckChunk({
      batchId,
      runId: batch.run_id,
      claim: claim.claim,
      startPosition: claim.startPosition,
      snapshot: frozenSnapshotFromRow(snapRow),
      context: {
        dataPartition: 'test',
        realMemberId: null,
        evaluationProfileId: PROFILE_ID,
        selectedStylistId: CHLOE_STYLIST_ID,
        contextSnapshot: toContextSnapshot(ctxRes.context),
      },
      generator: createComposerGenerator(admin),
      evidence: createObjectiveEvidenceProvider(admin),
      subjectiveChecker: {
        async check() {
          return { status: 'passed' as const, verdict: 'works', score: 0.9, model: 'deterministic-fake', prompt_version: 'test', raw_response_hash: null }
        },
      },
      store,
    })

    // Record every produced id BEFORE any assertion so cleanup is complete
    // even when an expectation fails mid-run.
    for (const r of result.results) {
      record('outfit_quality_case', r.caseId)
      record('outfit_quality_candidate_version', r.candidateVersionId)
      const { data: items } = await admin
        .from('outfit_quality_candidate_item')
        .select('candidate_item_id')
        .eq('candidate_version_id', r.candidateVersionId)
      record('outfit_quality_candidate_item', ...(items ?? []).map((i: any) => i.candidate_item_id))
      const { data: checks } = await admin
        .from('outfit_quality_machine_check')
        .select('check_id')
        .eq('candidate_version_id', r.candidateVersionId)
      record('outfit_quality_machine_check', ...(checks ?? []).map((c: any) => c.check_id))
    }

    expect(result.produced).toBe(1)
    expect(result.objectiveFailed).toBe(0)
    expect(result.awaitingHuman).toBe(1)
    const r = result.results[0]
    expect(r.state).toBe('awaiting_human')
    expect(r.objectiveStatus).toBe('passed')
    expect(r.subjectiveStatus).toBe('passed')

    // Reconcile the persisted graph: items frozen, objective checks recorded,
    // one subjective row, version + case awaiting_human.
    const { data: items } = await admin
      .from('outfit_quality_candidate_item')
      .select('candidate_item_id')
      .eq('candidate_version_id', r.candidateVersionId)
    expect((items ?? []).length).toBeGreaterThan(0)

    const { data: checks } = await admin
      .from('outfit_quality_machine_check')
      .select('check_id, kind, check_name, status')
      .eq('candidate_version_id', r.candidateVersionId)
    const objective = (checks ?? []).filter((c: any) => c.kind === 'objective')
    const subjective = (checks ?? []).filter((c: any) => c.kind === 'subjective')
    expect(objective.length).toBeGreaterThanOrEqual(6)
    expect(objective.every((c: any) => c.status === 'passed')).toBe(true)
    expect(subjective).toHaveLength(1)
    expect(subjective[0].status).toBe('passed')

    const { data: version, error: versionErr } = await admin
      .from('outfit_quality_candidate_version')
      .select('state')
      .eq('candidate_version_id', r.candidateVersionId)
      .maybeSingle()
    expect(versionErr).toBeNull()
    expect(version).toMatchObject({ state: 'awaiting_human' })
    const { data: caseRow, error: caseErr } = await admin
      .from('outfit_quality_case')
      .select('status, data_partition')
      .eq('case_id', r.caseId)
      .maybeSingle()
    expect(caseErr).toBeNull()
    expect(caseRow).toMatchObject({ status: 'awaiting_human', data_partition: 'test' })
  })
})
