// Shared in-memory fake of the supabase-js fluent API for outfit-quality
// store/worker tests. Mirrors the real unique constraints the modules rely on
// so idempotency and concurrency logic is exercised, not mocked away.

export const FAKE_PK: Record<string, string> = {
  outfit_quality_candidate_version: 'candidate_version_id',
  outfit_quality_case: 'case_id',
  outfit_quality_candidate_item: 'candidate_item_id',
  outfit_quality_review_event: 'review_event_id',
  outfit_quality_queue_hold: 'hold_id',
  outfit_quality_render_job: 'render_job_id',
  outfit_quality_render_attempt: 'render_attempt_id',
  outfit_quality_machine_check: 'check_id',
  outfit_quality_image_override: 'override_id',
  outfit_quality_promotion: 'promotion_id',
  outfit_quality_learning_projection: 'projection_id',
  outfit: 'outfit_id',
  outfit_item: 'outfit_item_id',
  stylist: 'stylist_id',
}

export const FAKE_DEFAULTS: Record<string, Record<string, unknown>> = {
  outfit_quality_candidate_version: { state: 'awaiting_human' },
  outfit_quality_review_event: { decision: null, reason_code: null, candidate_item_id: null, note: null, reverses_event_id: null },
  outfit_quality_queue_hold: { reason: null, released_by: null, released_at: null },
  outfit_quality_render_job: { cycle_no: 1, status: 'queued', lease_token: null, leased_at: null, worker_id: null, generation_count: 0, last_error: null, promotion_id: null },
  outfit_quality_render_attempt: { prompt: null, reference_manifest: null, renderer_model: null, renderer_version: null, image_url: null, cloudinary_asset: null, generation_status: null, generation_error: null, fidelity_check_id: null, ready_at: null },
  outfit_quality_image_override: { action: 'not_good_enough', note: null },
  outfit_quality_promotion: { status: 'active', withdrawn_at: null },
  outfit_quality_learning_projection: { target_stylist_id: null, payload: {}, status: 'applied', reverses_projection_id: null },
  outfit: { status: 'draft', published_at: null, additional_images: [] },
  outfit_item: { size_override: false, size_override_note: null },
}

function uniqueViolation(table: string, tables: Record<string, any[]>, row: any): string | null {
  const dup = (pred: (r: any) => boolean, name: string) =>
    tables[table].some(pred) ? `duplicate key value violates unique constraint "${name}"` : null
  switch (table) {
    case 'outfit_quality_review_event':
      return dup((r) => r.idempotency_key === row.idempotency_key, 'outfit_quality_review_event_idempotency_key_key')
    case 'outfit_quality_render_job':
      return dup(
        (r) => r.candidate_version_id === row.candidate_version_id && r.approval_event_id === row.approval_event_id && r.cycle_no === row.cycle_no,
        'oq_render_job_cycle_uq',
      )
    case 'outfit_quality_render_attempt':
      return dup((r) => r.render_job_id === row.render_job_id && r.attempt_no === row.attempt_no, 'oq_render_attempt_uq')
    case 'outfit_quality_machine_check':
      return dup((r) => r.idempotency_key === row.idempotency_key, 'outfit_quality_machine_check_idempotency_key_key')
    case 'outfit_quality_image_override':
      return (
        dup((r) => r.idempotency_key === row.idempotency_key, 'outfit_quality_image_override_idempotency_key_key') ??
        dup((r) => r.render_attempt_id === row.render_attempt_id, 'oq_image_override_attempt_uq')
      )
    case 'outfit_quality_promotion':
      return (
        dup((r) => r.candidate_version_id === row.candidate_version_id, 'outfit_quality_promotion_candidate_version_id_key') ??
        dup((r) => r.outfit_id === row.outfit_id, 'outfit_quality_promotion_outfit_id_key')
      )
    case 'outfit_quality_learning_projection':
      return dup((r) => r.application_key === row.application_key, 'outfit_quality_learning_projection_application_key_key')
    case 'outfit_quality_queue_hold':
      // Partial unique index oq_queue_hold_active_uq: one ACTIVE hold
      // (released_at IS NULL) per candidate version, enforced at the database
      // boundary so a hold race cannot create two.
      if (row.released_at !== null && row.released_at !== undefined) return null
      return dup(
        (r) => r.candidate_version_id === row.candidate_version_id && (r.released_at === null || r.released_at === undefined),
        'oq_queue_hold_active_uq',
      )
    default:
      return null
  }
}

export interface FakeAdmin {
  tables: Record<string, any[]>
  admin: any
  inserts: { table: string; row: any }[]
  /** Every table passed to from(), in order — proves which tables were touched. */
  queried: string[]
  /** Test hooks: make the next insert into a table fail once (e.g. simulate a race).
   *  `onFail` runs at the moment of failure — use it to commit the "winner" row.
   *  `code` overrides the error code (default 23505) so transient, non-unique
   *  failures (e.g. 08006 connection failure) can be simulated. */
  failNextInsert: (table: string, message?: string, onFail?: (tables: Record<string, any[]>) => void, code?: string) => void
}

