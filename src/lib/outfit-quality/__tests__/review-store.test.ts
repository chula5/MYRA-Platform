// Review store behaviour against an in-memory Supabase fake: exact-version
// decide, idempotent replay, hold/release, append-only undo/withdraw, queued
// render cancellation, withdrawal gating, and post-persistence machine reveal.
// The connected suite proves the same against the real database; here we prove
// the logic and the error-checked write ordering.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  decideCandidate,
  undoCandidateDecision,
  withdrawCandidateApproval,
  holdCandidate,
  releaseCandidate,
  loadMachineResult,
  type ReviewActor,
} from '@/lib/outfit-quality/review-store'

// ── Minimal in-memory fake of the supabase-js fluent API ─────────────────────

const PK: Record<string, string> = {
  outfit_quality_candidate_version: 'candidate_version_id',
  outfit_quality_case: 'case_id',
  outfit_quality_candidate_item: 'candidate_item_id',
  outfit_quality_review_event: 'review_event_id',
  outfit_quality_queue_hold: 'hold_id',
  outfit_quality_render_job: 'render_job_id',
  outfit_quality_machine_check: 'check_id',
}

const DEFAULTS: Record<string, Record<string, unknown>> = {
  outfit_quality_candidate_version: { state: 'awaiting_human' },
  outfit_quality_review_event: { decision: null, reason_code: null, candidate_item_id: null, note: null, reverses_event_id: null },
  outfit_quality_queue_hold: { reason: null, released_by: null, released_at: null },
  outfit_quality_render_job: { cycle_no: 1, status: 'queued', lease_token: null, generation_count: 0 },
}

interface FakeDb {
  tables: Record<string, any[]>
  admin: any
  inserts: { table: string; row: any }[]
}

function createFakeAdmin(seed: Record<string, any[]>): FakeDb {
  const tables: Record<string, any[]> = {}
  for (const [k, rows] of Object.entries(seed)) tables[k] = rows.map((r) => ({ ...r }))
  const inserts: { table: string; row: any }[] = []
  let seq = 0

  function matches(row: any, filters: { col: string; op: string; val: unknown }[]): boolean {
    return filters.every((f) => {
      if (f.op === 'eq') return row[f.col] === f.val
      if (f.op === 'is') return f.val === null ? row[f.col] === null || row[f.col] === undefined : row[f.col] === f.val
      if (f.op === 'in') return (f.val as unknown[]).includes(row[f.col])
      return false
    })
  }

  function checkUnique(table: string, row: any): string | null {
    if (table === 'outfit_quality_review_event') {
      const dup = tables[table].some((r) => r.idempotency_key === row.idempotency_key)
      if (dup) return 'duplicate key value violates unique constraint "outfit_quality_review_event_idempotency_key_key"'
    }
    if (table === 'outfit_quality_render_job') {
      const dup = tables[table].some(
        (r) => r.candidate_version_id === row.candidate_version_id && r.approval_event_id === row.approval_event_id && r.cycle_no === row.cycle_no,
      )
      if (dup) return 'duplicate key value violates unique constraint "oq_render_job_cycle_uq"'
    }
    return null
  }

  function builder(table: string) {
    const state: {
      mode: 'select' | 'insert' | 'update'
      filters: { col: string; op: string; val: unknown }[]
      insertRow?: any
      patch?: any
      orderCol?: string
      single: boolean
    } = { mode: 'select', filters: [], single: false }

    function execute(): { data: any; error: any } {
      tables[table] = tables[table] ?? []
      if (state.mode === 'insert') {
        const dupErr = checkUnique(table, state.insertRow)
        if (dupErr) return { data: null, error: { code: '23505', message: dupErr } }
        seq += 1
        const pk = PK[table]
        const row = {
          ...(DEFAULTS[table] ?? {}),
          ...state.insertRow,
          [pk]: state.insertRow[pk] ?? `${table}-${seq}`,
          created_at: state.insertRow.created_at ?? new Date(2026, 0, 1, 0, 0, seq).toISOString(),
        }
        tables[table].push(row)
        inserts.push({ table, row })
        return { data: state.single ? row : [row], error: null }
      }
      let rows = tables[table].filter((r) => matches(r, state.filters))
      if (state.mode === 'update') {
        rows.forEach((r) => Object.assign(r, state.patch))
      }
      if (state.orderCol) rows = rows.slice().sort((a, b) => String(a[state.orderCol!]).localeCompare(String(b[state.orderCol!])))
      if (state.single) return { data: rows[0] ?? null, error: null }
      return { data: rows, error: null }
    }

    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => (state.filters.push({ col, op: 'eq', val }), b),
      is: (col: string, val: unknown) => (state.filters.push({ col, op: 'is', val }), b),
      in: (col: string, val: unknown[]) => (state.filters.push({ col, op: 'in', val }), b),
      order: (col: string) => ((state.orderCol = col), b),
      limit: () => b,
      insert: (row: any) => ((state.mode = 'insert'), (state.insertRow = row), b),
      update: (patch: any) => ((state.mode = 'update'), (state.patch = patch), b),
      maybeSingle: () => ((state.single = true), Promise.resolve(execute())),
      then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject),
    }
    return b
  }

  return { tables, inserts, admin: { from: builder } }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ACTOR: ReviewActor = { userId: 'admin-verified-1' }
