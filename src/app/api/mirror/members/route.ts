import { NextRequest } from 'next/server'
import { adminFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// Stylist mode: the members Chloe can shop as. Admin-actor tokens only.
export async function OPTIONS() { return mirrorOptions() }

export async function GET(req: NextRequest) {
  const me = await adminFromRequest(req)
  if (!me) return mirrorJson({ error: 'stylist only' }, { status: 403 })
  const admin = createAdminClient() as any
  const { data } = await admin.from('pilot_member').select('member_id, name, is_synthetic').order('is_synthetic').order('created_at')
  return mirrorJson({ members: (data ?? []).map((m: any) => ({ member_id: m.member_id, name: m.name, is_synthetic: !!m.is_synthetic })) })
}
