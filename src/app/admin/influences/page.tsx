import { createAdminClient } from '@/lib/supabase-server'
import { normaliseInfluence } from '@/lib/style-influence-store'
import InfluencesClient, { type InfluenceRow } from './InfluencesClient'

export const dynamic = 'force-dynamic'

// STYLE INFLUENCES — the people clients say inspire them, kept as people with
// pictures and a brief. Linked to a client, they sit on top of her stylist.
export default async function InfluencesPage() {
  const admin = createAdminClient() as any
  const [{ data, error }, { data: images }, { data: links }, { data: members }] = await Promise.all([
    admin.from('style_influence').select('*').order('name', { ascending: true }),
    admin.from('style_influence_image').select('influence_id, status').neq('status', 'rejected'),
    admin.from('member_style_influence').select('influence_id, member_id, source'),
    admin.from('pilot_member').select('member_id, name').eq('is_synthetic', false).order('name', { ascending: true }),
  ])
  const notMigrated = !!error && /style_influence|schema cache|does not exist/i.test(error.message)

  const memberName = new Map<string, string>(((members ?? []) as any[]).map((m) => [m.member_id, m.name]))
  const rows: InfluenceRow[] = ((data ?? []) as any[]).map((r) => {
    const mine = ((images ?? []) as any[]).filter((i) => i.influence_id === r.influence_id)
    return {
      ...normaliseInfluence(r),
      pictures: mine.length,
      scored: mine.filter((i) => i.status === 'scored').length,
      members: ((links ?? []) as any[])
        .filter((l) => l.influence_id === r.influence_id)
        .map((l) => ({ member_id: l.member_id, name: memberName.get(l.member_id) ?? 'Unknown', source: l.source })),
    }
  })

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">STYLE INFLUENCES</h1>
        <p className="text-[11px] tracking-[0.068em] text-[#A8A8A4] mt-1">
          The people clients say inspire them · add pictures and a brief · link a client and they sit on top of her stylist · LIVE ones are offered in her welcome and YOU
        </p>
      </div>
      {error && (
        <p className="text-[11px] tracking-[0.054em] text-[#B83A3A] mb-6">
          {notMigrated ? 'RUN MIGRATION 0109_style_influence.sql (npm run migrate), then reload.' : `Could not load influences: ${error.message}`}
        </p>
      )}
      <InfluencesClient rows={rows} members={((members ?? []) as any[]).map((m) => ({ member_id: m.member_id, name: m.name }))} />
    </div>
  )
}
