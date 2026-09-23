import { NextRequest } from 'next/server'
import { adminFromRequest, mintMirrorToken } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// Stylist mode: swap the extension onto another member. The actor (Chloe) is
// carried over, so the new token is still an admin token.
export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const me = await adminFromRequest(req)
  if (!me) return mirrorJson({ error: 'stylist only' }, { status: 403 })
  let body: any
  try { body = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const memberId = typeof body?.memberId === 'string' ? body.memberId : ''
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('member_id, name').eq('member_id', memberId).maybeSingle()
  if (!member) return mirrorJson({ error: 'member not found' }, { status: 404 })
  const token = mintMirrorToken(member.member_id, { actor: me.actorUserId })
  return mirrorJson({ token, memberId: member.member_id, member: member.name, actingAdmin: true })
}
