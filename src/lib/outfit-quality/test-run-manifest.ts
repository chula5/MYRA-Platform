// Exact-ID test-run manifest for the Outfit Quality Lab.
//
// Every connected test mutation runs under a unique run_id with
// data_partition='test', records the exact primary key of every row it inserts,
// and cleans up by deleting *only* those recorded IDs in dependency-safe order.
// Broad predicates (delete-all-test, synthetic, date range, prefix) are never
// produced here: the delete plan is always a bounded set of exact IDs.

import { randomUUID } from 'node:crypto'

/**
 * The tables a Quality Lab test run may clean, in dependency-safe delete order
 * (children before parents). Cleanup walks this order so foreign keys never
 * block a delete of recorded IDs.
 *
 * The two non-namespaced entries, `outfit_item` and `outfit`, are the canonical
 * graph a render/promotion test creates when it promotes its own approved
 * `test` candidate. They are included so a test can remove exactly the outfit
 * and outfit_item rows IT inserted. They are deleted after the promotion row
 * that references the outfit, and `outfit_item` is deleted before its `outfit`.
 * This is still exact-ID-only: the pre-existing 444 legacy outfits are never
 * recorded here, so they are never in a delete plan.
 */
export const OUTFIT_QUALITY_DELETE_ORDER = [
  'outfit_quality_learning_projection',
  'outfit_quality_image_override',
  'outfit_quality_render_attempt',
  'outfit_quality_render_job',
  'outfit_quality_promotion',
  'outfit_item',
  'outfit',
  'outfit_quality_review_event',
  'outfit_quality_queue_hold',
  'outfit_quality_machine_check',
  'outfit_quality_candidate_item',
  'outfit_quality_candidate_version',
  'outfit_quality_case',
  'outfit_quality_batch',
  'outfit_quality_stylist_snapshot',
  'outfit_quality_legacy_evidence',
  'outfit_quality_evaluation_profile',
] as const

export type OutfitQualityTable = (typeof OUTFIT_QUALITY_DELETE_ORDER)[number]

const DELETE_ORDER_SET = new Set<string>(OUTFIT_QUALITY_DELETE_ORDER)

export interface DeleteStep {
  table: OutfitQualityTable
  idColumn: string
  ids: string[]
}

/**
 * Tracks the exact IDs inserted by one unique test run. Partition is fixed to
 * 'test' and the run_id is unique per instance.
 */
export class TestRunManifest {
  readonly runId: string
  readonly partition = 'test' as const
  private readonly recorded = new Map<OutfitQualityTable, Set<string>>()
  private readonly idColumns = new Map<OutfitQualityTable, string>()

  constructor(runId: string = randomUUID()) {
    this.runId = runId
  }

  /** Record one or more exact primary keys for a table. */
  record(table: OutfitQualityTable, idColumn: string, ...ids: string[]): this {
    if (!DELETE_ORDER_SET.has(table)) {
      throw new Error(`Unknown Quality Lab cleanup table: ${table}`)
    }
    const set = this.recorded.get(table) ?? new Set<string>()
    for (const id of ids) set.add(id)
    this.recorded.set(table, set)
    this.idColumns.set(table, idColumn)
    return this
  }

  ids(table: OutfitQualityTable): string[] {
    return Array.from(this.recorded.get(table) ?? [])
  }

  /** Total number of exact IDs recorded across all tables. */
  size(): number {
    let n = 0
    for (const set of Array.from(this.recorded.values())) n += set.size
    return n
  }

  /**
   * The dependency-safe delete plan: one step per table with recorded IDs,
   * children before parents, each bounded to the exact recorded IDs.
   */
  deletePlan(): DeleteStep[] {
    const steps: DeleteStep[] = []
    for (const table of OUTFIT_QUALITY_DELETE_ORDER) {
      const ids = this.ids(table)
      if (ids.length === 0) continue
      steps.push({ table, idColumn: this.idColumns.get(table) as string, ids })
    }
    return steps
  }

  /**
   * Render the delete plan as parameter-free SQL statements that delete only
   * the exact recorded IDs. Returns [] when nothing was recorded.
   */
  deleteSql(): string[] {
    return this.deletePlan().map(({ table, idColumn, ids }) => {
      const list = ids.map((id) => `'${assertUuidLike(id)}'`).join(', ')
      return `delete from public.${table} where ${idColumn} in (${list});`
    })
  }
}

function assertUuidLike(id: string): string {
  if (!/^[0-9a-fA-F-]{8,}$/.test(id)) {
    throw new Error('Refusing to build a delete for a non-id-like value')
  }
  return id
}
