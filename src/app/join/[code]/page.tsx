import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase-server'
import { mintInvite, nameSlug, readShortInvite } from '@/lib/member-invite'

export const dynamic = 'force-dynamic'

// The short invite she is sent (/join/alison-…). A genuine, in-date code opens
// her welcome page; anything else shows the same "expired" page as a bad link.
export default async function JoinPage({ params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code ?? '')
  const slug = code.toLowerCase().split('-')[0]
  const admin = createAdminClient() as any
  const { data } = await admin.from('pilot_member').select('member_id, name').ilike('name', `${slug}%`).limit(50)
  const members = ((data ?? []) as { member_id: string; name: string }[]).filter((m) => nameSlug(m.name) === slug)
  const memberId = readShortInvite(code, members)
  redirect(`/welcome/${memberId ? encodeURIComponent(mintInvite(memberId, 1)) : 'expired'}`)
}
