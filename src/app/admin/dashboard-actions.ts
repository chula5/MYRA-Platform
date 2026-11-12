'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { assertAdmin } from '@/lib/admin-audit'
import { DASHBOARD_TAG } from '@/lib/admin-dashboard'

/** REFRESH on the dashboard: forget the remembered numbers and read them again now. */
export async function refreshDashboard(): Promise<void> {
  await assertAdmin()
  revalidateTag(DASHBOARD_TAG)
  revalidatePath('/admin')
}
