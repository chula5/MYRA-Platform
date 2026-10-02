'use server'

// Browser-callable surface of the Outfit Quality Coverage view — admin only.
// Read-only reporting; the gate runs before any service-role access. Holdout
// is never opened from the browser in this release.

import { assertAdmin } from '@/lib/admin-audit'
import { loadCoverageReport } from '@/lib/outfit-quality/coverage-read'

export async function loadCoverageAction() {
  await assertAdmin()
  return loadCoverageReport()
}