export function createFakeAdmin(seed: Record<string, any[]> = {}): FakeAdmin {
  const tables: Record<string, any[]> = {}
  for (const [k, rows] of Object.entries(seed)) tables[k] = rows.map((r) => ({ ...r }))
  const inserts: { table: string; row: any }[] = []
  const queried: string[] = []
  const failOnce = new Map<string, { message: string; code: string; onFail?: (tables: Record<string, any[]>) => void }>()
  let seq = 0

  function matches(row: any, filters: { col: string; op: string; val: unknown }[]): boolean {
    return filters.every((f) => {
      const v = row[f.col]
      switch (f.op) {
        case 'eq': return v === f.val
        case 'is': return f.val === null ? v === null || v === undefined : v === f.val
        case 'in': return (f.val as unknown[]).includes(v)
        case 'lt': return typeof v === 'string' && v < (f.val as string)
        case 'gt': return typeof v === 'string' && v > (f.val as string)
        case 'neq': return v !== f.val
        case 'not_null': return v !== null && v !== undefined
        default: return false
      }
    })
  }

  function builder(table: string) {
    const state: {
      mode: 'select' | 'insert' | 'update' | 'delete'
      filters: { col: string; op: string; val: unknown }[]
      insertRow?: any
      patch?: any
      orderCol?: string
      orderAsc: boolean
      limitN: number | null
      single: boolean
    } = { mode: 'select', filters: [], orderAsc: true, limitN: null, single: false }

    function execute(): { data: any; error: any } {
      tables[table] = tables[table] ?? []
      if (state.mode === 'insert') {
        const forced = failOnce.get(table)
        if (forced) {
          failOnce.delete(table)
          forced.onFail?.(tables)
          return { data: null, error: { code: forced.code, message: forced.message } }
        }
        const rows = Array.isArray(state.insertRow) ? state.insertRow : [state.insertRow]
        const out: any[] = []
        for (const insertRow of rows) {
          const dupErr = uniqueViolation(table, tables, insertRow)
          if (dupErr) return { data: null, error: { code: '23505', message: dupErr } }
          seq += 1
          const pk = FAKE_PK[table] ?? 'id'
          const row = {
            ...(FAKE_DEFAULTS[table] ?? {}),
            ...insertRow,
            [pk]: insertRow[pk] ?? `${table}-${seq}`,
            created_at: insertRow.created_at ?? new Date(2026, 0, 1, 0, 0, seq).toISOString(),
          }
          tables[table].push(row)
          inserts.push({ table, row })
          out.push(row)
        }
        return { data: state.single ? out[0] ?? null : out, error: null }
      }
      let rows = tables[table].filter((r) => matches(r, state.filters))
      if (state.mode === 'update') rows.forEach((r) => Object.assign(r, state.patch))
      if (state.mode === 'delete') {
        const victims = new Set(rows)
        tables[table] = tables[table].filter((r) => !victims.has(r))
      }
      if (state.orderCol) {
        rows = rows.slice().sort((a, b) => {
          const cmp = String(a[state.orderCol!] ?? '').localeCompare(String(b[state.orderCol!] ?? ''))
          return state.orderAsc ? cmp : -cmp
        })
      }
      if (state.limitN !== null) rows = rows.slice(0, state.limitN)
      if (state.single) return { data: rows[0] ?? null, error: null }
      return { data: rows, error: null }
    }

    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => (state.filters.push({ col, op: 'eq', val }), b),
      neq: (col: string, val: unknown) => (state.filters.push({ col, op: 'neq', val }), b),
      is: (col: string, val: unknown) => (state.filters.push({ col, op: 'is', val }), b),
      in: (col: string, val: unknown[]) => (state.filters.push({ col, op: 'in', val }), b),
      lt: (col: string, val: unknown) => (state.filters.push({ col, op: 'lt', val }), b),
      gt: (col: string, val: unknown) => (state.filters.push({ col, op: 'gt', val }), b),
      not: (col: string, op: string, val: unknown) => (state.filters.push({ col, op: op === 'is' && val === null ? 'not_null' : 'eq', val }), b),
      order: (col: string, opts?: { ascending?: boolean }) => ((state.orderCol = col), (state.orderAsc = opts?.ascending !== false), b),
      limit: (n: number) => ((state.limitN = n), b),
      insert: (row: any) => ((state.mode = 'insert'), (state.insertRow = row), b),
      update: (patch: any) => ((state.mode = 'update'), (state.patch = patch), b),
      delete: () => ((state.mode = 'delete'), b),
      maybeSingle: () => ((state.single = true), Promise.resolve(execute())),
      single: () => ((state.single = true), Promise.resolve(execute())),
      then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject),
    }
    return b
  }

  return {
    tables,
    inserts,
    queried,
    admin: {
      from: (table: string) => {
        queried.push(table)
        return builder(table)
      },
    },
    failNextInsert: (table: string, message = 'duplicate key value violates unique constraint "forced"', onFail?: (tables: Record<string, any[]>) => void, code = '23505') =>
      failOnce.set(table, { message, code, onFail }),
  }
}