const KEY1 = '0a69d798-82f7-4afc-b847-97695735bb16'
const KEY2 = '1b70e899-93f8-4b0d-b858-08706846cc27'
const KEY3 = '2c81f9aa-a409-4c1e-c969-19817957dd38'
const KEY4 = '3d920abb-b51a-4d2f-da7a-2a828a68ee49'
const KEY5 = '4ea31bcc-c62b-4e30-eb8b-3b939b79ff5a'

function seedQueue(overrides: { versionState?: string; events?: any[]; holds?: any[]; jobs?: any[] } = {}) {
  return createFakeAdmin({
    outfit_quality_candidate_version: [
      { candidate_version_id: 'v1', case_id: 'c1', version_no: 1, state: overrides.versionState ?? 'awaiting_human', created_at: '2026-01-01T00:00:00.000Z' },
    ],
    outfit_quality_case: [{ case_id: 'c1', current_version_id: 'v1', status: 'awaiting_human' }],
    outfit_quality_candidate_item: [
      { candidate_item_id: 'ci-1', candidate_version_id: 'v1', item_id: 'i1', slot: 'top', sort_order: 0 },
      { candidate_item_id: 'ci-2', candidate_version_id: 'v1', item_id: 'i2', slot: 'bottom', sort_order: 1 },
    ],
    outfit_quality_review_event: overrides.events ?? [],
    outfit_quality_queue_hold: overrides.holds ?? [],
    outfit_quality_render_job: overrides.jobs ?? [],
    outfit_quality_machine_check: [
      {
        check_id: 'chk-1',
        candidate_version_id: 'v1',
        kind: 'subjective',
        check_name: 'selected_stylist_fit',
        status: 'passed',
        verdict: 'approve',
        score: 0.91,
        issues: null,
        model: 'm1',
        prompt_version: 'p1',
        raw_response_hash: 'h1',
        attempt: 1,
        idempotency_key: 'v1:subjective:1',
      },
    ],
  })
}

// ── Decide ────────────────────────────────────────────────────────────────────

describe('decideCandidate', () => {
  it('approves the exact version: stamps the verified actor, flips state, enqueues one render cycle, then reveals the machine result', async () => {
    const db = seedQueue()
    const r = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(r).toMatchObject({ ok: true, reused: false, nextState: 'approved' })
    if (!r.ok) return
    expect(r.event.reviewer_user_id).toBe('admin-verified-1')
    expect(r.event.decision).toBe('yes')
    expect(db.tables.outfit_quality_candidate_version[0].state).toBe('approved')
    expect(db.tables.outfit_quality_render_job).toHaveLength(1)
    expect(db.tables.outfit_quality_render_job[0]).toMatchObject({ candidate_version_id: 'v1', approval_event_id: r.event.review_event_id, status: 'queued', cycle_no: 1 })
    // The machine result is present only in the successful post-persistence response.
    expect(r.machine).toMatchObject({ revealed: true })
    if (r.machine?.revealed) expect(r.machine.checks[0]).toMatchObject({ verdict: 'approve', score: 0.91 })
  })

  it('records a structured item-specific No with the affected item and no render job', async () => {
    const db = seedQueue()
    const r = await decideCandidate('v1', { decision: 'no', reasonCode: 'item_wrong_for_member', candidateItemId: 'ci-2', note: 'rise is wrong for this brief', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(r).toMatchObject({ ok: true, nextState: 'rejected' })
    if (!r.ok) return
    expect(r.event).toMatchObject({ decision: 'no', reason_code: 'item_wrong_for_member', candidate_item_id: 'ci-2', note: 'rise is wrong for this brief' })
    expect(db.tables.outfit_quality_render_job).toHaveLength(0)
  })

  it('rejects missing reason, foreign item, stale version, held, double decision, and bad key without changing state', async () => {
    const db = seedQueue()
    const before = JSON.stringify(db.tables)

    expect(await decideCandidate('v1', { decision: 'no', note: 'no reason given', idempotencyKey: KEY1 }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'missing_reason' })
    expect(await decideCandidate('v1', { decision: 'no', reasonCode: 'item_wrong_for_stylist', candidateItemId: 'ci-foreign', idempotencyKey: KEY1 }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'foreign_item' })
    expect(await decideCandidate('v1', { decision: 'yes', idempotencyKey: 'not-a-key' }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'invalid_idempotency_key' })

    const stale = seedQueue()
    stale.tables.outfit_quality_case[0].current_version_id = 'v2-child'
    expect(await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, stale.admin)).toMatchObject({ ok: false, code: 'stale_version' })

    const heldDb = seedQueue({ holds: [{ hold_id: 'h1', candidate_version_id: 'v1', held_by: 'a', reason: 'x', released_by: null, created_at: 't', released_at: null }] })
    expect(await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, heldDb.admin)).toMatchObject({ ok: false, code: 'held' })

    expect(JSON.stringify(db.tables)).toBe(before)

    // A persisted decision blocks a second active one.
    const first = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(first.ok).toBe(true)
    expect(await decideCandidate('v1', { decision: 'no', reasonCode: 'global_composition', idempotencyKey: KEY3 }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'already_decided' })
    expect(db.tables.outfit_quality_review_event).toHaveLength(1)
  })

  it('replays the same idempotency key as the original result with no duplicate event or job', async () => {
    const db = seedQueue()
    const first = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    const replay = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(first.ok && replay.ok).toBe(true)
    if (first.ok && replay.ok) {
      expect(replay.reused).toBe(true)
      expect(replay.event.review_event_id).toBe(first.event.review_event_id)
    }
    expect(db.tables.outfit_quality_review_event).toHaveLength(1)
    expect(db.tables.outfit_quality_render_job).toHaveLength(1)
  })
})

