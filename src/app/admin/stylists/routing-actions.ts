'use server'

// SCIURA'S BOARD — who dresses whom, proposed by the chief and applied by Chloe.

import { createAdminClient } from '@/lib/supabase-server'
import { assertAdmin } from '@/lib/admin-audit'
import { routeMember, loadRouting, type Routing } from '@/lib/chief-stylist'
import { assignMemberPersona } from '@/app/admin/private-stylist/actions'

export interface RoutingRow {
  member_id: string
  name: string
  /** Her stylist today, by name. */
  current: string | null
  current_id: string | null
  routing: (Routing & { applied_at: string | null }) | null
}

export async function listRoutingBoard(): Promise<{ rows: RoutingRow[]; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const { data: members, error } = await admin.from('pilot_member')
    .select('member_id, name, is_synthetic').order('created_at', { ascending: true })
  if (error) return { rows: [], error: error.message }
  const real = ((members ?? []) as any[]).filter((m) => !m.is_synthetic)
  const ids = real.map((m) => m.member_id)
  const [{ data: assignments }, { data: stylists }] = await Promise.all([
    admin.from('user_persona').select('user_id, persona_id').in('user_id', ids),
    admin.from('stylist').select('stylist_id, name, brief'),
  ])
  const nameOf = new Map<string, string>(((stylists ?? []) as any[]).map((s) => [s.stylist_id, s.brief?.public_name || s.name]))
  const personaOf = new Map<string, string>(((assignments ?? []) as any[]).map((a) => [a.user_id, a.persona_id]))
  const rows: RoutingRow[] = []
  for (const m of real) {
    const pid = personaOf.get(m.member_id) ?? null
    rows.push({
      member_id: m.member_id, name: m.name,
      current: pid ? nameOf.get(pid) ?? null : null, current_id: pid,
      routing: await loadRouting(m.member_id),
    })
  }
  return { rows }
}

/** Ask Sciura to read her again. */
export async function routeMemberNow(memberId: string): Promise<{ routing?: Routing; error?: string }> {
  await assertAdmin()
  const r = await routeMember(memberId)
  return 'error' in r ? { error: r.error } : { routing: r }
}

/** Accept the proposal: assign the primary stylist and mark it applied. */
export async function applyRouting(memberId: string, stylistId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const r = await assignMemberPersona(memberId, stylistId)
  if (r.error) return r
  const admin = createAdminClient() as any
  await admin.from('stylist_routing').update({ applied_at: new Date().toISOString() }).eq('member_id', memberId)
  return {}
}
