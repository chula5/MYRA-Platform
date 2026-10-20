import { createAdminClient } from '@/lib/supabase-server'
import ApplicationsClient, { type ApplicationRow } from './ApplicationsClient'

export const dynamic = 'force-dynamic'

// Brand application queue (Part 6). Auto-qualification results attached;
// approval creates the merchant + terms at the rate Chloe sets.
export default async function ApplicationsPage() {
  const admin = createAdminClient()
  const { data } = await admin
    .from('brand_application' as any)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  const rows = ((data as any[]) ?? []) as ApplicationRow[]
  const pending = rows.filter((r) => r.status === 'pending').length

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">BRAND APPLICATIONS</h1>
        <p className="text-[11px] tracking-[0.068em] text-[#A8A8A4] mt-1">
          {pending} awaiting review · public form at /partners/apply · approval creates the merchant at YOUR rate.
        </p>
      </div>
      <ApplicationsClient rows={rows} />
    </div>
  )
}