// ── Hold / release ────────────────────────────────────────────────────────────

describe('holdCandidate / releaseCandidate', () => {
  it('hold records holder, reason and time, creates no review event, and a repeat hold reuses it', async () => {
    const db = seedQueue()
    const h1 = await holdCandidate('v1', { reason: 'check stock tomorrow' }, ACTOR, db.admin)
    expect(h1).toMatchObject({ ok: true, reused: false })
    const h2 = await holdCandidate('v1', { reason: 'different reason' }, ACTOR, db.admin)
    expect(h2).toMatchObject({ ok: true, reused: true })
    expect(db.tables.outfit_quality_queue_hold).toHaveLength(1)
    expect(db.tables.outfit_quality_queue_hold[0]).toMatchObject({ held_by: 'admin-verified-1', reason: 'check stock tomorrow', released_at: null })
    expect(db.tables.outfit_quality_review_event).toHaveLength(0)
  })

  it('release closes the active hold with the verified actor; replays are no-ops; never-held errors', async () => {
    const db = seedQueue()
    expect(await releaseCandidate('v1', ACTOR, db.admin)).toMatchObject({ ok: false, code: 'not_held' })

    await holdCandidate('v1', {}, ACTOR, db.admin)
    const rel = await releaseCandidate('v1', ACTOR, db.admin)
    expect(rel).toMatchObject({ ok: true, reused: false })
    const holdRow = db.tables.outfit_quality_queue_hold[0]
    expect(holdRow.released_by).toBe('admin-verified-1')
    expect(holdRow.released_at).toBeTruthy()

    const replay = await releaseCandidate('v1', ACTOR, db.admin)
    expect(replay).toMatchObject({ ok: true, reused: true })
    expect(db.tables.outfit_quality_queue_hold).toHaveLength(1)
    expect(db.tables.outfit_quality_review_event).toHaveLength(0)
  })

  it('a decided candidate cannot be held', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(await holdCandidate('v1', {}, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'not_holdable' })
  })
})

// ── Undo / withdraw ───────────────────────────────────────────────────────────

