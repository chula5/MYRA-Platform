// Server-only read model for the Outfit Quality Coverage view.
//
// Assembles immutable provenance rows (batches, cases, current versions,
// append-only review events, subjective checks) plus the labeling dimensions
// (stylists, evaluation profiles, real members) and delegates ALL semantics —
// labels, exclusions, sparse warnings, guidance — to the pure, tested
// `buildCoverageReport`. Reached only through the admin-gated action.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import {
  buildCoverageReport,
  type CoverageInput,
  type CoverageOptions,
  type CoverageReport,
} from '@/lib/outfit-quality/coverage'

type Admin = ReturnType<typeof createAdminClient>

const BATCH_LIMIT = 500

export async function loadCoverageReport(
  options: CoverageOptions = {},
  admin: Admin = createAdminClient(),
): Promise<CoverageReport> {
  const db = admin as any

  const { data: batchRows, error: bErr } = await db
    .from('outfit_quality_batch')
    .select('batch_id, data_partition, real_member_id, evaluation_profile_id, selected_stylist_id')
    .order('created_at', { ascending: false })
    .limit(BATCH_LIMIT)
  if (bErr) throw new Error(`coverage: batch read failed: ${bErr.message}`)
  const batches = (batchRows ?? []) as CoverageInput['batches']

  const emptyRest = {
    cases: [] as CoverageInput['cases'],
    versions: [] as CoverageInput['versions'],
    events: [] as CoverageInput['events'],
    subjectiveChecks: [] as CoverageInput['subjectiveChecks'],
  }

  let rest = emptyRest
  if (batches.length > 0) {
    const batchIds = batches.map((b) => b.batch_id)
    const { data: caseRows, error: cErr } = await db
      .from('outfit_quality_case')
      .select('case_id, batch_id, current_version_id')
      .in('batch_id', batchIds)
    if (cErr) throw new Error(`coverage: case read failed: ${cErr.message}`)
    const cases = (caseRows ?? []) as CoverageInput['cases']
    const versionIds = cases.map((c) => c.current_version_id).filter((v): v is string => !!v)

    if (versionIds.length > 0) {
      const [{ data: versionRows, error: vErr }, { data: eventRows, error: eErr }, { data: checkRows, error: kErr }] = await Promise.all([
        db
          .from('outfit_quality_candidate_version')
          .select('candidate_version_id, case_id, version_no, created_at')
          .in('candidate_version_id', versionIds),
        db.from('outfit_quality_review_event').select('*').in('candidate_version_id', versionIds),
        db
          .from('outfit_quality_machine_check')
          .select('candidate_version_id, status, created_at')
          .in('candidate_version_id', versionIds)
          .eq('kind', 'subjective'),
      ])
      const firstErr = vErr ?? eErr ?? kErr
      if (firstErr) throw new Error(`coverage: evidence read failed: ${firstErr.message}`)
      rest = {
        cases,
        versions: (versionRows ?? []) as CoverageInput['versions'],
        events: (eventRows ?? []) as CoverageInput['events'],
        subjectiveChecks: (checkRows ?? []) as CoverageInput['subjectiveChecks'],
      }
    } else {
      rest = { ...emptyRest, cases }
    }
  }

  const [{ data: stylistRows, error: sErr }, { data: profileRows, error: pErr }, { data: memberRows, error: mErr }] = await Promise.all([
    db.from('stylist').select('stylist_id, name').order('name'),
    db
      .from('outfit_quality_evaluation_profile')
      .select('profile_id, name, style_families, brand_groups, occasions')
      .eq('active', true)
      .is('retired_at', null),
    db.from('pilot_member').select('member_id, name').eq('is_synthetic', false).order('name'),
  ])
  const labelErr = sErr ?? pErr ?? mErr
  if (labelErr) throw new Error(`coverage: dimension read failed: ${labelErr.message}`)

  return buildCoverageReport(
    {
      batches,
      cases: rest.cases,
      versions: rest.versions,
      events: rest.events,
      subjectiveChecks: rest.subjectiveChecks,
      stylists: (stylistRows ?? []) as CoverageInput['stylists'],
      profiles: ((profileRows ?? []) as any[]).map((p) => ({
        profile_id: p.profile_id,
        name: p.name,
        style_families: p.style_families ?? [],
        brand_groups: p.brand_groups ?? [],
        occasions: p.occasions ?? [],
      })),
      members: (memberRows ?? []) as CoverageInput['members'],
    },
    options,
  )
}
