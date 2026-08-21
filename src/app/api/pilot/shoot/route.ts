// Higgsfield shoots take minutes. As a server action they blocked the whole
// pilot page — React serializes actions per client, so every APPROVE/SWAP/
// SKIP click queued behind a running shoot. As a route handler the shoot runs
// in parallel: the page stays fully interactive while it generates.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { higgsfieldShootForLook } from '@/app/admin/private-stylist/actions'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 })
  }
  const { lookId, poseKey } = await req.json().catch(() => ({}))
  if (!lookId) return NextResponse.json({ error: 'lookId required' }, { status: 400 })
  const result = await higgsfieldShootForLook(lookId, poseKey ?? 'E5')
  return NextResponse.json(result)
}
