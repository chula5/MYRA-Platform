import { createAdminClient } from '@/lib/supabase-server'
import { loadBrandGraph } from '@/lib/brand-affinity'
import ApplicationsClient, { type ApplicationView } from './ApplicationsClient'
import type { ApplicationRow } from './actions'
import { splitBrandNames, sortBrandNames } from './brand-names'

export const dynamic = 'force-dynamic'

// The people who applied from the landing page, newest first. Each row shows
// her brands as MYRA will take them: known ones dark, unknown ones outlined.
export default async function ApplicationsPage() {
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('application')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  const rows = ((data as ApplicationRow[] | null) ?? [])
  const notMigrated = !!error && /reviewed_at|member_id|invite_url|emailed_at|schema cache/i.test(error.message)

  // One brand graph for the whole page; unknown brands are only a hint here,
  // ACCEPT keeps them as her own words.
  const known = new Set<string>()
  try {
    const graph = await loadBrandGraph(admin)
    const all = Array.from(new Set(rows.flatMap((r) => splitBrandNames(r.brands)).map((n) => n.toLowerCase())))
    for (const n of all) if (sortBrandNames(graph, [n]).matched.length) known.add(n)
  } catch { /* unknown stays a hint only */ }

  // Whether each accepted member has made her login yet (for RESEND).
  const memberIds = rows.map((r) => r.member_id).filter(Boolean) as string[]
  const loggedIn = new Set<string>()
  if (memberIds.length) {
    const { data: members } = await admin.from('pilot_member').select('member_id, auth_user_id').in('member_id', memberIds)
    for (const m of (members as any[]) ?? []) if (m.auth_user_id) loggedIn.add(m.member_id)
  }

  const views: ApplicationView[] = rows.map((r) => ({
    ...r,
    brandList: splitBrandNames(r.brands).map((n) => ({ name: n, known: known.has(n.toLowerCase()) })),
    hasLogin: r.member_id ? loggedIn.has(r.member_id) : false,
  }))
  const fresh = views.filter((r) => r.status === 'new').length

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">APPLICATIONS</h1>
        <p className="text-[11px] tracking-[0.068em] text-[#A8A8A4] mt-1">
          {fresh} to read · ACCEPT makes her a member with her brands in and emails her invitation · DECLINE only records it ·{' '}
          <a href="/admin/applications/brands" className="underline hover:text-[#4A4E57]">brand applications</a>
        </p>
      </div>
      {error && (
        <p className="text-[11px] tracking-[0.054em] text-[#B83A3A] mb-6">
          {notMigrated ? 'RUN MIGRATION 0103_application_review.sql (npm run migrate), then reload.' : `Could not load applications: ${error.message}`}
        </p>
      )}
      <ApplicationsClient rows={views} />
    </div>
  )
}