describe('undoCandidateDecision', () => {
  it('undoes a No: appends a reversal, keeps the original, returns the version to review', async () => {
    const db = seedQueue()
    const d = await decideCandidate('v1', { decision: 'no', reasonCode: 'global_composition', idempotencyKey: KEY1 }, ACTOR, db.admin)
    if (!d.ok) throw new Error('setup decide failed')
    const u = await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(u).toMatchObject({ ok: true, nextState: 'awaiting_human', reversedDecision: 'no' })
    const events = db.tables.outfit_quality_review_event
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ action: 'undo', reverses_event_id: d.event.review_event_id, reviewer_user_id: 'admin-verified-1' })
    expect(events[0]).toMatchObject({ action: 'decide', decision: 'no', reason_code: 'global_composition' }) // preserved
    expect(db.tables.outfit_quality_candidate_version[0].state).toBe('awaiting_human')
  })

  it('undoes a queued approval and cancels the render job in the same mutation', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    const u = await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(u).toMatchObject({ ok: true, reversedDecision: 'yes' })
    expect(db.tables.outfit_quality_render_job[0].status).toBe('cancelled')
    expect(db.tables.outfit_quality_candidate_version[0].state).toBe('awaiting_human')
    // The approval can be re-decided after undo.
    const again = await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY3 }, ACTOR, db.admin)
    expect(again.ok).toBe(true)
  })

  it('refuses ordinary undo once rendering has started, requiring withdrawal', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    db.tables.outfit_quality_render_job[0].status = 'running'
    db.tables.outfit_quality_render_job[0].lease_token = 'lease-1'
    const u = await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(u).toMatchObject({ ok: false, code: 'withdrawal_required' })
    expect(db.tables.outfit_quality_review_event).toHaveLength(1) // nothing appended
  })

  it('refuses when there is no active decision and replays idempotently', async () => {
    const db = seedQueue()
    expect(await undoCandidateDecision('v1', { idempotencyKey: KEY1 }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'nothing_to_undo' })
    await decideCandidate('v1', { decision: 'no', reasonCode: 'wrong_for_stylist', idempotencyKey: KEY1 }, ACTOR, db.admin)
    const u1 = await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    const u2 = await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(u1.ok && u2.ok).toBe(true)
    if (u1.ok && u2.ok) expect(u2.event.review_event_id).toBe(u1.event.review_event_id)
    expect(db.tables.outfit_quality_review_event).toHaveLength(2)
  })
})

describe('withdrawCandidateApproval', () => {
  it('withdraws a started approval: appends the event, hides the version, keeps all provenance', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    db.tables.outfit_quality_render_job[0].status = 'running'
    db.tables.outfit_quality_render_job[0].lease_token = 'lease-1'
    const w = await withdrawCandidateApproval('v1', { idempotencyKey: KEY2, note: 'render drifted from source' }, ACTOR, db.admin)
    expect(w).toMatchObject({ ok: true, nextState: 'approval_withdrawn' })
    const events = db.tables.outfit_quality_review_event
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ action: 'withdraw', note: 'render drifted from source' })
    expect(events[0].decision).toBe('yes') // original preserved
    expect(db.tables.outfit_quality_candidate_version[0].state).toBe('approval_withdrawn')
  })

  it('cancels still-queued jobs on withdrawal and refuses without an active approval', async () => {
    const db = seedQueue()
    expect(await withdrawCandidateApproval('v1', { idempotencyKey: KEY1 }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'not_approved' })
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY2 }, ACTOR, db.admin)
    const w = await withdrawCandidateApproval('v1', { idempotencyKey: KEY3 }, ACTOR, db.admin)
    expect(w.ok).toBe(true)
    expect(db.tables.outfit_quality_render_job[0].status).toBe('cancelled')
    const replay = await withdrawCandidateApproval('v1', { idempotencyKey: KEY3 }, ACTOR, db.admin)
    expect(replay).toMatchObject({ ok: true, reused: true })
    expect(db.tables.outfit_quality_review_event).toHaveLength(2)
  })

  it('a No decision cannot be withdrawn (undo is the reversal)', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'no', reasonCode: 'operational_data', idempotencyKey: KEY1 }, ACTOR, db.admin)
    expect(await withdrawCandidateApproval('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)).toMatchObject({ ok: false, code: 'not_approved' })
  })
})

// ── Machine-result disclosure gate ────────────────────────────────────────────

describe('loadMachineResult', () => {
  it('stays hidden before a decision persists and reveals only after', async () => {
    const db = seedQueue()
    const before = await loadMachineResult('v1', db.admin)
    expect(before).toEqual({ revealed: false })
    await decideCandidate('v1', { decision: 'yes', idempotencyKey: KEY1 }, ACTOR, db.admin)
    const after = await loadMachineResult('v1', db.admin)
    expect(after.revealed).toBe(true)
    if (after.revealed) expect(after.checks[0]).toMatchObject({ verdict: 'approve', raw_response_hash: 'h1' })
  })

  it('hides again when the only decision was reversed and no new one exists', async () => {
    const db = seedQueue()
    await decideCandidate('v1', { decision: 'no', reasonCode: 'global_composition', idempotencyKey: KEY1 }, ACTOR, db.admin)
    await undoCandidateDecision('v1', { idempotencyKey: KEY2 }, ACTOR, db.admin)
    expect(await loadMachineResult('v1', db.admin)).toEqual({ revealed: false })
  })
})
